import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ActivateRoute, CancelDraftRoute, ReopenRouteForPlanning } from '@/application/routes/route-commands';
import { resolveRoute } from '@/application/routes/route-navigation';
import {
  GetLatestUndoableAction,
  GetRouteProgress,
  MarkAllStopsLoaded,
  MarkStopLoaded,
  MarkStopNotLoaded,
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
import { LOADING_FAILURE_REASONS, type LoadingFailureReason } from '@/domain/loading-failure';
import { Alert } from '@/ui/alert';
import { etaLabel, legLabel, windowLabel } from '@/ui/route-eta-labels';
import { userVisibleStopNote } from '@/ui/route-labels';
import { fonts, spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { formatWeightKg } from '@/ui/format-weight';

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
  const [notLoadedStopId, setNotLoadedStopId] = useState<string | null>(null);
  const [notLoadedReason, setNotLoadedReason] = useState<LoadingFailureReason>('Atšauktas užsakymas');
  const [odometerModalVisible, setOdometerModalVisible] = useState(false);
  const bulkInFlight = useRef(false);
  const odometerPrompted = useRef(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const persisted = await repository.getWithStops(routeId);
      if (!persisted) throw new Error('Maršrutas nerastas.');
      if (persisted.route.status === 'planned') {
        setRoute(persisted.route);
        setStops(persisted.stops);
        setProgress(null);
        setUndo(null);
        setError(null);
        return;
      }
      const refreshed = persisted;
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
      if (refreshed.route.status === 'loaded' && !odometerPrompted.current) {
        odometerPrompted.current = true;
        setOdometerModalVisible(true);
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

  const beginNotLoaded = (stopId: string) => {
    setNotLoadedStopId(stopId);
    setNotLoadedReason('Atšauktas užsakymas');
  };

  const saveNotLoaded = async () => {
    if (!notLoadedStopId || bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      await new MarkStopNotLoaded(db).execute(routeId, notLoadedStopId, notLoadedReason);
      setNotLoadedStopId(null);
      setExpandedStopId(null);
      await load();
    } catch (reason) {
      Alert.alert('Nepavyko išsaugoti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
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

  const beginLoading = async () => {
    if (bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      await new ActivateRoute(db).execute(routeId);
      await load();
    } catch (reason) {
      Alert.alert('Krovimas nepradėtas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
    }
  };

  const editPlannedRoute = async () => {
    if (bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      await new ReopenRouteForPlanning(db).execute(routeId);
      router.replace({ pathname: '/route/[id]/alternatives', params: { id: routeId } });
    } catch (reason) {
      Alert.alert('Redagavimas neatidarytas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
    }
  };

  const cancelPlannedRoute = () => {
    if (bulkInFlight.current) return;
    Alert.alert(
      'Atšaukti suplanuotą maršrutą?',
      'Maršrutas bus perkeltas į istoriją kaip atšauktas. Ankstesni maršrutai nebus ištrinti.',
      [
        { text: 'Ne', style: 'cancel' },
        {
          text: 'Taip, atšaukti',
          style: 'destructive',
          onPress: () => {
            bulkInFlight.current = true;
            setBulkBusy(true);
            void new CancelDraftRoute(db).execute(routeId)
              .then(() => router.replace('/' as Href))
              .catch((reason) => Alert.alert('Maršrutas neatšauktas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.'))
              .finally(() => {
                bulkInFlight.current = false;
                setBulkBusy(false);
              });
          },
        },
      ],
    );
  };

  if (!busy && route?.status === 'planned') {
    return (
      <FoundationScreen
        showFoundationNotice={false}
        title="Suplanuotas maršrutas"
        description="Maršrutas išsaugotas. Galite uždaryti programą ir pradėti krautis vėliau.">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.plannedSummary} testID="planned-route-summary">
          <Text style={styles.summaryTitle}>Maršrutas paruoštas</Text>
          <Text style={styles.summaryText}>Pristatymo taškai: {route.totalStops}</Text>
          <Text style={styles.summaryText}>Bendras svoris: {formatWeightKg(route.totalWeightKg)} kg</Text>
          <Text style={styles.summaryText}>Planuotas atstumas: {route.estimatedDistanceKm === null ? '—' : `${route.estimatedDistanceKm.toFixed(1)} km`}</Text>
        </View>
        <Pressable disabled={bulkBusy} style={[styles.primaryButton, bulkBusy && styles.disabled]} onPress={() => { void beginLoading(); }} testID="begin-loading">
          {bulkBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Pradėti krovimą</Text>}
        </Pressable>
        <Pressable disabled={bulkBusy} style={[styles.secondaryButton, bulkBusy && styles.disabled]} onPress={() => { void editPlannedRoute(); }} testID="edit-planned-route">
          <Text style={styles.secondaryText}>Redaguoti maršrutą</Text>
        </Pressable>
        <Pressable disabled={bulkBusy} style={[styles.cancelRouteButton, bulkBusy && styles.disabled]} onPress={cancelPlannedRoute} testID="cancel-planned-route">
          <Text style={styles.cancelRouteText}>Atšaukti esamą maršrutą</Text>
        </Pressable>
      </FoundationScreen>
    );
  }

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
          <Text style={styles.summaryText}>Žinomas pakrautas svoris: {formatWeightKg(progress.loadedKnownWeightKg)} / {formatWeightKg(progress.totalKnownWeightKg)} kg</Text>
          {progress.notLoadedStops > 0 ? <Text style={styles.notLoadedSummary}>Nepakrauta: {progress.notLoadedStops}</Text> : null}
          {progress.totalUnknownWeightStops > 0 ? <Text style={styles.summaryText}>{progress.loadedUnknownWeightStops} / {progress.totalUnknownWeightStops} pakrautų taškų svoris nežinomas</Text> : null}
        </View>
      ) : null}
      {progress && progress.totalStops > 0 ? (
        route?.status === 'loaded' ? (
          <View style={styles.allLoadedState} testID="all-stops-loaded-state">
            <Text style={styles.allLoadedText}>{progress.notLoadedStops > 0 ? `Pakrovimas paruoštas · nepakrauta ${progress.notLoadedStops}` : 'Visi kroviniai pakrauti ✓'}</Text>
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
      {route?.status === 'loaded' ? (
        <Pressable style={styles.primaryButton} onPress={() => setOdometerModalVisible(true)} testID="open-start-odometer">
          <Text style={styles.primaryText}>{route.startOdometer === null && !route.startOdometerSkippedAt ? 'Įvesti odometrą ir pradėti' : 'Pradėti maršrutą'}</Text>
        </Pressable>
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
        const markedNotLoaded = stop.loadingStatus === 'pending' && stop.deliveryStatus === 'failed';
        return (
          <SwipeActionCard
            key={stop.id}
            onSwipeRight={stop.loadingStatus === 'loaded' ? undefined : () => markLoaded(stop.id)}
            onSwipeLeft={stop.loadingStatus === 'loaded' ? () => markUnloaded(stop.id) : markedNotLoaded ? undefined : () => beginNotLoaded(stop.id)}
            style={[styles.card, stop.loadingStatus === 'loaded' && styles.loadedCard, markedNotLoaded && styles.notLoadedCard]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpandedStopId(expanded ? null : stop.id)}
              style={styles.cardHeader}>
              <View style={styles.cardHeaderText}>
                <Text style={styles.address}>{stop.normalizedAddress ?? stop.originalAddress}{stop.priorityFirst ? ' ⭐' : ''}</Text>
              </View>
              <Text style={styles.weight}>{stop.weightKg === null ? 'Svoris nežinomas' : `${formatWeightKg(stop.weightKg)} kg`}</Text>
              <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded ? (
              <>
                <Text style={styles.eta}>{etaLabel(stop)}</Text>
                <Text style={styles.meta}>{legLabel(stop)}</Text>
                {windowLabel(stop, route?.planningMode ?? null) ? <Text style={route?.planningMode === 'ignore_time_windows' ? styles.informational : styles.meta}>{windowLabel(stop, route?.planningMode ?? null)}</Text> : null}
                {userVisibleStopNote(stop.notes) ? <Text style={styles.notes}>Pastabos: {userVisibleStopNote(stop.notes)}</Text> : null}
                {markedNotLoaded ? <Text style={styles.notLoadedReason}>Nepakrauta: {stop.failureReason}</Text> : null}
                <View style={styles.loadingActions}>
                  <Pressable style={[styles.loadButton, stop.loadingStatus === 'loaded' && styles.loadedButton]} onPress={() => stop.loadingStatus === 'loaded' ? markUnloaded(stop.id) : markLoaded(stop.id)}>
                    <Text style={styles.loadButtonText}>{stop.loadingStatus === 'loaded' ? 'Atžymėti' : markedNotLoaded ? 'Pakrauti vis tiek' : 'Pakrauta'}</Text>
                  </Pressable>
                  {stop.loadingStatus === 'pending' ? (
                    <Pressable style={styles.notLoadedButton} onPress={() => beginNotLoaded(stop.id)}>
                      <Text style={styles.notLoadedButtonText}>{markedNotLoaded ? 'Keisti priežastį' : 'Nepakrauta'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}
          </SwipeActionCard>
        );
      })}
      <Modal animationType="fade" transparent visible={odometerModalVisible && route?.status === 'loaded'} onRequestClose={() => setOdometerModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop} testID="start-odometer-modal">
          <View style={styles.odometerDialog}>
            <Text style={styles.dialogTitle}>Pradinis odometras</Text>
            <Text style={styles.dialogText}>Įveskite rodmenį prieš pradėdami maršrutą arba pasirinkite „Įvesiu vėliau“.</Text>
            <TextInput value={odometer} onChangeText={setOdometer} keyboardType="decimal-pad" placeholder="Pvz. 125430,5" style={styles.input} autoFocus />
            <Pressable style={styles.secondaryButton} onPress={() => { void saveOdometer(); }}><Text style={styles.secondaryText}>Išsaugoti odometrą</Text></Pressable>
            <Pressable style={styles.linkButton} onPress={() => { void skipOdometer(); }}><Text style={styles.linkText}>Įvesiu vėliau</Text></Pressable>
            <Pressable disabled={route?.startOdometer === null && !route?.startOdometerSkippedAt} style={[styles.primaryButton, route?.startOdometer === null && !route?.startOdometerSkippedAt && styles.disabled]} onPress={() => { void startRoute(); }}>
              <Text style={styles.primaryText}>Pradėti maršrutą</Text>
            </Pressable>
            <Pressable style={styles.modalCloseButton} onPress={() => setOdometerModalVisible(false)}><Text style={styles.modalCloseText}>Uždaryti</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="fade" transparent visible={notLoadedStopId !== null} onRequestClose={() => setNotLoadedStopId(null)}>
        <View style={styles.modalBackdrop} testID="loading-failure-modal">
          <View style={styles.failureDialog}>
            <Text style={styles.dialogTitle}>Kodėl krovinys nepakrautas?</Text>
            <Text style={styles.dialogText}>Pasirinkimas išsaugomas prie šio taško ir bus matomas istorijoje.</Text>
            {LOADING_FAILURE_REASONS.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => setNotLoadedReason(reason)}
                style={[styles.reasonButton, notLoadedReason === reason && styles.reasonButtonActive]}>
                <Text style={[styles.reasonText, notLoadedReason === reason && styles.reasonTextActive]}>{reason}</Text>
              </Pressable>
            ))}
            <View style={styles.dialogActions}>
              <Pressable disabled={bulkBusy} onPress={() => void saveNotLoaded()} style={[styles.dialogSave, bulkBusy && styles.disabled]}>
                <Text style={styles.loadButtonText}>Išsaugoti</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={() => setNotLoadedStopId(null)} style={styles.dialogCancel}>
                <Text style={styles.secondaryText}>Atšaukti</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  plannedSummary: { padding: spacing.lg, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent, gap: spacing.sm },
  summary: { padding: spacing.lg, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.xs, shadowColor: '#183525', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.09, shadowRadius: 14, elevation: 3 },
  summaryTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.heading },
  summaryText: { color: colors.textMuted, lineHeight: 20 },
  notLoadedSummary: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  markAllButton: { minHeight: 52, borderRadius: 14, backgroundColor: colors.brandNavy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  markAllText: { color: '#fff', fontSize: 16, fontFamily: fonts.heading, textAlign: 'center' },
  allLoadedState: { minHeight: 52, borderRadius: 14, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  allLoadedText: { color: colors.accent, fontSize: 16, fontFamily: fonts.heading, textAlign: 'center' },
  card: { padding: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs, shadowColor: '#183525', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  loadedCard: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  notLoadedCard: { borderColor: colors.danger, backgroundColor: '#FFF5F3' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  cardHeaderText: { flex: 1, minWidth: 0 },
  chevron: { color: colors.textMuted, fontSize: 16, fontFamily: fonts.heading },
  address: { color: colors.text, fontSize: 16, fontFamily: fonts.heading },
  weight: { color: colors.text, fontSize: 16, fontFamily: fonts.headingSemiBold },
  eta: { color: colors.accent, fontSize: 16, fontFamily: fonts.heading },
  meta: { color: colors.textMuted, lineHeight: 19 },
  informational: { color: colors.textMuted, opacity: 0.7, lineHeight: 19 },
  notes: { color: colors.text, lineHeight: 19 },
  loadingActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  loadButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  loadedButton: { opacity: 0.65 },
  loadButtonText: { color: '#fff', fontFamily: fonts.heading },
  notLoadedButton: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  notLoadedButtonText: { color: colors.danger, fontFamily: fonts.heading, textAlign: 'center' },
  notLoadedReason: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  reverseButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  reverseText: { color: colors.accent, fontFamily: fonts.heading },
  undoButton: { minHeight: 46, borderWidth: 2, borderColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.warning, fontFamily: fonts.heading },
  odometerCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: 20, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.background, fontFamily: fonts.body },
  secondaryButton: { minHeight: 56, borderRadius: 14, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.accent, fontFamily: fonts.heading, fontSize: 16 },
  linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.textMuted, fontFamily: fonts.headingSemiBold },
  primaryButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.brandNavy, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontFamily: fonts.heading, fontSize: 16 },
  cancelRouteButton: { minHeight: 56, borderRadius: 14, borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  cancelRouteText: { color: colors.danger, fontFamily: fonts.heading, fontSize: 16 },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  modalBackdrop: { flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
  failureDialog: { width: '100%', maxWidth: 430, padding: spacing.lg, borderRadius: 22, backgroundColor: colors.surface, gap: spacing.sm },
  odometerDialog: { width: '100%', maxWidth: 430, padding: spacing.lg, borderRadius: 22, backgroundColor: colors.surface, gap: spacing.sm },
  modalCloseButton: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: colors.textMuted, fontFamily: fonts.headingSemiBold },
  dialogTitle: { color: colors.text, fontSize: 21, fontFamily: fonts.heading },
  dialogText: { color: colors.textMuted, lineHeight: 20, marginBottom: spacing.xs },
  reasonButton: { minHeight: 50, paddingHorizontal: spacing.md, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, justifyContent: 'center' },
  reasonButtonActive: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  reasonText: { color: colors.text, fontFamily: fonts.headingSemiBold },
  reasonTextActive: { color: colors.accent },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  dialogSave: { flex: 1, minHeight: 50, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  dialogCancel: { flex: 1, minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
