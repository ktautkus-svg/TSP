import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { AccountMenuSheet } from '@/components/account-menu-sheet';
import { BackIcon, StatsIcon } from '@/components/app-icons';
import { PeriodCalendarPicker } from '@/components/period-calendar-picker';
import { FiroBrand } from '@/components/firo-brand';
import {
  formatDateKey,
  formatDateRange,
  localDateKey,
} from '@/application/reporting/period-range';
import { classifyDeliveryWindow, minutesLate } from '@/domain/delivery-window-timing';
import { useForegroundInterval } from '@/hooks/use-foreground-interval';
import { employeeApi, type QualityRouteMonitor, type QualityStopMonitor } from '@/infrastructure/auth/employee-session';
import { formatWeightKg } from '@/ui/format-weight';
import { qualityControlColors as colors, qualityBrandBurgundy } from '@/ui/quality-control-palette';
import type { ColorPalette } from '@/ui/theme-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';

const REFRESH_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 120_000;
const MINOR_DELAY_MINUTES = 45;

// Top row: route-level ("reisai") — clicking filters the route cards below.
type RouteFilter = 'all' | 'in_progress' | 'completed' | 'not_started';
// Second row: stop-level ("taškai / užsakymai") — clicking opens a combined
// cross-route list of the matching stops (not grouped by route).
type StopFilter = 'all' | 'delivered' | 'pending' | 'failed' | 'late';
type FilterTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

const ROUTE_FILTERS: readonly { key: RouteFilter; label: string; tone: FilterTone }[] = [
  { key: 'all', label: 'Viso', tone: 'neutral' },
  { key: 'in_progress', label: 'Kelyje', tone: 'info' },
  { key: 'completed', label: 'Įvykdyti', tone: 'success' },
  { key: 'not_started', label: 'Nepradėti', tone: 'warning' },
];

const STOP_FILTERS: readonly { key: StopFilter; label: string; tone: FilterTone }[] = [
  { key: 'all', label: 'Visi', tone: 'neutral' },
  { key: 'delivered', label: 'Įvykdyta', tone: 'success' },
  { key: 'pending', label: 'Neįvykdyta', tone: 'warning' },
  { key: 'failed', label: 'Atmesta', tone: 'danger' },
  { key: 'late', label: 'KPI', tone: 'info' },
];

