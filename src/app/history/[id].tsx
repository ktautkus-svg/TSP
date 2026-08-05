import { useCallback, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { ShipmentLinesSummary } from '@/components/shipment-lines-summary';
import { ExportPilotRouteDiagnostic } from '@/application/routes/pilot-route-export';
import { resolveRoute } from '@/application/routes/route-navigation';
import { RouteRepository } from '@/database/repositories/route-repository';
import { ShipmentLineRepository } from '@/database/repositories/shipment-line-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import type { ShipmentLine } from '@/domain/shipment-line';
import { deliveryStatusLabel, formatLithuanianDateTime, loadingStatusLabel } from '@/ui/history-labels';
import { colors, spacing } from '@/ui/tokens';
import { Alert } from '@/ui/alert';

type Audit = Awaited<ReturnType<RouteRepository['listAudit']>>[number];

export default function RouteHistoryDetailScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const shipmentRepository = useMemo(() => new ShipmentLineRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [shipmentLines, setShipmentLines] = useState<Map<string, ShipmentLine[]>>(new Map());
  const [audit, setAudit] = useState<Audit[]>([]);
  const [exporting, setExporting] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([repository.getWithStops(routeId), repository.listAudit(routeId), shipmentRepository.getGroupedByStop(routeId)]).then(([persisted, entries, lines]) => {
      if (!mounted) return;
      if (persisted && persisted.route.status !== 'completed') {
        const destination = resolveRoute(persisted.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      setRoute(persisted?.route ?? null);
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
          <Text style={styles.headerText}>{showTechnical ? 'Slėpti' : 'Rodyti'}</Text>
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
    </>
  );
}

const styles = StyleSheet.create({
  summary: { padding: spacing.md, borderRadius: 16, backgroundColor: colors.primarySoft, gap: spacing.xs },
  card: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.textMuted, lineHeight: 20 },
  failure: { color: colors.danger, fontWeight: '700', lineHeight: 20 },
  audit: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  exportButton: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  exportButtonText: { color: colors.surface, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  technicalToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyButton: { minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  historyText: { color: '#fff', fontWeight: '800' },
  homeButton: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  homeText: { color: colors.primary, fontWeight: '800' },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.primary, fontWeight: '800' },
});
