import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pullAssignedRoutes } from '@/application/auth/route-assignment-sync';
import { ReopenRouteForPlanning } from '@/application/routes/route-commands';
import { resolveRoute } from '@/application/routes/route-navigation';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/app-icons';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';

export default function RouteOverviewScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { profile, online } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showStops, setShowStops] = useState(false);

  const load = useCallback(async () => {
    if (online && profile.role === 'driver') {
      await pullAssignedRoutes(db, profile).catch((reason) => {
        if (__DEV__) console.warn('ROUTE_OVERVIEW_PULL_FAILED', reason);
      });
    }
    return repository.getWithStops(routeId);
  }, [db, online, profile, repository, routeId]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void load().then((persisted) => {
      if (!mounted) return;
      setRoute(persisted?.route ?? null);
      setStops(persisted?.stops ?? []);
      setError(persisted ? null : 'Maršrutas nerastas.');
    }).catch((reason) => mounted && setError(reason instanceof Error ? reason.message : 'Maršruto atkurti nepavyko.'));
    return () => { mounted = false; };
  }, [load]));

  useEffect(() => {
    const timer = setInterval(() => {
      void load().then((persisted) => {
        if (!persisted) return;
        setRoute(persisted.route);
        setStops(persisted.stops);
      });
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const begin = () => {
    if (!route) return;
    const destination = resolveRoute(route);
    router.replace({ pathname: destination.pathname, params: destination.params } as Href);
  };
  const editOrder = async () => {
    if (!route) return;
    if (route.status === 'planned') {
      try {
        await new ReopenRouteForPlanning(db).execute(route.id);
        await requestSync('mutation');
        router.replace({ pathname: '/route/[id]/alternatives', params: { id: route.id } } as Href);
      } catch (reason) {
        Alert.alert('Eiliškumo redagavimas neatidarytas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
      }
      return;
    }
    const destination = resolveRoute(route);
    router.replace({ pathname: destination.pathname, params: { ...destination.params, view: 'stops' } } as Href);
  };
  const canEditOrder = profile.role !== 'driver' || profile.permissions?.canReorderAssignedRoute;
  const terminal = route ? ['completed', 'cancelled'].includes(route.status) : false;

  return <View style={styles.screen}>
    <Stack.Screen options={{ gestureEnabled: false, title: 'Maršruto informacija' }} />
    <FoundationScreen showFoundationNotice={false} title="Maršruto informacija" description="Prieš pradėdami peržiūrėkite visą eigą ir taškų eiliškumą.">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {route ? <>
        <View style={styles.hero}>
          <View style={styles.heroHeading}><Text style={styles.routeDate}>{route.date}</Text><Text style={styles.status}>{statusLabel(route.status)}</Text></View>
          <View style={styles.metrics}>
            <Metric label="SVORIS" value={`${formatWeightKg(route.totalWeightKg)} kg`} styles={styles} />
            <Metric label="TAŠKAI" value={String(route.totalStops)} styles={styles} />
            <Metric label="ATSTUMAS" value={route.estimatedDistanceKm === null ? '—' : `${route.estimatedDistanceKm.toFixed(1)} km`} styles={styles} />
            <Metric label="TRUKMĖ" value={route.estimatedDurationMinutes === null ? '—' : formatDuration(route.estimatedDurationMinutes)} styles={styles} />
          </View>
          <Text style={styles.direction}>Kryptis: {route.startLocation?.normalizedAddress ?? route.startLocation?.originalAddress ?? '—'} → {route.endLocation?.normalizedAddress ?? route.endLocation?.originalAddress ?? '—'}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={begin}><Text style={styles.primaryText}>{terminal ? 'Peržiūrėti rezultatą' : route.status === 'in_progress' ? 'Tęsti maršrutą' : 'Pradėti maršrutą'}</Text></Pressable>
          {canEditOrder && !['completed', 'cancelled'].includes(route.status) ? <Pressable style={styles.secondaryButton} onPress={() => void editOrder()} testID="edit-route-order"><Text style={styles.secondaryText}>Redaguoti eiliškumą</Text></Pressable> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showStops }}
          onPress={() => setShowStops((current) => !current)}
          style={styles.orderHeader}
          testID="toggle-route-stops">
          <View style={styles.orderHeaderCopy}>
            <Text style={styles.sectionLabel}>VISAS EILIŠKUMAS</Text>
            <Text style={styles.orderSummary}>{stops.length} pristatymo taškų · {showStops ? 'išskleista' : 'suskleista'}</Text>
          </View>
          {showStops ? <ChevronDownIcon color={colors.textMuted} /> : <ChevronRightIcon color={colors.textMuted} />}
        </Pressable>
        {showStops ? stops.map((stop, index) => <View key={stop.id} style={styles.stop}>
          <View style={styles.stopNumber}><Text style={styles.stopNumberText}>{index + 1}</Text></View>
          <View style={styles.stopCopy}><Text style={styles.stopTitle}>{stop.recipient || stop.normalizedAddress || stop.originalAddress}</Text><Text style={styles.stopAddress}>{stop.normalizedAddress ?? stop.originalAddress}</Text></View>
          <View style={styles.stopMeta}><Text style={styles.stopWeight}>{stop.weightKg === null ? '—' : `${formatWeightKg(stop.weightKg)} kg`}</Text><Text style={styles.stopTime}>{timeWindow(stop)}</Text></View>
        </View>) : null}
      </> : null}
    </FoundationScreen>
    {profile.role === 'driver' ? <DriverAppTabs active="routes" /> : null}
  </View>;
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}
function statusLabel(status: Route['status']): string { return ({ draft: 'Ruošiamas', planned: 'Suplanuotas', loading: 'Kraunamas', loaded: 'Paruoštas', in_progress: 'Vykdomas', completed: 'Užbaigtas', cancelled: 'Atšauktas' })[status]; }
function formatDuration(minutes: number): string { const hours = Math.floor(minutes / 60); const rest = Math.round(minutes % 60); return hours ? `${hours} val. ${rest} min.` : `${rest} min.`; }
function timeWindow(stop: DeliveryStop): string { return stop.deliveryTimeFrom && stop.deliveryTimeTo ? `${stop.deliveryTimeFrom}–${stop.deliveryTimeTo}` : 'Laikas laisvas'; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 720, backgroundColor: colors.background },
  headerAction: { minWidth: 110, minHeight: 44, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  error: { ...type.bodyStrong, color: colors.danger },
  hero: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  heroHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, routeDate: { ...type.pageTitle, color: colors.text }, status: { ...type.label, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, overflow: 'hidden' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, flexBasis: 125, minWidth: 0, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, gap: 3 }, metricLabel: { ...type.label, color: colors.textSecondary }, metricValue: { ...type.readout, fontSize: 20, lineHeight: 25, color: colors.text }, direction: { ...type.meta, color: colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, primaryButton: { flex: 1, minWidth: 180, minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' }, primaryText: { ...type.button, color: colors.textInverse }, secondaryButton: { flex: 1, minWidth: 180, minHeight: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, secondaryText: { ...type.button, color: colors.text },
  orderHeader: { minHeight: 58, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  orderHeaderCopy: { flex: 1, minWidth: 0 },
  sectionLabel: { ...type.label, color: colors.textMuted },
  orderSummary: { ...type.secondary, color: colors.textSecondary, marginTop: 2 },
  stop: { minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, stopNumber: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.infoSoft, alignItems: 'center', justifyContent: 'center' }, stopNumberText: { ...type.bodyStrong, color: colors.info }, stopCopy: { flex: 1, minWidth: 0, gap: 3 }, stopTitle: { ...type.bodyStrong, color: colors.text }, stopAddress: { ...type.secondary, color: colors.textMuted }, stopMeta: { alignItems: 'flex-end', gap: 3 }, stopWeight: { ...type.bodyStrong, color: colors.text }, stopTime: { ...type.meta, color: colors.textMuted },
});