export default function QualityControlScreen() {
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { width } = useWindowDimensions();
  // `colors` is the fixed quality-control palette imported at module scope, not
  // a themed value, so it is intentionally not a dependency here.
  const styles = useMemo(() => createStyles(colors), []);
  const [routes, setRoutes] = useState<QualityRouteMonitor[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  // Whether the last actual request to the server succeeded — not the
  // login-time connectivity snapshot from LocalAccessGate, which never
  // updates again for the rest of the session (e.g. a deploy rollover at
  // login time would otherwise leave this screen "offline" forever even
  // once the server is back and the device has a perfectly good signal).
  const [connected, setConnected] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [filter, setFilter] = useState<RouteFilter>('all');
  const [stopFilter, setStopFilter] = useState<StopFilter | null>(null);
  const [completedOpen, setCompletedOpen] = useState(false);
  const initialDate = useMemo(() => localDateKey(new Date()), []);
  const [periodFrom, setPeriodFrom] = useState(initialDate);
  const [periodTo, setPeriodTo] = useState(initialDate);
  const [entityFiltersOpen, setEntityFiltersOpen] = useState(false);
  const [driverId, setDriverId] = useState<string>('all');
  const [vehicleId, setVehicleId] = useState<string>('all');
  const desktop = width >= 980;
  const mobile = width < 720;

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setBusy(true);
    try {
      const response = await employeeApi<{ routes: QualityRouteMonitor[]; serverTime: string }>('/api/quality/routes');
      setRoutes(response.routes);
      setLastRefreshedAt(response.serverTime);
      setConnected(true);
      setError(null);
    } catch (reason) {
      setConnected(false);
      setError(reason instanceof Error ? reason.message : 'Maršrutų būsenos gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, []);

  const allowed = ['quality', 'admin', 'dispatcher'].includes(profile.role);
  const parentTarget = profile.role === 'dispatcher' ? '/dispatcher' as Href : '/' as Href;

  useEffect(() => {
    if (!allowed) {
      router.replace(roleHomePath(profile.role) as Href);
      return;
    }
    void load(true);
  }, [allowed, load, profile.role, router]);

  useForegroundInterval(
    useCallback(() => { if (allowed) void load(false); }, [allowed, load]),
    REFRESH_INTERVAL_MS,
  );

  const period = useMemo(() => ({ from: periodFrom, to: periodTo }), [periodFrom, periodTo]);
  // "On the road right now" is a live state, independent of whatever date
  // range happens to be selected — an active driver/vehicle stays first and
  // highlighted even while looking at last week's history.
  const activeDriverIds = useMemo(() => new Set(routes.filter((route) => route.status === 'in_progress').map((route) => route.driverId)), [routes]);
  const activeVehicleIds = useMemo(() => new Set(routes.filter((route) => route.status === 'in_progress' && route.vehicle).map((route) => route.vehicle!.id)), [routes]);
  const drivers = useMemo(() => [...new Map(routes.map((route) => [route.driverId, route.driverName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => {
      const activeDiff = Number(activeDriverIds.has(right.id)) - Number(activeDriverIds.has(left.id));
      return activeDiff !== 0 ? activeDiff : left.name.localeCompare(right.name, 'lt-LT');
    }), [routes, activeDriverIds]);
  const vehicles = useMemo(() => [...new Map(routes.map((route) => route.vehicle).filter((vehicle): vehicle is NonNullable<typeof vehicle> => Boolean(vehicle)).map((vehicle) => [vehicle.id, vehicle.registrationNumber])).entries()]
    .map(([id, registrationNumber]) => ({ id, registrationNumber }))
    .sort((left, right) => {
      const activeDiff = Number(activeVehicleIds.has(right.id)) - Number(activeVehicleIds.has(left.id));
      return activeDiff !== 0 ? activeDiff : left.registrationNumber.localeCompare(right.registrationNumber, 'lt-LT');
    }), [routes, activeVehicleIds]);
  const visible = routes.filter((route) => route.date >= period.from && route.date <= period.to
    && (driverId === 'all' || route.driverId === driverId)
    && (vehicleId === 'all' || route.vehicle?.id === vehicleId));
  // Row 1 (reisai/routes): "Kelyje" is only routes actually being driven;
  // "Nepradėti" is everything still waiting (assigned/downloaded).
  const inProgressRoutes = visible.filter((route) => route.status === 'in_progress');
  const notStartedRoutes = visible.filter((route) => ['assigned', 'downloaded'].includes(route.status));
  // Sort completed routes with delivery discrepancies (failed stops) first,
  // so problems are visible without opening every card.
  const completedRoutes = visible
    .filter((route) => route.status === 'completed')
    .sort((left, right) => right.failedStops - left.failedStops);
  const vehicleCount = new Set(visible.map((route) => route.vehicle?.id).filter(Boolean)).size;
  const filteredRoutes = filter === 'all'
    ? visible
    : filter === 'in_progress'
      ? inProgressRoutes
      : filter === 'completed'
        ? completedRoutes
        : notStartedRoutes;
  const routeFilterCounts: Record<RouteFilter, number> = {
    all: visible.length,
    in_progress: inProgressRoutes.length,
    completed: completedRoutes.length,
    not_started: notStartedRoutes.length,
  };

  // Row 2 (taškai/užsakymai): stop-level KPIs, pooled across every stop in
  // the visible routes so one failed stop out of ten reads as 10%, not as
  // "1 problem route out of 1" (100%). Clicking a tile opens a combined
  // cross-route list of the matching stops below, not a route filter.
  const allStops: StopWithRoute[] = visible.flatMap((route) => route.stops.map((stop) => withRoute(stop, route)));
  const deliveredStopsList = allStops.filter((stop) => stop.status === 'delivered');
  const pendingStopsList = allStops.filter((stop) => stop.status === 'pending');
  const failedStopsList = allStops.filter((stop) => stop.status === 'failed');
  const lateStopsList = visible.flatMap((route) => lateStops(route).map((stop) => withRoute(stop, route)));
  const stopSharePercent = (stopCount: number) => allStops.length === 0 ? 0 : Math.round((stopCount / allStops.length) * 100);
  const stopFilterCounts: Record<StopFilter, number> = {
    all: allStops.length,
    delivered: deliveredStopsList.length,
    pending: pendingStopsList.length,
    failed: failedStopsList.length,
    late: lateStopsList.length,
  };
  const stopFilterPercents: Record<Exclude<StopFilter, 'all'>, number> = {
    delivered: stopSharePercent(deliveredStopsList.length),
    pending: stopSharePercent(pendingStopsList.length),
    failed: stopSharePercent(failedStopsList.length),
    late: stopSharePercent(lateStopsList.length),
  };
  const stopFilterList: StopWithRoute[] = stopFilter === 'all'
    ? allStops
    : stopFilter === 'delivered'
      ? deliveredStopsList
      : stopFilter === 'pending'
        ? pendingStopsList
        : stopFilter === 'failed'
          ? failedStopsList
          : stopFilter === 'late'
            ? lateStopsList
            : [];

  return <SafeAreaView style={styles.safeArea}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}>
      {profile.role === 'quality' ? <View style={styles.headerNavButton} /> : <Pressable accessibilityLabel="Atgal" accessibilityRole="button" onPress={() => router.replace(parentTarget)} style={styles.headerNavButton}>
        <BackIcon size={22} color={colors.primary} />
      </Pressable>}
      <View style={styles.headerIdentity}>
        <Pressable accessibilityLabel="Į pradžią" accessibilityRole="button" onPress={() => router.replace(roleHomePath(profile.role) as Href)} style={({ pressed }) => [styles.headerBrandButton, pressed && styles.cardSummaryPressed]}>
          <FiroBrand compact />
        </Pressable>
        {!mobile ? <View style={styles.headerDivider} /> : null}
        {!mobile ? <Text numberOfLines={1} style={styles.headerContext}>KOKYBĖS KONTROLĖ</Text> : null}
      </View>
      <View style={styles.headerActions}>
        {profile.role === 'quality' ? (
          <Pressable
            accessibilityLabel="Kelionės lapai"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/trip-sheet', params: { returnTo: 'quality-control' } } as Href)}
            style={({ pressed }) => [styles.tripSheetHeaderButton, pressed && styles.cardSummaryPressed]}
            testID="quality-open-trip-sheets"
          >
            <Text style={styles.tripSheetHeaderText}>Kelionės lapai</Text>
          </Pressable>
        ) : null}
        {profile.role === 'quality' ? (
          <Pressable accessibilityLabel="Statistika" accessibilityRole="button" onPress={() => router.push({ pathname: '/statistics', params: { returnTo: 'quality-control' } } as unknown as Href)} style={({ pressed }) => [styles.headerNavButton, pressed && styles.cardSummaryPressed]} testID="quality-open-statistics">
            <StatsIcon size={22} color={colors.primary} />
          </Pressable>
        ) : null}
        <Pressable accessibilityLabel="Atidaryti paskyros meniu" accessibilityRole="button" onPress={() => setAccountMenuOpen(true)} style={({ pressed }) => [styles.accountButton, pressed && styles.accountButtonPressed]}>
          <Text style={styles.accountInitials}>{initials(profile.displayName)}</Text>
        </Pressable>
      </View>
    </View>
    <AccountMenuSheet visible={accountMenuOpen} onClose={() => setAccountMenuOpen(false)} />

    <ScrollView contentContainerStyle={[styles.page, mobile && styles.pageMobile]}>
      <View style={styles.operationsPanel}>
        <View style={[styles.operationsTop, mobile && styles.operationsTopMobile]}>
          <View style={styles.heading}>
            <Text style={[styles.pageTitle, mobile && styles.pageTitleMobile]}>{formatDateRange(period.from, period.to)}</Text>
            <Text style={styles.subtitle}>{driverId === 'all' ? 'Visi vairuotojai' : drivers.find((driver) => driver.id === driverId)?.name} · {formatVehicleCount(vehicleCount)} · {visible.length} {visible.length === 1 ? 'maršrutas' : 'maršrutai'}</Text>
          </View>
          <View style={styles.connection}>
            <View style={[styles.liveDot, !connected && styles.liveDotOffline]} />
            <View style={styles.flex}>
              <Text style={styles.liveLabel}>{connected ? 'RYŠYS GERAS' : 'RYŠIO NĖRA'}</Text>
              <Text style={styles.refreshTime}>Atnaujinta {formatClock(lastRefreshedAt)}</Text>
            </View>
            <Pressable disabled={busy} onPress={() => void load(true)} style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshPressed, busy && styles.disabled]} testID="quality-refresh">
              {busy ? <ActivityIndicator color={colors.info} /> : <Text style={styles.refreshText}>Atnaujinti</Text>}
            </Pressable>
          </View>
        </View>
        <View accessibilityLabel="Maršrutų suvestinė" style={styles.filters}>
          {ROUTE_FILTERS.map((item) => <StatusFilter
            key={item.key}
            active={filter === item.key}
            label={item.label}
            mode="count"
            onPress={() => setFilter(item.key)}
            styles={styles}
            tone={item.tone}
            value={routeFilterCounts[item.key]}
          />)}
        </View>
        <View accessibilityLabel="Taškų suvestinė" style={styles.filters}>
          {STOP_FILTERS.map((item) => <StatusFilter
            key={item.key}
            active={stopFilter === item.key}
            label={item.label}
            mode={item.key === 'all' ? 'count' : 'percent'}
            onPress={() => setStopFilter((current) => current === item.key ? null : item.key)}
            percent={item.key === 'all' ? undefined : stopFilterPercents[item.key]}
            styles={styles}
            tone={item.tone}
            value={stopFilterCounts[item.key]}
          />)}
        </View>
      </View>

      {stopFilter ? <StopSection filter={stopFilter} stops={stopFilterList} styles={styles} /> : null}

      <View style={styles.periodPanel} testID="quality-period-panel">
        <PeriodCalendarPicker from={periodFrom} onChange={(from, to) => { setPeriodFrom(from); setPeriodTo(to); }} testID="quality-period-calendar" to={periodTo} />

        <Pressable accessibilityState={{ expanded: entityFiltersOpen }} onPress={() => setEntityFiltersOpen((value) => !value)} style={styles.entityFilterToggle} testID="quality-entity-filters-toggle">
          <View style={styles.flex}>
            <Text style={styles.entityFilterTitle}>Vairuotojas ir automobilis</Text>
            <Text style={styles.muted}>{driverId === 'all' ? 'Visi vairuotojai' : drivers.find((driver) => driver.id === driverId)?.name} · {vehicleId === 'all' ? 'visi automobiliai' : vehicles.find((vehicle) => vehicle.id === vehicleId)?.registrationNumber}</Text>
          </View>
          <Text style={styles.entityFilterAction}>{entityFiltersOpen ? 'Slėpti' : 'Keisti'}</Text>
        </Pressable>

        {entityFiltersOpen ? <><View style={styles.driverFilter}>
          <Text style={styles.fieldLabel}>VAIRUOTOJAS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.driverChoices}>
            <DriverChoice active={driverId === 'all'} label="Visi vairuotojai" onPress={() => setDriverId('all')} styles={styles} />
            {drivers.map((driver) => <DriverChoice key={driver.id} active={driverId === driver.id} label={driver.name} live={activeDriverIds.has(driver.id)} onPress={() => setDriverId(driver.id)} styles={styles} />)}
          </ScrollView>
        </View>

        <View style={styles.driverFilter} testID="quality-vehicle-filter">
          <Text style={styles.fieldLabel}>AUTOMOBILIS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.driverChoices}>
            <DriverChoice active={vehicleId === 'all'} label="Visi automobiliai" onPress={() => setVehicleId('all')} styles={styles} />
            {vehicles.map((vehicle) => <DriverChoice key={vehicle.id} active={vehicleId === vehicle.id} label={vehicle.registrationNumber} live={activeVehicleIds.has(vehicle.id)} onPress={() => setVehicleId(vehicle.id)} styles={styles} />)}
          </ScrollView>
        </View></> : null}
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
      {busy && routes.length === 0 ? <ActivityIndicator color={colors.info} size="large" /> : null}
      {!busy && filteredRoutes.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>{emptyTitle(filter)}</Text><Text style={styles.muted}>Pakeiskite laikotarpį, vairuotoją arba būseną.</Text></View> : null}

      {filteredRoutes.length > 0 ? <RouteSection title={filterTitle(filter)} count={filteredRoutes.length} routes={filteredRoutes} desktop={desktop} mobile={mobile} styles={styles} /> : null}

      {!['all', 'completed'].includes(filter) && completedRoutes.length > 0 ? <View style={styles.completedSection}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: completedOpen }} onPress={() => setCompletedOpen((value) => !value)} style={({ pressed }) => [styles.completedHeader, pressed && styles.cardSummaryPressed]}>
          <View><Text style={styles.sectionTitle}>Baigta pasirinktu laikotarpiu</Text><Text style={styles.muted}>Užbaigti maršrutai suskleisti, kad netrukdytų stebėti darbo.</Text></View>
          <View style={styles.completedHeaderRight}><Text style={styles.count}>{completedRoutes.length}</Text><Text style={styles.expandIcon}>{completedOpen ? '⌃' : '⌄'}</Text></View>
        </Pressable>
        {completedOpen ? <View style={[styles.routeGrid, desktop && styles.routeGridDesktop]}>{completedRoutes.map((route) => <RouteCard key={`completed-${route.id}`} route={route} desktop={desktop} mobile={mobile} styles={styles} />)}</View> : null}
      </View> : null}
    </ScrollView>

  </SafeAreaView>;
}

