import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ActivateRoute, ReopenRouteForPlanning } from '@/application/routes/route-commands';
import { resolveRoute } from '@/application/routes/route-navigation';
import {
  GetLatestUndoableAction,
  GetRouteProgress,
  MarkAllStopsLoaded,
  MarkStopLoaded,
  MarkStopUnloaded,
  parseOdometer,
  ReverseStopOrder,
  SaveStartOdometer,
  SkipStartOdometer,
  StartRoute,
  UndoRouteAction,
  type RouteProgress,
  type UndoableAction,
} from '@/application/routes/route-workday';
import { FoundationScreen } from '@/components/foundation-screen';
import { SwipeActionCard } from '@/components/swipe-action-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { Alert } from '@/ui/alert';
import { etaLabel, legLabel, windowLabel } from '@/ui/route-eta-labels';
import { userVisibleStopNote } from '@/ui/route-labels';
import { fonts, spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function LoadingScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [undo, setUndo] = useState<UndoableAction | null>(null);
  const [odometer, setOdometer] = useState('');
  const [busy, setBusy] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const bulkInFlight = useRef(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const persisted = await repository.getWithStops(routeId);
      if (!persisted) throw new Error('Maršrutas nerastas.');
      if (persisted.route.status === 'planned') await new ActivateRoute(db).execute(routeId);
      const refreshed = await repository.getWithStops(routeId);
      if (!refreshed) throw new Error('Maršrutas nerastas.');
      if (refreshed.route.status === 'in_progress') {
        const destination = resolveRoute(refreshed.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      if (!['loading', 'loaded'].includes(refreshed.route.status)) {
        const destination = resolveRoute(refreshed.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      setRoute(refreshed.route);
      setStops(await repository.getStops(routeId, 'loading'));
      setProgress(await new GetRouteProgress(db).execute(routeId));
      setUndo(await new GetLatestUndoableAction(db).execute(routeId));
      if (refreshed.route.startOdometer !== null) setOdometer(String(refreshed.route.startOdometer));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Krovimo plano atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [db, repository, routeId, router]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const markLoaded = async (stopId: string) => {
    try {
      await new MarkStopLoaded(db).execute(routeId, stopId);
      await load();
    } catch (reason) {
      Alert.alert('Nepavyko pažymėti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const markUnloaded = async (stopId: string) => {
    try {
      await new MarkStopUnloaded(db).execute(routeId, stopId);
      await load();
    } catch (reason) {
      Alert.alert('Nepavyko atžymėti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const markAllLoaded = async () => {
    if (bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      const result = await new MarkAllStopsLoaded(db).execute(routeId);
      await load();
      if (!result.idempotent) {
        Alert.alert('Pakrovimas atnaujintas', 'Visi kroviniai pažymėti kaip pakrauti');
      }
    } catch (reason) {
      Alert.alert('Nepavyko pažymėti visų', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    try {
      await new UndoRouteAction(db).execute(undo.id);
      await load();
    } catch (reason) {
      Alert.alert('Veiksmo atšaukti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const saveOdometer = async () => {
    try {
      await new SaveStartOdometer(db).execute(routeId, parseOdometer(odometer));
      await load();
    } catch (reason) {
      Alert.alert('Neteisingas odometras', reason instanceof Error ? reason.message : 'Patikrinkite reikšmę.');
    }
  };

  const skipOdometer = async () => {
    try {
      await new SkipStartOdometer(db).execute(routeId);
      await load();
    } catch (reason) {
      Alert.alert('Veiksmo atlikti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const pickDifferentAlternative = () => {
    Alert.alert(
      'Pasirinkti kitą maršruto variantą?',
      'Grįšite į variantų ekraną. Pakrovimo pažymos išliks, bet maršruto seka bus perskaičiuota iš naujo.',
      [
        { text: 'Ne', style: 'cancel' },
        { text: 'Taip, grįžti', onPress: () => { void (async () => {
          try {
            await new ReopenRouteForPlanning(db).execute(routeId);
            router.replace({ pathname: '/route/[id]/alternatives', params: { id: routeId } });
          } catch (reason) {
            Alert.alert('Nepavyko grįžti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
          }
        })(); } },
      ],
    );
  };

  const reverseDirection = () => {
    Alert.alert(
      'Apsukti pristatymo kryptį?',
      'Visas maršrutas bus apsuktas — paskutinis pristatymo taškas taps pirmu ir atvirkščiai. Krovimo sąrašas atsinaujins pagal naują kryptį.',
      [
        { text: 'Ne', style: 'cancel' },
        { text: 'Taip, apsukti', onPress: () => { void (async () => {
          try {
            await new ReverseStopOrder(db).execute(routeId);
            await load();
          } catch (reason) {
            Alert.alert('Nepavyko apsukti krypties', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
          }
        })(); } },
      ],
    );
  };

  const startRoute = async () => {
    try {
      await new StartRoute(db).execute(routeId);
      router.replace({ pathname: '/route/[id]/delivery', params: { id: routeId } });
    } catch (reason) {
      Alert.alert('Maršrutas nepradėtas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Krovimo planas"
      description="Kraukite atvirkštine pristatymo tvarka. Pažymėjimai iškart išsaugomi ir išlieka perkrovus programą.">
      {busy ? <ActivityIndicator color={colors.primary} size="large" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {progress ? (
        <View style={styles.summary} testID="loading-progress">
          <Text style={styles.summaryTitle}>Pakrauta {progress.loadedStops} / {progress.totalStops} ({progress.loadingPercent}%)</Text>
          <Text style={styles.summaryText}>Žinomas pakrautas svoris: {progress.loadedKnownWeightKg.toFixed(1)} / {progress.totalKnownWeightKg.toFixed(1)} kg</Text>
          {progress.totalUnknownWeightStops > 0 ? <Text style={styles.summaryText}>{progress.loadedUnknownWeightStops} / {progress.totalUnknownWeightStops} pakrautų taškų svoris nežinomas</Text> : null}
        </View>
      ) : null}
      {progress && progress.totalStops > 0 ? (
        progress.loadedStops === progress.totalStops ? (
          <View style={styles.allLoadedState} testID="all-stops-loaded-state">
            <Text style={styles.allLoadedText}>Visi kroviniai pakrauti ✓</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={bulkBusy}
            testID="mark-all-stops-loaded"
            style={[styles.markAllButton, bulkBusy && styles.disabled]}
            onPress={markAllLoaded}>
            {bulkBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.markAllText}>Pažymėti visus kaip pakrautus</Text>}
          </Pressable>
        )
      ) : null}
      {stops.length > 1 ? (
        <Pressable style={styles.reverseButton} onPress={reverseDirection}>
          <Text style={styles.reverseText}>⇄ Apsukti pristatymo kryptį</Text>
        </Pressable>
      ) : null}
      {route?.status === 'loading' ? (
        <Pressable style={styles.reverseButton} onPress={pickDifferentAlternative}>
          <Text style={styles.reverseText}>← Pasirinkti kitą maršruto variantą</Text>
        </Pressable>
      ) : null}
      {undo ? <Pressable style={styles.undoButton} onPress={undoLast}><Text style={styles.undoText}>Atšaukti paskutinį pakrovimą</Text></Pressable> : null}
      {stops.map((stop) => {
        const expanded = expandedStopId === stop.id;
        return (
          <SwipeActionCard
            key={stop.id}
            onSwipeRight={stop.loadingStatus === 'loaded' ? undefined : () => markLoaded(stop.id)}
            onSwipeLeft={stop.loadingStatus === 'loaded' ? () => markUnloaded(stop.id) : undefined}
            style={[styles.card, stop.loadingStatus === 'loaded' && styles.loadedCard]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpandedStopId(expanded ? null : stop.id)}
              style={styles.cardHeader}>
              <View style={styles.cardHeaderText}>
                <Text style={styles.address}>{stop.normalizedAddress ?? stop.originalAddress}{stop.priorityFirst ? ' ⭐' : ''}</Text>
              </View>
              <Text style={styles.weight}>{stop.weightKg === null ? 'Svoris nežinomas' : `${stop.weightKg} kg`}</Text>
              <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded ? (
              <>
                <Text style={styles.eta}>{etaLabel(stop)}</Text>
                <Text style={styles.meta}>{legLabel(stop)}</Text>
                {windowLabel(stop, route?.planningMode ?? null) ? <Text style={route?.planningMode === 'ignore_time_windows' ? styles.informational : styles.meta}>{windowLabel(stop, route?.planningMode ?? null)}</Text> : null}
                {userVisibleStopNote(stop.notes) ? <Text style={styles.notes}>Pastabos: {userVisibleStopNote(stop.notes)}</Text> : null}
                <Pressable style={[styles.loadButton, stop.loadingStatus === 'loaded' && styles.loadedButton]} onPress={() => stop.loadingStatus === 'loaded' ? markUnloaded(stop.id) : markLoaded(stop.id)}>
                  <Text style={styles.loadButtonText}>{stop.loadingStatus === 'loaded' ? 'Atžymėti' : 'Pakrauta'}</Text>
                </Pressable>
              </>
            ) : null}
          </SwipeActionCard>
        );
      })}
      {route?.status === 'loaded' ? (
        <View style={styles.odometerCard} testID="start-odometer-card">
          <Text style={styles.summaryTitle}>Pradinis odometras</Text>
          <Text style={styles.summaryText}>Galite įvesti dabar arba sąmoningai atidėti. Priminimas liks Dashboard.</Text>
          <TextInput value={odometer} onChangeText={setOdometer} keyboardType="decimal-pad" placeholder="Pvz. 125430,5" style={styles.input} />
          <Pressable style={styles.secondaryButton} onPress={saveOdometer}><Text style={styles.secondaryText}>Išsaugoti odometrą</Text></Pressable>
          <Pressable style={styles.linkButton} onPress={skipOdometer}><Text style={styles.linkText}>Įvesiu vėliau</Text></Pressable>
          <Pressable disabled={route.startOdometer === null && !route.startOdometerSkippedAt} style={[styles.primaryButton, route.startOdometer === null && !route.startOdometerSkippedAt && styles.disabled]} onPress={startRoute}>
            <Text style={styles.primaryText}>Pradėti maršrutą</Text>
          </Pressable>
        </View>
      ) : null}
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  summary: { padding: spacing.md, backgroundColor: colors.accentSoft, gap: spacing.xs },
  summaryTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.heading },
  summaryText: { color: colors.textMuted, lineHeight: 20 },
  markAllButton: { minHeight: 52, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  markAllText: { color: '#fff', fontSize: 16, fontFamily: fonts.heading, textAlign: 'center' },
  allLoadedState: { minHeight: 52, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  allLoadedText: { color: colors.accent, fontSize: 16, fontFamily: fonts.heading, textAlign: 'center' },
  card: { padding: spacing.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  loadedCard: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  cardHeaderText: { flex: 1, minWidth: 0 },
  chevron: { color: colors.textMuted, fontSize: 16, fontFamily: fonts.heading },
  address: { color: colors.text, fontSize: 16, fontFamily: fonts.heading },
  weight: { color: colors.text, fontSize: 16, fontFamily: fonts.headingSemiBold },
  eta: { color: colors.accent, fontSize: 16, fontFamily: fonts.heading },
  meta: { color: colors.textMuted, lineHeight: 19 },
  informational: { color: colors.textMuted, opacity: 0.7, lineHeight: 19 },
  notes: { color: colors.text, lineHeight: 19 },
  loadButton: { minHeight: 48, marginTop: spacing.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  loadedButton: { opacity: 0.65 },
  loadButtonText: { color: '#fff', fontFamily: fonts.heading },
  reverseButton: { minHeight: 46, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  reverseText: { color: colors.accent, fontFamily: fonts.heading },
  undoButton: { minHeight: 46, borderWidth: 2, borderColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.warning, fontFamily: fonts.heading },
  odometerCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.surface },
  input: { minHeight: 48, borderWidth: 2, borderColor: colors.border, paddingHorizontal: spacing.md, color: colors.text, fontFamily: fonts.body },
  secondaryButton: { minHeight: 48, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.accent, fontFamily: fonts.heading },
  linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.textMuted, fontFamily: fonts.headingSemiBold },
  primaryButton: { minHeight: 56, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontFamily: fonts.heading, fontSize: 16 },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
});
