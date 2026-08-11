import { useCallback, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { RouteBottomTabs } from '@/components/route-bottom-tabs';
import { ShipmentLinesSummary } from '@/components/shipment-lines-summary';
import { ExportPilotRouteDiagnostic } from '@/application/routes/pilot-route-export';
import { resolveRoute } from '@/application/routes/route-navigation';
import { RouteRepository } from '@/database/repositories/route-repository';
import { ShipmentLineRepository } from '@/database/repositories/shipment-line-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import type { ShipmentLine } from '@/domain/shipment-line';
import { deliveryStatusLabel, formatLithuanianDateTime, loadingStatusLabel } from '@/ui/history-labels';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';

type Audit = Awaited<ReturnType<RouteRepository['listAudit']>>[number];

export default function RouteHistoryDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const shipmentRepository = useMemo(() => new ShipmentLineRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [shipmentLines, setShipmentLines] = useState<Map<string, ShipmentLine[]>>(new Map());
  const [audit, setAudit] = useState<Audit[]>([]);
  const [exporting, setExporting] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([repository.getWithStops(routeId), repository.listAudit(routeId), shipmentRepository.getGroupedByStop(routeId), repository.getActive()]).then(([persisted, entries, lines, active]) => {
      if (!mounted) return;
      if (persisted && persisted.route.status !== 'completed') {
        const destination = resolveRoute(persisted.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      setRoute(persisted?.route ?? null);
      setActiveRoute(active);
      setStops(persisted?.stops ?? []);
      setShipmentLines(lines);
      setAudit(entries);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('ROUTE_HISTORY_DETAIL_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Maršruto istorijos atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [repository, routeId, router, shipmentRepository]));

  const goHistory = () => router.replace('/history' as Href);
  const goHome = () => router.replace('/' as Href);
  const goActiveDashboard = () => {
    if (!activeRoute) return goHome();
    const destination = resolveRoute(activeRoute);
    router.replace({ pathname: destination.pathname, params: destination.params } as Href);
  };
  const goActiveStops = () => {
    if (!activeRoute) return goHome();
    if (activeRoute.status === 'in_progress') {
      router.replace({ pathname: '/route/[id]/delivery', params: { id: activeRoute.id, view: 'stops' } } as unknown as Href);
      return;
    }
    goActiveDashboard();
  };

  const exportPilotDiagnostic = async () => {
    if (exporting || !route) return;
    setExporting(true);
    try {
      const report = await new ExportPilotRouteDiagnostic(db).executeJson(
        route.id,
        Constants.expoConfig?.version ?? 'unknown',
      );
      await Share.share({ title: `Maršruto ${route.id} diagnostika`, message: report });
    } catch (error) {
      Alert.alert('Eksportas nepavyko', error instanceof Error ? error.message : 'Nežinoma klaida.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={goHistory} style={styles.headerAction}><Text style={styles.headerText}>← Istorija</Text></Pressable>,
    }} />
    <View style={styles.screen}>
    <FoundationScreen showFoundationNotice={false} title={route ? `Maršrutas ${route.date}` : 'Maršruto istorija'} description="Užbaigto maršruto istorija yra tik skaitoma.">
      {error ? <Text style={styles.failure}>{error}</Text> : null}
      {!route ? <View style={styles.card}><Text style={styles.title}>Maršrutas nerastas</Text><Text style={styles.meta}>Galite grįžti į istoriją arba pradžią.</Text></View> : null}
      {route ? <>
      <View style={styles.summary} testID="history-detail">
        <Text style={styles.title}>{route.status === 'completed' ? 'Užbaigtas' : 'Atšauktas'}</Text>
        <Text style={styles.meta}>Pradžia: {route.startLocation?.normalizedAddress ?? route.startLocation?.originalAddress ?? '—'}</Text>
        <Text style={styles.meta}>Pabaiga: {route.endLocation?.normalizedAddress ?? route.endLocation?.originalAddress ?? '—'}</Text>
        <Text style={styles.meta}>Laikas: {formatLithuanianDateTime(route.startedAt)} – {formatLithuanianDateTime(route.completedAt ?? route.cancelledAt)}</Text>
        <Text style={styles.meta}>Odometras: {route.startOdometer ?? 'neįvestas'} – {route.endOdometer ?? 'neįvestas'}</Text>
        <Text style={styles.meta}>Atstumas: planuota {route.estimatedDistanceKm?.toFixed(1) ?? '—'} km · faktinė {route.actualDistanceKm?.toFixed(1) ?? '—'} km</Text>
        {route.completionSummary ? (
          <View style={styles.reportBlock} testID="completion-report">
            <Text style={styles.reportTitle}>Užbaigimo ataskaita</Text>
            <Text style={styles.meta}>Pristatyta: {route.completionSummary.deliveredStops} · Nepavyko: {route.completionSummary.failedStops}</Text>
            <Text style={styles.meta}>Laiku: {route.completionSummary.onTimeStops} · Vėlavo: {route.completionSummary.lateStops}</Text>
            <Text style={styles.meta}>
              Trukmė: planuota {route.completionSummary.plannedDurationMinutes ?? '—'} min · faktinė {route.completionSummary.actualDurationMinutes ?? '—'} min
              {route.completionSummary.durationDeviationMinutes == null
                ? ''
                : ` (${route.completionSummary.durationDeviationMinutes > 0 ? '+' : ''}${route.completionSummary.durationDeviationMinutes} min)`}
            </Text>
            <Text style={styles.meta}>
              Km nuokrypis: {route.completionSummary.distanceDeviationKm == null
                ? '—'
                : `${route.completionSummary.distanceDeviationKm > 0 ? '+' : ''}${route.completionSummary.distanceDeviationKm.toFixed(1)} km`}
            </Text>
          </View>
        ) : null}
      </View>
      {stops.map((stop) => (
        <View key={stop.id} style={styles.card}>
          <Text style={styles.title}>#{stop.activeOrder ?? stop.originalOrder} · {stop.recipient || 'Gavėjas nenurodytas'}</Text>
          <Text style={styles.meta}>{stop.normalizedAddress ?? stop.originalAddress}</Text>
          <Text style={styles.meta}>{loadingStatusLabel(stop.loadingStatus)}: {formatLithuanianDateTime(stop.loadedAt)}</Text>
          <Text style={styles.meta}>Būsena: {deliveryStatusLabel(stop.deliveryStatus)}</Text>
          {stop.deliveredAt ? <Text style={styles.meta}>Pristatyta: {formatLithuanianDateTime(stop.deliveredAt)}</Text> : null}
          {stop.failedAt ? <Text style={styles.meta}>Nepavyko: {formatLithuanianDateTime(stop.failedAt)}</Text> : null}
          {stop.failureComment ? <Text style={styles.failure}>Komentaras: {stop.failureReason ? `${stop.failureReason}. ` : ''}{stop.failureComment}</Text> : null}
          <ShipmentLinesSummary lines={shipmentLines.get(stop.id) ?? []} />
        </View>
      ))}
      <View style={styles.card} testID="technical-information">
        <Pressable onPress={() => setShowTechnical((current) => !current)} style={styles.technicalToggle}>
          <Text style={styles.title}>Techninė informacija</Text>
          <Text style={styles.technicalText}>{showTechnical ? 'Slėpti' : 'Rodyti'}</Text>
        </Pressable>
        {showTechnical ? audit.map((entry) => {
          const failure = entry.actionType === 'stop_failed' && entry.after && typeof entry.after === 'object'
            ? entry.after as { failureReason?: string; failureComment?: string }
            : null;
          return <Text key={entry.id} style={styles.audit}>{formatLithuanianDateTime(entry.createdAt)} · {entry.actionType}{entry.undoneAt ? ' · atšaukta' : ''}{failure ? ` · ${failure.failureReason ?? ''}${failure.failureComment ? `: ${failure.failureComment}` : ''}` : ''}</Text>;
        }) : <Text style={styles.meta}>Audito įrašai paslėpti.</Text>}
      </View>
      {__DEV__ || process.env.EXPO_PUBLIC_PILOT_MODE === '1' ? (
        <Pressable
          accessibilityRole="button"
          disabled={exporting}
          onPress={() => void exportPilotDiagnostic()}
          style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}
          testID="pilot-route-export"
        >
          <Text style={styles.exportButtonText}>
            {exporting ? 'Ruošiama…' : 'Eksportuoti piloto diagnostiką'}
          </Text>
        </Pressable>
      ) : null}
      </> : null}
      <Pressable style={styles.historyButton} onPress={goHistory}><Text style={styles.historyText}>← Istorija</Text></Pressable>
      <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
    </FoundationScreen>
    <RouteBottomTabs active="history" onDashboard={goActiveDashboard} onStops={goActiveStops} onHistory={goHistory} />
    </View>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 900, backgroundColor: colors.background },
  summary: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  title: { ...type.sectionTitle, color: colors.text },
  reportBlock: { marginTop: spacing.sm, gap: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  reportTitle: { ...type.cardTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  failure: { ...type.secondaryStrong, color: colors.danger },
  audit: { ...type.meta, color: colors.textMuted },
  exportButton: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionRoute },
  exportButtonText: { ...type.button, color: colors.textInverse },
  pressed: { opacity: 0.75 },
  technicalToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  technicalText: { ...type.button, color: colors.info },
  historyButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  historyText: { ...type.button, color: colors.textInverse },
  homeButton: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  homeText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.textInverse },
});