function RouteSection({ title, count, routes, desktop, mobile, styles, defaultExpanded = false }: { title: string; count: number; routes: QualityRouteMonitor[]; desktop: boolean; mobile: boolean; styles: ReturnType<typeof createStyles>; defaultExpanded?: boolean }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.count}>{count}</Text></View>
    <View style={[styles.routeGrid, desktop && styles.routeGridDesktop]}>{routes.map((route) => <RouteCard key={route.id} route={route} desktop={desktop} mobile={mobile} styles={styles} defaultExpanded={defaultExpanded} />)}</View>
  </View>;
}

function RouteCard({ route, desktop, mobile, styles, defaultExpanded = false }: { route: QualityRouteMonitor; desktop: boolean; mobile: boolean; styles: ReturnType<typeof createStyles>; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const stale = Date.now() - Date.parse(route.updatedAt) > STALE_AFTER_MS && route.status === 'in_progress';
  const completed = route.status === 'completed';
  const deliveredWeightKg = Math.max(0, route.totalWeightKg - route.remainingWeightKg);
  const weightPercent = route.totalWeightKg > 0 ? Math.round((deliveredWeightKg / route.totalWeightKg) * 100) : 0;

  return <View style={[
    styles.routeCard,
    mobile && styles.routeCardMobile,
    desktop && styles.routeCardDesktop,
    completed ? styles.routeCardCompleted : route.status === 'in_progress' ? styles.routeCardActive : styles.routeCardWaiting,
    route.failedStops > 0 && styles.routeCardIssue,
  ]} testID={`quality-route-${route.id}`}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.cardSummary, pressed && styles.cardSummaryPressed]}>
      <View style={styles.cardHeader}>
        <View style={styles.identity}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(route.driverName)}</Text></View>
          <View style={styles.flex}><Text style={styles.driverName}>{route.driverName}</Text><Text style={styles.vehicle}>{vehicleLabel(route)}</Text></View>
        </View>
        <View style={styles.cardState}>
          <View style={[styles.status, completed ? styles.statusCompleted : route.status === 'in_progress' ? styles.statusActive : styles.statusWaiting]}><Text style={[styles.statusText, completed ? styles.statusTextCompleted : route.status === 'in_progress' ? styles.statusTextActive : styles.statusTextWaiting]}>{statusLabel(route.status)}</Text></View>
          <Text style={styles.expandIcon}>{expanded ? '⌃' : '⌄'}</Text>
        </View>
      </View>

      <Text style={styles.routeDate}>{formatDateKey(route.date)} · {regionLabel(route.routeNumbers)}</Text>
      {route.failedStops > 0 ? <Text style={styles.failedBadge}>{route.failedStops} {route.failedStops === 1 ? 'taškas' : 'taškai'} nepristatyta</Text> : null}

      <View style={styles.progressGrid}>
        <ProgressReadout
          label="TAŠKAI ATLIKTI"
          primary={`${route.deliveredStops} / ${route.totalStops}`}
          secondary={`${route.remainingStops} liko`}
          percent={route.totalStops > 0 ? Math.round((route.deliveredStops / route.totalStops) * 100) : 0}
          styles={styles}
          tone="points" />
        <ProgressReadout label="SVORIS ATIDUOTAS" primary={`${formatWeightKg(deliveredWeightKg)} / ${formatWeightKg(route.totalWeightKg)} kg`} secondary={`${formatWeightKg(route.remainingWeightKg)} kg liko`} percent={weightPercent} styles={styles} tone="weight" />
      </View>
      <View style={styles.startReadout}>
        <Text style={styles.startLabel}>{route.startedAt ? 'REALUS STARTAS' : 'PLANUOTAS STARTAS'}</Text>
        <Text style={styles.startValue}>{formatClockShort(route.startedAt ?? route.plannedStartAt ?? '')}</Text>
      </View>
      <Text style={styles.expandHint}>{expanded ? 'Slėpti maršruto informaciją' : 'Rodyti taškus ir laikus'}</Text>
    </Pressable>

    {expanded ? <View style={styles.details}>
      {route.failedStops > 0 ? <View style={styles.issueSummary}>
        <Text style={styles.issueSummaryTitle}>NEATITIKIMAI</Text>
        {route.stops.filter((stop) => stop.status === 'failed').map((stop) => <View key={`issue-${stop.sequence}`} style={styles.issueRow}>
          <Text style={styles.issueSequence}>{stop.sequence}</Text>
          <View style={styles.flex}><Text style={styles.issueAddress}>{stop.address}</Text><Text style={styles.issueReason}>{failureLabel(stop)}</Text></View>
        </View>)}
      </View> : null}
      {route.nextStop ? <NextStop stop={route.nextStop} remainingWeightKg={route.remainingWeightKg} styles={styles} /> : <View style={styles.nextStopDone}><Text style={styles.nextDoneText}>{completed ? 'Maršrutas užbaigtas' : 'Visi pristatymo taškai apdoroti'}</Text></View>}

      <View style={styles.processedSection}>
        <Text style={styles.processedTitle}>VISAS MARŠRUTO EILIŠKUMAS</Text>
        {route.stops.map((stop) => <RouteSequenceStop key={`${route.id}-${stop.sequence}`} nextSequence={route.nextStop?.sequence ?? null} stop={stop} styles={styles} />)}
      </View>

      <View style={styles.cardFooter}><Text style={[styles.updated, stale && styles.updatedStale]}>{stale ? 'Duomenys vėluoja · ' : ''}Atnaujinta {formatRelative(route.updatedAt)}</Text><Text style={styles.started}>{route.startedAt ? `Startas ${formatClock(route.startedAt)}` : 'Dar nepradėtas'}</Text></View>
    </View> : null}
  </View>;
}

