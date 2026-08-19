import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pullAssignedRoutes, pushRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { DEFAULT_ROUTE_PRICE_SETTINGS, estimatePreliminaryRoutePrice, normalizeRoutePriceSettings, type RoutePriceSettings } from '@/application/routes/route-price';
import { ReopenRouteForPlanning } from '@/application/routes/route-commands';
import { resolveRoute } from '@/application/routes/route-navigation';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/app-icons';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { employeeApi, type ServerRouteAssignment } from '@/infrastructure/auth/employee-session';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';
import { ReorderRemainingStops } from '@/application/routes/route-workday';
import { ManualRouteOrderList } from '@/components/manual-route-order-list';
import { RouteMapView } from '@/components/route-map';
import { devWarn } from '@/ui/dev-log';

export default function RouteOverviewScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '', mode, edit } = useLocalSearchParams<{ id: string; mode?: string; edit?: string }>();
  const { profile, online } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showStops, setShowStops] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const requestedEditorRef = useRef(false);
  const [assignment, setAssignment] = useState<ServerRouteAssignment | null>(null);
  const [priceSettings, setPriceSettings] = useState<RoutePriceSettings>(() => normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS));
  const managementMode = mode === 'management' && ['admin', 'dispatcher'].includes(profile.role);

  const load = useCallback(async () => {
    if (online && profile.role === 'driver') {
      await pullAssignedRoutes(db, profile).catch((reason) => {
        devWarn('ROUTE_OVERVIEW_PULL_FAILED', reason);
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

  useFocusEffect(useCallback(() => {
    if (!managementMode || !online) return () => undefined;
    let mounted = true;
    void Promise.all([
      employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
      employeeApi<{ settings: RoutePriceSettings }>('/api/admin/route-price-settings'),
    ]).then(([assignmentResponse, settingsResponse]) => {
      if (!mounted) return;
      setAssignment(assignmentResponse.assignments.find((item) => item.routeId === routeId && item.status !== 'cancelled') ?? null);
      setPriceSettings(normalizeRoutePriceSettings(settingsResponse.settings));
    }).catch((reason) => mounted && setError(reason instanceof Error ? reason.message : 'Priskyrimo duomenų gauti nepavyko.'));
    return () => { mounted = false; };
  }, [managementMode, online, routeId]));

  const begin = () => {
    if (!route) return;
    const destination = resolveRoute(route);
    router.replace({ pathname: destination.pathname, params: destination.params } as Href);
  };
  const editOrder = useCallback(async () => {
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
    if (route.status === 'in_progress') {
      const pending = stops.filter((stop) => stop.deliveryStatus === 'pending');
      if (pending.length < 2) {
        Alert.alert('Eiliškumo keisti nereikia', 'Liko mažiau nei du nepristatyti taškai.');
        return;
      }
      setPendingOrder(pending.map((stop) => stop.id));
      setEditingOrder(true);
    }
  }, [db, requestSync, route, router, stops]);
  useEffect(() => {
    if (edit !== 'order' || !route || stops.length === 0 || requestedEditorRef.current) return;
    requestedEditorRef.current = true;
    void editOrder();
  }, [edit, editOrder, route, stops.length]);
  const movePendingStop = (stopId: string, targetIndex: number) => {
    setPendingOrder((current) => {
      const index = current.indexOf(stopId);
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      next.splice(index, 1);
      next.splice(targetIndex, 0, stopId);
      return next;
    });
  };
  const savePendingOrder = async () => {
    if (!route || savingOrder) return;
    setSavingOrder(true);
    try {
      await new ReorderRemainingStops(db).execute(route.id, pendingOrder);
      await pushRouteAssignmentProgress(db, route.id).catch((reason) => {
        if (__DEV__) console.error('ROUTE_ORDER_PROGRESS_PUSH_FAILED', reason);
      });
      await requestSync('mutation');
      const persisted = await repository.getWithStops(route.id);
      setRoute(persisted?.route ?? route);
      setStops(persisted?.stops ?? stops);
      setEditingOrder(false);
      setShowStops(true);
    } catch (reason) {
      Alert.alert('Eiliškumo išsaugoti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setSavingOrder(false);
    }
  };
  const canEditOrder = profile.role !== 'driver' || profile.permissions?.canReorderAssignedRoute;
  const terminal = route ? ['completed', 'cancelled'].includes(route.status) : false;
  const orderMap = useMemo(() => buildOrderMap(route, stops, pendingOrder), [pendingOrder, route, stops]);
  const preliminaryPrice = route && assignment?.vehicle ? estimatePreliminaryRoutePrice({
    date: route.date,
    distanceKm: route.estimatedDistanceKm,
    weightKg: route.totalWeightKg,
    stops: route.totalStops,
    driverName: assignment.driverName,
    vehicle: assignment.vehicle,
  }, priceSettings) : null;

  return <View style={styles.screen}>
    <Stack.Screen options={{ gestureEnabled: false, title: 'Maršruto informacija' }} />
    <FoundationScreen showFoundationNotice={false} title="Maršruto informacija" description={managementMode ? 'Tik peržiūra: maršruto duomenys, priskyrimas, būsena, kaina ir taškų eiliškumas.' : 'Prieš pradėdami peržiūrėkite visą eigą ir taškų eiliškumą.'}>
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
        {managementMode ? <View style={styles.managementSummary} testID="management-route-summary">
          <View style={styles.managementItem}><Text style={styles.sectionLabel}>VAIRUOTOJAS</Text><Text style={styles.managementValue}>{assignment?.driverName ?? 'Nepriskirtas'}</Text></View>
          <View style={styles.managementItem}><Text style={styles.sectionLabel}>AUTOMOBILIS</Text><Text style={styles.managementValue}>{assignment?.vehicle ? `${assignment.vehicle.registrationNumber} · ${assignment.vehicle.model}` : 'Nepriskirtas'}</Text></View>
          <View style={styles.managementItem}><Text style={styles.sectionLabel}>PERDAVIMO BŪSENA</Text><Text style={styles.managementValue}>{assignment ? assignmentStatusLabel(assignment.status) : 'Dar nepriskirtas'}</Text></View>
          <View style={styles.managementItem}><Text style={styles.sectionLabel}>PRELIMINARI KAINA</Text><Text style={styles.managementValue}>{preliminaryPrice ? formatMoney(preliminaryPrice.totalEur) : 'Bus rodoma priskyrus vairuotoją ir automobilį'}</Text></View>
        </View> : null}
        <View style={styles.actions}>
          {!managementMode ? <Pressable style={styles.primaryButton} onPress={begin}><Text style={styles.primaryText}>{terminal ? 'Peržiūrėti rezultatą' : route.status === 'in_progress' ? 'Tęsti maršrutą' : 'Pradėti maršrutą'}</Text></Pressable> : null}
          {!managementMode && canEditOrder && ['planned', 'in_progress'].includes(route.status) ? <Pressable style={styles.secondaryButton} onPress={() => void editOrder()} testID="edit-route-order"><Text style={styles.secondaryText}>Redaguoti eiliškumą</Text></Pressable> : null}
        </View>
        {editingOrder ? <View style={styles.orderEditor} testID="active-route-order-editor">
          <View style={styles.orderEditorHeading}>
            <View style={styles.orderHeaderCopy}>
              <Text style={styles.sectionLabel}>LIKĘ NEPRISTATYTI TAŠKAI</Text>
              <Text style={styles.orderEditorTitle}>Pakeiskite eiliškumą</Text>
              <Text style={styles.orderSummary}>Tempkite už rankenėlės arba naudokite rodykles. Jau užbaigti taškai nekeičiami.</Text>
            </View>
            <Pressable accessibilityLabel="Uždaryti eiliškumo redagavimą" onPress={() => setEditingOrder(false)} style={styles.editorClose}><Text style={styles.editorCloseText}>×</Text></Pressable>
          </View>
          <ManualRouteOrderList
            items={pendingOrder.map((stopId) => stops.find((stop) => stop.id === stopId)).filter((stop): stop is DeliveryStop => Boolean(stop)).map((stop) => ({
              id: stop.id,
              label: stop.recipient || stop.normalizedAddress || stop.originalAddress,
              address: stop.normalizedAddress ?? stop.originalAddress,
              weightKg: stop.weightKg,
            }))}
            priorityIds={new Set<string>()}
            onTogglePriority={() => undefined}
            onMove={movePendingStop}
            showPriority={false}
          />
          <View style={styles.orderEditorActions}>
            <Pressable disabled={savingOrder} onPress={() => setEditingOrder(false)} style={styles.editorSecondary}><Text style={styles.secondaryText}>Atšaukti</Text></Pressable>
            <Pressable disabled={savingOrder} onPress={() => { void savePendingOrder(); }} style={[styles.editorPrimary, savingOrder && styles.disabled]} testID="save-active-route-order">
              {savingOrder ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Išsaugoti eiliškumą</Text>}
            </Pressable>
          </View>
          {orderMap ? <View style={styles.orderMap} testID="active-route-order-map">
            <RouteMapView
              allowStraightLineFallback
              endLocation={orderMap.end}
              orderedStops={orderMap.stops}
              startLocation={orderMap.start}
            />
          </View> : <Text style={styles.orderSummary}>Žemėlapis bus rodomas, kai maršruto taškai turės koordinates.</Text>}
        </View> : null}
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
function assignmentStatusLabel(status: ServerRouteAssignment['status']): string { return ({ assigned: 'Priskirtas', downloaded: 'Atsisiųstas įrenginyje', in_progress: 'Vykdomas', completed: 'Užbaigtas', cancelled: 'Atšauktas' })[status]; }
function formatDuration(minutes: number): string { const hours = Math.floor(minutes / 60); const rest = Math.round(minutes % 60); return hours ? `${hours} val. ${rest} min.` : `${rest} min.`; }
function formatMoney(value: number): string { return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }
function timeWindow(stop: DeliveryStop): string { return stop.deliveryTimeFrom && stop.deliveryTimeTo ? `${stop.deliveryTimeFrom}–${stop.deliveryTimeTo}` : 'Laikas laisvas'; }

function buildOrderMap(route: Route | null, stops: DeliveryStop[], orderedIds: string[]) {
  if (!route?.startLocation || !route.endLocation) return null;
  const start = routingEndpoint('start', 'Startas', route.startLocation);
  const end = routingEndpoint('end', 'Grįžimas', route.endLocation);
  if (!start || !end) return null;
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const orderedStops = orderedIds.flatMap((id) => {
    const stop = byId.get(id);
    if (!stop || !Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return [];
    return [{
      id: stop.id,
      label: stop.recipient || stop.normalizedAddress || stop.originalAddress,
      address: stop.normalizedAddress ?? stop.originalAddress,
      latitude: stop.latitude as number,
      longitude: stop.longitude as number,
    }];
  });
  return { start, end, stops: orderedStops };
}

function routingEndpoint(id: string, fallbackLabel: string, endpoint: NonNullable<Route['startLocation']>) {
  if (!Number.isFinite(endpoint.latitude) || !Number.isFinite(endpoint.longitude)) return null;
  return {
    id,
    label: endpoint.normalizedAddress || endpoint.originalAddress || fallbackLabel,
    address: endpoint.originalAddress,
    latitude: endpoint.latitude as number,
    longitude: endpoint.longitude as number,
  };
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 720, backgroundColor: colors.background },
  headerAction: { minWidth: 110, minHeight: 44, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  error: { ...type.bodyStrong, color: colors.danger },
  hero: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  heroHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, routeDate: { ...type.pageTitle, color: colors.text }, status: { ...type.label, color: colors.info, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, overflow: 'hidden' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, flexBasis: 125, minWidth: 0, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, gap: 3 }, metricLabel: { ...type.label, color: colors.textSecondary }, metricValue: { ...type.readout, fontSize: 20, lineHeight: 25, color: colors.text }, direction: { ...type.meta, color: colors.textMuted },
  managementSummary: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  managementItem: { flexGrow: 1, flexBasis: 220, minWidth: 0, gap: 4 },
  managementValue: { ...type.bodyStrong, color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, primaryButton: { flex: 1, minWidth: 180, minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' }, primaryText: { ...type.button, color: colors.textInverse }, secondaryButton: { flex: 1, minWidth: 180, minHeight: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, secondaryText: { ...type.button, color: colors.text },
  orderEditor: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.surface, gap: spacing.md },
  orderEditorHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  orderEditorTitle: { ...type.sectionTitle, color: colors.text, marginTop: 2 },
  orderMap: { overflow: 'hidden', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, gap: spacing.xs, padding: spacing.sm },
  editorClose: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  editorCloseText: { ...type.sectionTitle, color: colors.textSecondary, fontSize: 24 },
  orderEditorActions: { flexDirection: 'row', gap: spacing.sm },
  editorSecondary: { flex: 1, minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  editorPrimary: { flex: 1, minHeight: 50, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  orderHeader: { minHeight: 58, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  orderHeaderCopy: { flex: 1, minWidth: 0 },
  sectionLabel: { ...type.label, color: colors.textMuted },
  orderSummary: { ...type.secondary, color: colors.textSecondary, marginTop: 2 },
  stop: { minHeight: 68, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, stopNumber: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.infoSoft, alignItems: 'center', justifyContent: 'center' }, stopNumberText: { ...type.bodyStrong, color: colors.info }, stopCopy: { flex: 1, minWidth: 0, gap: 3 }, stopTitle: { ...type.bodyStrong, color: colors.text }, stopAddress: { ...type.secondary, color: colors.textMuted }, stopMeta: { alignItems: 'flex-end', gap: 3 }, stopWeight: { ...type.bodyStrong, color: colors.text }, stopTime: { ...type.meta, color: colors.textMuted },
});
