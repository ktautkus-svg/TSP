import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { AccountMenuSheet } from '@/components/account-menu-sheet';
import { BackIcon } from '@/components/app-icons';
import { TspBrand } from '@/components/tsp-brand';
import { classifyDeliveryWindow, minutesLate } from '@/domain/delivery-window-timing';
import { employeeApi, type QualityRouteMonitor, type QualityStopMonitor } from '@/infrastructure/auth/employee-session';
import { useForegroundInterval } from '@/hooks/use-foreground-interval';
import { formatWeightKg } from '@/ui/format-weight';
import { qualityBrandRed, qualityControlColors as colors } from '@/ui/quality-control-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

const REFRESH_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 120_000;
const MINOR_DELAY_MINUTES = 45;

type QualityFilter = 'in_progress' | 'waiting' | 'completed' | 'delivered';
type FilterTone = 'info' | 'warning' | 'success' | 'delivered';

const FILTERS: readonly { key: QualityFilter; label: string; tone: FilterTone }[] = [
  { key: 'in_progress', label: 'Kelyje', tone: 'info' },
  { key: 'waiting', label: 'Laukia', tone: 'warning' },
  { key: 'completed', label: 'Baigta', tone: 'success' },
  { key: 'delivered', label: 'Pristatyta', tone: 'delivered' },
];