function ProgressReadout({ label, primary, secondary, percent, tone, styles }: { label: string; primary: string; secondary: string; percent: number; tone: 'points' | 'weight'; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.progressBlock}>
    <View style={styles.progressReadoutHeader}><Text style={styles.progressLabel}>{label}</Text><Text style={styles.progressPercent}>{Math.min(100, Math.max(0, percent))}%</Text></View>
    <Text numberOfLines={1} style={styles.progressPrimary}>{primary}</Text>
    <Text numberOfLines={1} style={styles.progressSecondary}>{secondary}</Text>
    <View style={styles.progressTrack}><View style={[styles.progressFill, tone === 'weight' && styles.progressFillWeight, { width: `${Math.min(100, Math.max(0, percent))}%` }]} /></View>
  </View>;
}

function NextStop({ stop, remainingWeightKg, styles }: { stop: QualityStopMonitor; remainingWeightKg: number; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.nextStop}>
    <View style={styles.nextSequence}><Text style={styles.nextSequenceLabel}>TOLIAU</Text><Text style={styles.nextSequenceValue}>{stop.sequence}</Text></View>
    <View style={styles.flex}>
      <Text style={styles.nextRecipient}>{stop.recipient}</Text>
      <Text numberOfLines={2} style={styles.nextAddress}>{stop.address}</Text>
      <View style={styles.nextTimes}>
        {formatWindow(stop) ? <Text style={styles.nextTime}>Pristatymo laikas {formatWindow(stop)}</Text> : null}
        {stop.plannedArrivalAt ? <Text style={styles.nextTime}>Atvykimas {formatClockShort(stop.plannedArrivalAt)}</Text> : null}
      </View>
      <Text style={styles.nextMeta}>{stop.routeNumber ? `Regionas ${stop.routeNumber} · ` : ''}{formatWeightKg(remainingWeightKg)} kg likę</Text>
    </View>
  </View>;
}

function RouteSequenceStop({ stop, nextSequence, styles }: { stop: QualityStopMonitor; nextSequence: number | null; styles: ReturnType<typeof createStyles> }) {
  const next = stop.sequence === nextSequence;
  const timing = stop.status === 'pending'
    ? { label: stop.plannedArrivalAt ? `Numatyta ${formatClockShort(stop.plannedArrivalAt)}` : 'Laukia', tone: 'neutral' as const }
    : stopTiming(stop);
  return <View style={[styles.processedStop, styles[`processedStop_${timing.tone}`], next && styles.sequenceNext]}>
    <View style={[styles.processedSequence, next && styles.sequenceNextNumber]}><Text style={[styles.processedSequenceText, next && styles.sequenceNextNumberText]}>{stop.sequence}</Text></View>
    <View style={styles.flex}>
      <Text numberOfLines={1} style={styles.processedRecipient}>{stop.recipient}</Text>
      <Text numberOfLines={2} style={styles.processedAddress}>{stop.address}</Text>
      <View style={styles.sequenceMeta}>
        {formatWindow(stop) ? <Text style={styles.processedWindow}>Pristatymo laikas {formatWindow(stop)}</Text> : null}
        {stop.routeNumber ? <Text style={styles.processedWindow}>Regionas {stop.routeNumber}</Text> : null}
      </View>
    </View>
    <View style={[styles.timingBadge, styles[`timingBadge_${timing.tone}`]]}><Text style={[styles.timingText, styles[`timingText_${timing.tone}`]]}>{next ? `TOLIAU · ${timing.label}` : timing.label}</Text></View>
  </View>;
}

function StatusFilter({ active, label, mode, onPress, percent, tone, value, styles }: { active: boolean; label: string; mode: 'count' | 'percent'; onPress: () => void; percent?: number; tone: FilterTone; value: number; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.filter, styles[`filterTone_${tone}`], active && styles[`filterActive_${tone}`], pressed && styles.filterPressed]}>
    <Text style={[styles.filterValue, styles[`filterValueTone_${tone}`], active && styles.filterValueActive]}>{mode === 'percent' ? `${percent ?? 0}%` : value}</Text>
    <Text numberOfLines={1} style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
  </Pressable>;
}

type StopWithRoute = QualityStopMonitor & { routeKey: string; date: string; driverName: string; vehicleText: string };

function withRoute(stop: QualityStopMonitor, route: QualityRouteMonitor): StopWithRoute {
  return { ...stop, routeKey: route.id, date: route.date, driverName: route.driverName, vehicleText: vehicleLabel(route) };
}