export default function QualityControlScreen() {
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { width } = useWindowDimensions();
  // `colors` is the fixed quality-control palette imported at module scope, not
  // a themed value, so it is intentionally not a dependency here.
  const styles = useMemo(() => createStyles(colors), []);
  const [routes, setRoutes] = useState<QualityRouteMonitor[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [filter, setFilter] = useState<QualityFilter>('in_progress');
  const desktop = width >= 980;
  const mobile = width < 720;

  const load = useCallback(async (showSpinner = false) => {
    if (!online) {
      setError('Nėra ryšio su serveriu. Rodomi paskutiniai gauti duomenys.');
      setBusy(false);
      return;
    }
    if (showSpinner) setBusy(true);
    try {
      const response = await employeeApi<{ routes: QualityRouteMonitor[]; serverTime: string }>('/api/quality/routes');
      setRoutes(response.routes);
      setLastRefreshedAt(response.serverTime);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Maršrutų būsenos gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [online]);

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

  const today = localDateKey(new Date());
  const visible = routes.filter((route) => route.status !== 'completed' || route.date === today);
  const active = visible.filter((route) => route.status === 'in_progress');
  const waiting = visible.filter((route) => ['assigned', 'downloaded'].includes(route.status));
  const completed = visible.filter((route) => route.status === 'completed');
  const routesWithDeliveries = visible.filter((route) => route.deliveredStops > 0);
  const deliveredToday = visible.reduce((sum, route) => sum + route.deliveredStops, 0);
  const vehicleCount = new Set(visible.map((route) => route.vehicle?.id).filter(Boolean)).size;
  const filteredRoutes = filter === 'in_progress' ? active : filter === 'waiting' ? waiting : filter === 'completed' ? completed : routesWithDeliveries;
  const filterCounts: Record<QualityFilter, number> = {
    in_progress: active.length,
    waiting: waiting.length,
    completed: completed.length,
    delivered: deliveredToday,
  };

  return <SafeAreaView style={styles.safeArea}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}>
      {profile.role === 'quality' ? <View style={styles.headerNavButton} /> : <Pressable accessibilityLabel="Atgal" accessibilityRole="button" onPress={() => router.replace(parentTarget)} style={styles.headerNavButton}>
        <BackIcon size={22} color={colors.primary} />
      </Pressable>}
      <View style={styles.headerIdentity}>
        <TspBrand compact inverse={false} />
        {!mobile ? <View style={styles.headerDivider} /> : null}
        {!mobile ? <Text numberOfLines={1} style={styles.headerContext}>KOKYBĖS KONTROLĖ</Text> : null}
      </View>
      <View style={styles.headerActions}>
        <Pressable accessibilityLabel="Atidaryti paskyros meniu" accessibilityRole="button" onPress={() => setAccountMenuOpen(true)} style={({ pressed }) => [styles.accountButton, pressed && styles.accountButtonPressed]}>
          <Text style={styles.accountInitials}>{initials(profile.displayName)}</Text>
        </Pressable>
      </View>
    </View>
    <AccountMenuSheet visible={accountMenuOpen} onClose={() => setAccountMenuOpen(false)} />

    <ScrollView contentContainerStyle={[styles.page, mobile && styles.pageMobile]}>
      <View style={styles.heading}>
        <Text style={[styles.pageTitle, mobile && styles.pageTitleMobile]}>{formatDayTitle(new Date())}</Text>
        <Text style={styles.subtitle}>{formatVehicleCount(vehicleCount)} · {visible.length} {visible.length === 1 ? 'maršrutas' : 'maršrutai'}</Text>
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
      {busy && routes.length === 0 ? <ActivityIndicator color={colors.info} size="large" /> : null}
      {!busy && filteredRoutes.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>{emptyTitle(filter)}</Text><Text style={styles.muted}>Duomenys atsinaujina automatiškai kas 15 sekundžių.</Text></View> : null}

      {filteredRoutes.length > 0 ? <RouteSection title={filterTitle(filter)} count={filteredRoutes.length} routes={filteredRoutes} desktop={desktop} mobile={mobile} styles={styles} /> : null}
    </ScrollView>

    <View style={styles.bottomDock}>
      <View style={[styles.bottomDockInner, !mobile && styles.bottomDockInnerWide]}>
        <View accessibilityLabel="Maršrutų suvestinė" style={styles.filters}>
          {FILTERS.map((item) => <StatusFilter
            key={item.key}
            active={filter === item.key}
            label={item.label}
            onPress={() => setFilter(item.key)}
            styles={styles}
            tone={item.tone}
            value={filterCounts[item.key]}
          />)}
        </View>
        <View style={[styles.connection, !mobile && styles.connectionWide]}>
          <View style={[styles.liveDot, !online && styles.liveDotOffline]} />
          <View style={styles.flex}>
            <Text style={styles.liveLabel}>{online ? 'RYŠYS GERAS' : 'RYŠIO NĖRA'}</Text>
            <Text style={styles.refreshTime}>Atnaujinta {formatClock(lastRefreshedAt)}</Text>
          </View>
          <Pressable disabled={busy} onPress={() => void load(true)} style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshPressed, busy && styles.disabled]} testID="quality-refresh">
            {busy ? <ActivityIndicator color={colors.info} /> : <Text style={styles.refreshText}>Atnaujinti</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  </SafeAreaView>;
}

function RouteSection({ title, count, routes, desktop, mobile, styles }: { title: string; count: number; routes: QualityRouteMonitor[]; desktop: boolean; mobile: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.count}>{count}</Text></View>
    <View style={[styles.routeGrid, desktop && styles.routeGridDesktop]}>{routes.map((route) => <RouteCard key={route.id} route={route} desktop={desktop} mobile={mobile} styles={styles} />)}</View>
  </View>;
}

function RouteCard({ route, desktop, mobile, styles }: { route: QualityRouteMonitor; desktop: boolean; mobile: boolean; styles: ReturnType<typeof createStyles> }) {
  const [expanded, setExpanded] = useState(false);
  const stale = Date.now() - Date.parse(route.updatedAt) > STALE_AFTER_MS && route.status === 'in_progress';
  const completed = route.status === 'completed';
  const deliveredWeightKg = Math.max(0, route.totalWeightKg - route.remainingWeightKg);
  const weightPercent = route.totalWeightKg > 0 ? Math.round((deliveredWeightKg / route.totalWeightKg) * 100) : 0;

  return <View style={[styles.routeCard, mobile && styles.routeCardMobile, desktop && styles.routeCardDesktop, completed && styles.routeCardCompleted]} testID={`quality-route-${route.id}`}>
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

      <Text style={styles.regionCode}>{regionLabel(route.routeNumbers)}</Text>

      <View style={styles.progressGrid}>
        <ProgressReadout label="TAŠKAI" primary={`${route.remainingStops} / ${route.totalStops}`} secondary={`${route.deliveredStops} pristatyta`} percent={route.progressPercent} styles={styles} tone="points" />
        <ProgressReadout label="SVORIS" primary={`${formatWeightKg(route.remainingWeightKg)} / ${formatWeightKg(route.totalWeightKg)} kg`} secondary={`${formatWeightKg(deliveredWeightKg)} kg pristatyta`} percent={weightPercent} styles={styles} tone="weight" />
      </View>
      <View style={styles.startReadout}>
        <Text style={styles.startLabel}>{route.startedAt ? 'REALUS STARTAS' : 'PLANUOTAS STARTAS'}</Text>
        <Text style={styles.startValue}>{formatClockShort(route.startedAt ?? route.plannedStartAt ?? '')}</Text>
      </View>
      <Text style={styles.expandHint}>{expanded ? 'Slėpti maršruto informaciją' : 'Rodyti taškus ir laikus'}</Text>
    </Pressable>

    {expanded ? <View style={styles.details}>
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
        {formatWindow(stop) ? <Text style={styles.nextTime}>Langas {formatWindow(stop)}</Text> : null}
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
        {formatWindow(stop) ? <Text style={styles.processedWindow}>Langas {formatWindow(stop)}</Text> : null}
        {stop.routeNumber ? <Text style={styles.processedWindow}>Regionas {stop.routeNumber}</Text> : null}
      </View>
    </View>
    <View style={[styles.timingBadge, styles[`timingBadge_${timing.tone}`]]}><Text style={[styles.timingText, styles[`timingText_${timing.tone}`]]}>{next ? `TOLIAU · ${timing.label}` : timing.label}</Text></View>
  </View>;
}

function StatusFilter({ active, label, onPress, tone, value, styles }: { active: boolean; label: string; onPress: () => void; tone: FilterTone; value: number; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.filter, active && styles[`filterActive_${tone}`], pressed && styles.filterPressed]}>
    <Text style={[styles.filterValue, active && styles.filterValueActive]}>{value}</Text>
    <Text numberOfLines={1} style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
  </Pressable>;
}

function stopTiming(stop: QualityStopMonitor): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (stop.status === 'failed') return { label: stop.failedAt ? `Nepristatyta ${formatClockShort(stop.failedAt)}` : 'Nepristatyta', tone: 'danger' };
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

function filterTitle(filter: QualityFilter): string { return ({ in_progress: 'Kelyje', waiting: 'Laukia starto', completed: 'Baigti šiandien', delivered: 'Maršrutai su pristatytais taškais' })[filter]; }
function emptyTitle(filter: QualityFilter): string { return ({ in_progress: 'Šiuo metu niekas nevažiuoja', waiting: 'Laukiančių maršrutų nėra', completed: 'Šiandien baigtų maršrutų nėra', delivered: 'Šiandien dar niekas nepristatyta' })[filter]; }
function vehicleLabel(route: QualityRouteMonitor): string { return route.vehicle ? `${route.vehicle.registrationNumber} · ${route.vehicle.model}` : 'Automobilis nepriskirtas'; }
function regionLabel(codes: string[]): string { return codes.length > 0 ? `Regionai ${codes.join(', ')}` : 'Regionas nenurodytas'; }
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function statusLabel(status: QualityRouteMonitor['status']): string { return ({ assigned: 'Priskirtas', downloaded: 'Paruoštas', in_progress: 'Kelyje', completed: 'Baigtas', cancelled: 'Atšauktas' } as Record<string, string>)[status] ?? status; }
function formatDayTitle(value: Date): string { const text = new Intl.DateTimeFormat('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' }).format(value); return text.charAt(0).toUpperCase() + text.slice(1); }
function formatVehicleCount(value: number): string { if (value === 1) return '1 automobilis'; if (value % 10 >= 2 && value % 10 <= 9 && (value % 100 < 10 || value % 100 >= 20)) return `${value} automobiliai`; return `${value} automobilių`; }
function formatWindow(stop: QualityStopMonitor): string | null { if (!stop.deliveryTimeFrom && !stop.deliveryTimeTo) return null; return `${formatTimeValue(stop.deliveryTimeFrom) ?? '—'}–${formatTimeValue(stop.deliveryTimeTo) ?? '—'}`; }
function formatTimeValue(value: string | null): string | null { if (!value) return null; const match = /(\d{1,2}:\d{2})/.exec(value); return match?.[1] ?? formatClockShort(value); }
function formatClock(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date); }
function formatClockShort(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit' }).format(date); }
function formatRelative(value: string): string { const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000)); if (seconds < 45) return 'ką tik'; if (seconds < 3600) return `prieš ${Math.floor(seconds / 60)} min.`; return formatClock(value); }
function localDateKey(date: Date): string { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 68, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, borderTopWidth: 3, borderTopColor: qualityBrandRed, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  headerNavButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerDivider: { width: 1, height: 30, backgroundColor: colors.border },
  headerContext: { flexShrink: 1, ...type.label, fontFamily: fonts.heading, color: colors.primary, letterSpacing: 0.7 },
  accountButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }, accountButtonPressed: { backgroundColor: colors.primaryDark, transform: [{ scale: 0.96 }] }, accountInitials: { ...type.secondaryStrong, color: colors.textInverse },
  page: { flexGrow: 1, width: '100%', maxWidth: 1440, alignSelf: 'center', padding: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xl }, pageMobile: { padding: spacing.md, gap: spacing.md },
  heading: { gap: 3 }, pageTitle: { ...type.pageTitle, color: colors.primary, fontSize: 32, lineHeight: 38 }, pageTitleMobile: { fontSize: 26, lineHeight: 32 }, subtitle: { ...type.bodyStrong, color: qualityBrandRed },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  empty: { padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, emptyTitle: { ...type.sectionTitle, color: colors.text }, muted: { ...type.secondary, color: colors.textMuted },
  section: { gap: spacing.md }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, sectionTitle: { ...type.sectionTitle, color: colors.text, fontSize: 20, lineHeight: 26 }, count: { minWidth: 30, textAlign: 'center', paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.infoSoft, ...type.secondaryStrong, color: colors.info },
  routeGrid: { gap: spacing.md }, routeGridDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' }, routeCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', shadowColor: colors.primary, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 }, routeCardMobile: {}, routeCardDesktop: { width: '48.9%', flexGrow: 1, maxWidth: '50%' }, routeCardCompleted: { borderColor: colors.border },
  cardSummary: { padding: spacing.lg, gap: spacing.md }, cardSummaryPressed: { backgroundColor: colors.surfaceSubtle },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }, identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, avatar: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft }, avatarText: { ...type.bodyStrong, color: colors.info }, flex: { flex: 1, minWidth: 0 }, driverName: { ...type.sectionTitle, color: colors.text }, vehicle: { ...type.secondary, color: colors.textMuted, marginTop: 2 },
  cardState: { alignItems: 'flex-end', gap: spacing.xs }, expandIcon: { fontFamily: fonts.heading, fontSize: 21, lineHeight: 22, color: colors.primary },
  status: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill }, statusActive: { backgroundColor: colors.infoSoft }, statusWaiting: { backgroundColor: colors.warningSoft }, statusCompleted: { backgroundColor: colors.accentSoft }, statusText: { ...type.label }, statusTextActive: { color: colors.info }, statusTextWaiting: { color: colors.warning }, statusTextCompleted: { color: colors.success },
  regionCode: { ...type.bodyStrong, color: colors.info },
  progressGrid: { flexDirection: 'row', gap: spacing.sm }, progressBlock: { flex: 1, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle }, progressReadoutHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }, progressLabel: { ...type.label, color: colors.textMuted }, progressPercent: { ...type.meta, fontFamily: fonts.headingSemiBold, color: colors.primary }, progressPrimary: { ...type.bodyStrong, color: colors.text, marginTop: spacing.xs }, progressSecondary: { ...type.meta, color: colors.textMuted, marginTop: 1 }, progressTrack: { height: 6, marginTop: spacing.sm, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceMuted }, progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.info }, progressFillWeight: { backgroundColor: qualityBrandRed }, expandHint: { ...type.meta, textAlign: 'center', color: colors.textMuted },
  startReadout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.sm }, startLabel: { ...type.label, color: colors.textMuted }, startValue: { ...type.bodyStrong, color: colors.primary },
  details: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingTop: spacing.lg },
  nextStop: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.border }, nextSequence: { width: 56, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border }, nextSequenceLabel: { ...type.label, color: colors.info }, nextSequenceValue: { fontSize: 26, lineHeight: 32, fontFamily: fonts.heading, color: colors.info }, nextRecipient: { ...type.cardTitle, color: colors.text }, nextAddress: { ...type.body, color: colors.textSecondary, marginTop: 2 }, nextTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }, nextTime: { ...type.meta, fontFamily: fonts.headingSemiBold, color: colors.warning }, nextMeta: { ...type.meta, color: colors.info, marginTop: spacing.xs }, nextStopDone: { minHeight: 74, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, nextDoneText: { ...type.bodyStrong, color: colors.success },
  processedSection: { gap: spacing.sm }, processedTitle: { ...type.label, color: colors.textMuted }, processedStop: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderLeftWidth: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle }, processedStop_neutral: { borderLeftColor: colors.textMuted }, processedStop_success: { borderLeftColor: colors.success }, processedStop_warning: { borderLeftColor: colors.warning }, processedStop_danger: { borderLeftColor: colors.danger }, processedSequence: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted }, processedSequenceText: { ...type.secondaryStrong, color: colors.text }, processedRecipient: { ...type.bodyStrong, color: colors.text }, processedAddress: { ...type.meta, color: colors.textMuted }, processedWindow: { ...type.meta, color: colors.textSecondary, marginTop: 2 }, timingBadge: { maxWidth: 148, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm }, timingBadge_neutral: { backgroundColor: colors.surfaceMuted }, timingBadge_success: { backgroundColor: colors.accentSoft }, timingBadge_warning: { backgroundColor: colors.warningSoft }, timingBadge_danger: { backgroundColor: colors.dangerSoft }, timingText: { ...type.meta, fontFamily: fonts.headingSemiBold, textAlign: 'right' }, timingText_neutral: { color: colors.textMuted }, timingText_success: { color: colors.success }, timingText_warning: { color: colors.warning }, timingText_danger: { color: colors.danger }, noProcessed: { ...type.secondary, color: colors.textMuted },
  sequenceNext: { borderLeftColor: colors.info, backgroundColor: colors.infoSoft }, sequenceNextNumber: { backgroundColor: colors.info }, sequenceNextNumberText: { color: colors.textInverse }, sequenceMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle }, updated: { ...type.meta, color: colors.textMuted }, updatedStale: { color: colors.warning }, started: { ...type.meta, color: colors.textMuted },
  bottomDock: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, shadowColor: colors.primary, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, elevation: 8 }, bottomDockInner: { width: '100%', maxWidth: 1440, alignSelf: 'center', paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs }, bottomDockInnerWide: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  filters: { flex: 1, flexDirection: 'row', gap: spacing.xs }, filter: { flex: 1, minWidth: 0, minHeight: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border }, filterActive_info: { backgroundColor: colors.info, borderColor: colors.info }, filterActive_warning: { backgroundColor: colors.warning, borderColor: colors.warning }, filterActive_success: { backgroundColor: colors.success, borderColor: colors.success }, filterActive_delivered: { backgroundColor: colors.primary, borderColor: colors.primary }, filterPressed: { opacity: 0.82 }, filterValue: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 22, color: colors.text }, filterValueActive: { color: colors.textInverse }, filterLabel: { ...type.label, fontSize: 9, lineHeight: 12, color: colors.textMuted, marginTop: 2 }, filterLabelActive: { color: colors.textInverse },
  connection: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.sm }, connectionWide: { width: 310 }, liveDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.success }, liveDotOffline: { backgroundColor: colors.danger }, liveLabel: { ...type.label, color: colors.text }, refreshTime: { ...type.meta, color: colors.textMuted }, refreshButton: { minHeight: 40, minWidth: 92, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft }, refreshPressed: { backgroundColor: colors.primarySoft }, refreshText: { ...type.button, color: colors.info }, disabled: { opacity: 0.55 },
});