function StopSection({ filter, stops, styles }: { filter: StopFilter; stops: StopWithRoute[]; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section} testID="quality-stop-section">
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{stopFilterTitle(filter)}</Text><Text style={styles.count}>{stops.length}</Text></View>
    {stops.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Pasirinktu laikotarpiu tokių taškų nėra</Text></View> : <View style={styles.stopList}>
      {stops.map((stop) => <StopRow key={`${stop.routeKey}-${stop.sequence}`} stop={stop} styles={styles} />)}
    </View>}
  </View>;
}

function StopRow({ stop, styles }: { stop: StopWithRoute; styles: ReturnType<typeof createStyles> }) {
  const timing = stop.status === 'pending'
    ? { label: stop.plannedArrivalAt ? `Numatyta ${formatClockShort(stop.plannedArrivalAt)}` : 'Laukia', tone: 'neutral' as const }
    : stopTiming(stop);
  return <View style={[styles.stopRow, styles[`processedStop_${timing.tone}`]]} testID="quality-stop-row">
    <View style={styles.flex}>
      <Text style={styles.stopVehicleDriver}>{stop.vehicleText} · {stop.driverName}</Text>
      <Text numberOfLines={1} style={styles.processedRecipient}>{stop.recipient}</Text>
      <Text numberOfLines={2} style={styles.processedAddress}>{stop.address}</Text>
      <View style={styles.sequenceMeta}>
        <Text style={styles.processedWindow}>{formatDateKey(stop.date)}</Text>
        {formatWindow(stop) ? <Text style={styles.processedWindow}>Langas {formatWindow(stop)}</Text> : null}
      </View>
    </View>
    <View style={[styles.timingBadge, styles[`timingBadge_${timing.tone}`]]}><Text style={[styles.timingText, styles[`timingText_${timing.tone}`]]}>{timing.label}</Text></View>
  </View>;
}

function stopFilterTitle(filter: StopFilter): string {
  return ({ all: 'Visi taškai', delivered: 'Įvykdyti taškai', pending: 'Neįvykdyti taškai', failed: 'Atmesti taškai', late: 'KPI · vėluojantys pristatymai' })[filter];
}

function stopTiming(stop: QualityStopMonitor): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (stop.status === 'failed') {
    const reason = [stop.failureReason, stop.failureComment].filter(Boolean).join(': ');
    const clock = stop.failedAt ? ` ${formatClockShort(stop.failedAt)}` : '';
    return { label: reason ? `Nepristatyta (${reason})${clock}` : `Nepristatyta${clock}`, tone: 'danger' };
  }
  if (!stop.deliveredAt) return { label: 'Pristatyta', tone: 'success' };
  const clock = formatClockShort(stop.deliveredAt);
  const timing = classifyDeliveryWindow(stop.deliveredAt, stop.deliveryTimeFrom, stop.deliveryTimeTo);
  if (timing === 'early') return { label: `Per anksti · ${clock}`, tone: 'warning' };
  if (timing === 'late') {
    const delay = Math.max(1, minutesLate(stop.deliveredAt, stop.deliveryTimeTo) ?? 1);
    return delay <= MINOR_DELAY_MINUTES
      ? { label: `Vėlavo ${delay} min. · ${clock}`, tone: 'warning' }
      : { label: `Pavėlavo ${delay} min. · ${clock}`, tone: 'danger' };
  }
  return { label: `Laiku · ${clock}`, tone: 'success' };
}

function failureLabel(stop: QualityStopMonitor): string {
  return [stop.failureReason, stop.failureComment].filter(Boolean).join(' · ') || 'Priežastis nenurodyta';
}

function DriverChoice({ active, label, live = false, onPress, styles }: { active: boolean; label: string; live?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.driverChoice, active && styles.driverChoiceActive, live && styles.driverChoiceLive, pressed && styles.filterPressed]}>
    <View style={[styles.driverChoiceDot, active && styles.driverChoiceDotActive, live && styles.driverChoiceDotLive]} />
    <Text numberOfLines={1} style={[styles.driverChoiceText, active && styles.driverChoiceTextActive, live && styles.driverChoiceTextLive]}>{label}</Text>
  </Pressable>;
}
function filterTitle(filter: RouteFilter): string { return ({ all: 'Visi maršrutai', in_progress: 'Kelyje', completed: 'Įvykdyti maršrutai', not_started: 'Nepradėti maršrutai' })[filter]; }
function emptyTitle(filter: RouteFilter): string { return ({ all: 'Pasirinktu laikotarpiu maršrutų nėra', in_progress: 'Pasirinktu laikotarpiu vykdomų maršrutų nėra', completed: 'Pasirinktu laikotarpiu įvykdytų maršrutų nėra', not_started: 'Pasirinktu laikotarpiu nepradėtų maršrutų nėra' })[filter]; }
function lateStops(route: QualityRouteMonitor): QualityStopMonitor[] {
  return route.stops.filter((stop) => stop.status !== 'failed' && Boolean(stop.deliveredAt)
    && classifyDeliveryWindow(stop.deliveredAt, stop.deliveryTimeFrom, stop.deliveryTimeTo) === 'late');
}
function vehicleLabel(route: QualityRouteMonitor): string { return route.vehicle ? `${route.vehicle.registrationNumber} · ${route.vehicle.model}` : 'Automobilis nepriskirtas'; }
function regionLabel(codes: string[]): string { return codes.length > 0 ? `Regionai ${codes.join(', ')}` : 'Regionas nenurodytas'; }
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function statusLabel(status: QualityRouteMonitor['status']): string { return ({ assigned: 'Priskirtas', downloaded: 'Paruoštas', in_progress: 'Kelyje', completed: 'Baigtas', cancelled: 'Atšauktas' } as Record<string, string>)[status] ?? status; }
function formatVehicleCount(value: number): string { if (value === 1) return '1 automobilis'; if (value % 10 >= 2 && value % 10 <= 9 && (value % 100 < 10 || value % 100 >= 20)) return `${value} automobiliai`; return `${value} automobilių`; }
function formatWindow(stop: QualityStopMonitor): string | null { if (!stop.deliveryTimeFrom && !stop.deliveryTimeTo) return null; return `${formatTimeValue(stop.deliveryTimeFrom) ?? '—'}–${formatTimeValue(stop.deliveryTimeTo) ?? '—'}`; }
function formatTimeValue(value: string | null): string | null { if (!value) return null; const match = /(\d{1,2}:\d{2})/.exec(value); return match?.[1] ?? formatClockShort(value); }
function formatClock(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date); }
function formatClockShort(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit' }).format(date); }
function formatRelative(value: string): string { const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000)); if (seconds < 45) return 'ką tik'; if (seconds < 3600) return `prieš ${Math.floor(seconds / 60)} min.`; return formatClock(value); }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 68, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, borderTopWidth: 3, borderTopColor: qualityBrandBurgundy, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerBrandButton: { minWidth: 84, minHeight: 48, justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tripSheetHeaderButton: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center', borderRadius: radius.md },
  tripSheetHeaderText: { ...type.button, color: colors.primary },
  headerNavButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerDivider: { width: 1, height: 30, backgroundColor: colors.border },
  headerContext: { flexShrink: 1, ...type.label, fontFamily: fonts.heading, color: colors.primary, letterSpacing: 0.7 },
  accountButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }, accountButtonPressed: { backgroundColor: colors.primaryDark, transform: [{ scale: 0.96 }] }, accountInitials: { ...type.secondaryStrong, color: colors.textInverse },
  page: { flexGrow: 1, width: '100%', maxWidth: 1440, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }, pageMobile: { padding: spacing.md, gap: spacing.md },
  operationsPanel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primary, gap: spacing.md },
  operationsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg }, operationsTopMobile: { alignItems: 'stretch', flexDirection: 'column' },
  heading: { flex: 1, minWidth: 0, gap: 3 }, pageTitle: { ...type.pageTitle, color: colors.textInverse, fontSize: 30, lineHeight: 36 }, pageTitleMobile: { fontSize: 24, lineHeight: 30 }, subtitle: { ...type.bodyStrong, color: colors.brandBurgundyLight },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  periodPanel: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.md, shadowColor: colors.primary, shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  fieldLabel: { ...type.label, color: colors.textMuted },
  entityFilterToggle: { minHeight: 58, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  entityFilterTitle: { ...type.bodyStrong, color: colors.text },
  entityFilterAction: { ...type.secondaryStrong, color: colors.info },
  driverFilter: { gap: spacing.xs }, driverChoices: { gap: spacing.sm, paddingVertical: 2 }, driverChoice: { minHeight: 44, maxWidth: 240, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }, driverChoiceActive: { borderColor: colors.info, backgroundColor: colors.infoSoft }, driverChoiceDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.borderStrong }, driverChoiceDotActive: { backgroundColor: colors.info }, driverChoiceText: { ...type.bodyStrong, color: colors.textSecondary }, driverChoiceTextActive: { color: colors.info }, driverChoiceLive: { borderColor: colors.success }, driverChoiceDotLive: { backgroundColor: colors.success }, driverChoiceTextLive: { color: colors.success },
  empty: { padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, emptyTitle: { ...type.sectionTitle, color: colors.text }, muted: { ...type.secondary, color: colors.textMuted },
  section: { gap: spacing.md }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, sectionTitle: { ...type.sectionTitle, color: colors.text, fontSize: 20, lineHeight: 26 }, count: { minWidth: 30, textAlign: 'center', paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.infoSoft, ...type.secondaryStrong, color: colors.info },
  stopList: { gap: spacing.sm }, stopRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderLeftWidth: 4, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, stopVehicleDriver: { ...type.label, color: colors.info, marginBottom: 2 },
  completedSection: { gap: spacing.md }, completedHeader: { minHeight: 64, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.accentSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, completedHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeGrid: { gap: spacing.md }, routeGridDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }, routeCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', shadowColor: colors.primary, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, routeCardMobile: {}, routeCardDesktop: { width: '48.9%', flexGrow: 1, maxWidth: '50%' }, routeCardCompleted: { borderColor: colors.border },
  routeCardActive: { borderLeftWidth: 5, borderLeftColor: colors.info }, routeCardWaiting: { borderLeftWidth: 5, borderLeftColor: colors.warning }, routeCardIssue: { borderLeftWidth: 5, borderLeftColor: colors.danger },
  cardSummary: { padding: spacing.md, gap: spacing.sm }, cardSummaryPressed: { backgroundColor: colors.surfaceSubtle },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }, identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, avatar: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft }, avatarText: { ...type.bodyStrong, color: colors.info }, flex: { flex: 1, minWidth: 0 }, driverName: { ...type.sectionTitle, color: colors.text }, vehicle: { ...type.secondary, color: colors.textMuted, marginTop: 2 },
  cardState: { alignItems: 'flex-end', gap: spacing.xs }, expandIcon: { fontFamily: fonts.heading, fontSize: 21, lineHeight: 22, color: colors.primary },
  status: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill }, statusActive: { backgroundColor: colors.infoSoft }, statusWaiting: { backgroundColor: colors.warningSoft }, statusCompleted: { backgroundColor: colors.accentSoft }, statusText: { ...type.label }, statusTextActive: { color: colors.info }, statusTextWaiting: { color: colors.warning }, statusTextCompleted: { color: colors.success },
  routeDate: { ...type.bodyStrong, color: colors.info },
  failedBadge: { ...type.secondaryStrong, color: colors.danger, marginTop: 2 },
  progressGrid: { flexDirection: 'row', gap: spacing.sm }, progressBlock: { flex: 1, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted }, progressReadoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }, progressLabel: { ...type.label, color: colors.textMuted }, progressPercent: { ...type.meta, fontFamily: fonts.headingSemiBold, color: colors.primary }, progressPrimary: { ...type.bodyStrong, color: colors.text, marginTop: spacing.xs }, progressSecondary: { ...type.meta, color: colors.textMuted, marginTop: 1 }, progressTrack: { height: 6, marginTop: spacing.sm, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.border }, progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.info }, progressFillWeight: { backgroundColor: colors.success }, expandHint: { ...type.meta, textAlign: 'right', color: colors.info },
  startReadout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.sm }, startLabel: { ...type.label, color: colors.textMuted }, startValue: { ...type.bodyStrong, color: colors.primary },
  details: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.lg },
  issueSummary: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft }, issueSummaryTitle: { ...type.label, color: colors.danger }, issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, issueSequence: { minWidth: 28, textAlign: 'center', paddingVertical: 4, borderRadius: radius.sm, overflow: 'hidden', ...type.secondaryStrong, color: colors.textInverse, backgroundColor: colors.danger }, issueAddress: { ...type.bodyStrong, color: colors.text }, issueReason: { ...type.secondaryStrong, color: colors.danger, marginTop: 2 },
  nextStop: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.border }, nextSequence: { width: 56, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border }, nextSequenceLabel: { ...type.label, color: colors.info }, nextSequenceValue: { fontSize: 26, lineHeight: 32, fontFamily: fonts.heading, color: colors.info }, nextRecipient: { ...type.cardTitle, color: colors.text }, nextAddress: { ...type.body, color: colors.textSecondary, marginTop: 2 }, nextTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }, nextTime: { ...type.meta, fontFamily: fonts.headingSemiBold, color: colors.warning }, nextMeta: { ...type.meta, color: colors.info, marginTop: spacing.xs }, nextStopDone: { minHeight: 74, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, nextDoneText: { ...type.bodyStrong, color: colors.success },
  processedSection: { gap: spacing.sm }, processedTitle: { ...type.label, color: colors.textMuted }, processedStop: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderLeftWidth: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle }, processedStop_neutral: { borderLeftColor: colors.textMuted }, processedStop_success: { borderLeftColor: colors.success }, processedStop_warning: { borderLeftColor: colors.warning }, processedStop_danger: { borderLeftColor: colors.danger }, processedSequence: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted }, processedSequenceText: { ...type.secondaryStrong, color: colors.text }, processedRecipient: { ...type.bodyStrong, color: colors.text }, processedAddress: { ...type.meta, color: colors.textMuted }, processedWindow: { ...type.meta, color: colors.textSecondary, marginTop: 2 }, timingBadge: { maxWidth: 148, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm }, timingBadge_neutral: { backgroundColor: colors.surfaceMuted }, timingBadge_success: { backgroundColor: colors.accentSoft }, timingBadge_warning: { backgroundColor: colors.warningSoft }, timingBadge_danger: { backgroundColor: colors.dangerSoft }, timingText: { ...type.meta, fontFamily: fonts.headingSemiBold, textAlign: 'right' }, timingText_neutral: { color: colors.textMuted }, timingText_success: { color: colors.success }, timingText_warning: { color: colors.warning }, timingText_danger: { color: colors.danger }, noProcessed: { ...type.secondary, color: colors.textMuted },
  sequenceNext: { borderLeftColor: colors.info, backgroundColor: colors.infoSoft }, sequenceNextNumber: { backgroundColor: colors.info }, sequenceNextNumberText: { color: colors.textInverse }, sequenceMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle }, updated: { ...type.meta, color: colors.textMuted }, updatedStale: { color: colors.warning }, started: { ...type.meta, color: colors.textMuted },
  filters: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }, filter: { flex: 1, minWidth: 150, minHeight: 68, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong }, filterTone_neutral: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong }, filterValueTone_neutral: { color: colors.primary }, filterActive_neutral: { borderColor: colors.primary, borderWidth: 2 }, filterTone_info: { backgroundColor: colors.infoSoft, borderColor: colors.info }, filterTone_warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning }, filterTone_success: { backgroundColor: colors.accentSoft, borderColor: colors.success }, filterTone_danger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger }, filterValueTone_info: { color: colors.info }, filterValueTone_warning: { color: colors.warning }, filterValueTone_success: { color: colors.success }, filterValueTone_danger: { color: colors.danger }, filterActive_info: { borderColor: colors.info, borderWidth: 2 }, filterActive_warning: { borderColor: colors.warning, borderWidth: 2 }, filterActive_success: { borderColor: colors.success, borderWidth: 2 }, filterActive_danger: { borderColor: colors.danger, borderWidth: 2 }, filterPressed: { opacity: 0.82 }, filterValue: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 27, color: colors.primary }, filterValueActive: {}, filterLabel: { ...type.label, fontSize: 11, lineHeight: 14, color: colors.textSecondary, marginTop: 3 }, filterLabelActive: { fontFamily: fonts.headingSemiBold },
  connection: { minWidth: 250, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primaryDark }, liveDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.success }, liveDotOffline: { backgroundColor: colors.danger }, liveLabel: { ...type.label, color: colors.textInverse }, refreshTime: { ...type.meta, color: colors.borderStrong }, refreshButton: { minHeight: 38, minWidth: 92, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }, refreshPressed: { backgroundColor: colors.infoSoft }, refreshText: { ...type.button, color: colors.info }, disabled: { opacity: 0.55 },
});
