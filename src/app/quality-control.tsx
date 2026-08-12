import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { AccountMenuSheet } from '@/components/account-menu-sheet';
import { BrandHeader } from '@/components/brand-header';
import { employeeApi, type QualityRouteMonitor } from '@/infrastructure/auth/employee-session';
import { formatWeightKg } from '@/ui/format-weight';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const REFRESH_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 120_000;

export default function QualityControlScreen() {
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [routes, setRoutes] = useState<QualityRouteMonitor[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
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

  useEffect(() => {
    if (profile.role !== 'quality') {
      router.replace('/' as Href);
      return;
    }
    void load(true);
    const timer = setInterval(() => { void load(false); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load, profile.role, router]);

  const today = localDateKey(new Date());
  const visible = routes.filter((route) => route.status !== 'completed' || route.date === today);
  const active = visible.filter((route) => route.status === 'in_progress');
  const waiting = visible.filter((route) => ['assigned', 'downloaded'].includes(route.status));
  const completed = visible.filter((route) => route.status === 'completed');
  const deliveredToday = visible.reduce((sum, route) => sum + route.deliveredStops, 0);

  return <SafeAreaView style={styles.safeArea}>
    <Stack.Screen options={{ headerShown: false }} />
    <BrandHeader onMenuPress={() => setAccountMenuOpen(true)} showNotifications={false} showSyncStatus={false} />
    <AccountMenuSheet visible={accountMenuOpen} onClose={() => setAccountMenuOpen(false)} />
    <ScrollView contentContainerStyle={[styles.page, mobile && styles.pageMobile]}>
      <View style={[styles.topbar, mobile && styles.topbarMobile]}>
        <View style={[styles.heading, mobile && styles.headingMobile]}>
          <Text style={styles.eyebrow}>KOKYBĖS KONTROLĖ</Text>
          <Text style={styles.pageTitle}>Maršrutai gyvai</Text>
          {!mobile ? <Text style={styles.subtitle}>Tik stebėjimas · duomenys automatiškai atnaujinami kas 15 sekundžių</Text> : null}
        </View>
        <View style={[styles.livePanel, mobile && styles.livePanelMobile]}>
          <View style={[styles.liveDot, !online && styles.liveDotOffline]} />
          <View style={styles.flex}><Text style={styles.liveLabel}>{online ? 'DUOMENYS ATNAUJINAMI' : 'RYŠIO NĖRA'}</Text><Text style={styles.refreshTime}>Atnaujinta {formatClock(lastRefreshedAt)}</Text></View>
          <Pressable disabled={busy} onPress={() => void load(true)} style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshPressed, busy && styles.disabled]} testID="quality-refresh">
            {busy ? <ActivityIndicator color={colors.info} /> : <Text style={styles.refreshText}>Atnaujinti</Text>}
          </Pressable>
        </View>
      </View>

      <View style={[styles.metrics, mobile && styles.metricsMobile]} accessibilityLabel="Maršrutų suvestinė">
        <SummaryMetric compact={mobile} label="Kelyje" value={active.length} tone="info" styles={styles} />
        <SummaryMetric compact={mobile} label="Laukia" value={waiting.length} tone="warning" styles={styles} />
        <SummaryMetric compact={mobile} label="Baigta" value={completed.length} tone="success" styles={styles} />
        <SummaryMetric compact={mobile} label="Pristatyta" value={deliveredToday} tone="neutral" styles={styles} />
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
      {!busy && visible.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Šiuo metu maršrutų nėra</Text><Text style={styles.muted}>Čia automatiškai atsiras vairuotojams priskirti maršrutai.</Text></View> : null}

      {active.length > 0 ? <RouteSection title="Kelyje" count={active.length} routes={active} desktop={desktop} mobile={mobile} styles={styles} /> : null}
      {waiting.length > 0 ? <RouteSection title="Laukia starto" count={waiting.length} routes={waiting} desktop={desktop} mobile={mobile} styles={styles} /> : null}
      {completed.length > 0 ? <RouteSection title="Baigti šiandien" count={completed.length} routes={completed} desktop={desktop} mobile={mobile} styles={styles} /> : null}
    </ScrollView>
  </SafeAreaView>;
}

function RouteSection({ title, count, routes, desktop, mobile, styles }: { title: string; count: number; routes: QualityRouteMonitor[]; desktop: boolean; mobile: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.count}>{count}</Text></View>
    <View style={[styles.routeGrid, desktop && styles.routeGridDesktop]}>{routes.map((route) => <RouteCard key={route.id} route={route} desktop={desktop} mobile={mobile} styles={styles} />)}</View>
  </View>;
}

function RouteCard({ route, desktop, mobile, styles }: { route: QualityRouteMonitor; desktop: boolean; mobile: boolean; styles: ReturnType<typeof createStyles> }) {
  const stale = Date.now() - Date.parse(route.updatedAt) > STALE_AFTER_MS && route.status === 'in_progress';
  const completed = route.status === 'completed';
  return <View style={[styles.routeCard, mobile && styles.routeCardMobile, desktop && styles.routeCardDesktop, completed && styles.routeCardCompleted]} testID={`quality-route-${route.id}`}>
    <View style={styles.cardHeader}>
      <View style={styles.identity}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(route.driverName)}</Text></View>
        <View style={styles.flex}><Text style={styles.driverName}>{route.driverName}</Text><Text style={styles.vehicle}>{vehicleLabel(route)}</Text></View>
      </View>
      <View style={[styles.status, completed ? styles.statusCompleted : route.status === 'in_progress' ? styles.statusActive : styles.statusWaiting]}><Text style={[styles.statusText, completed ? styles.statusTextCompleted : route.status === 'in_progress' ? styles.statusTextActive : styles.statusTextWaiting]}>{statusLabel(route.status)}</Text></View>
    </View>

    <View style={styles.routeMeta}><Text style={styles.routeNumber}>{route.totalStops} pristatymų · {formatWeightKg(route.totalWeightKg)} kg</Text><Text style={styles.muted}>{formatDate(route.date)}</Text></View>

    <View style={styles.progressHeader}><Text style={styles.progressValue}>{route.deliveredStops} iš {route.totalStops} taškų</Text><Text style={styles.percent}>{route.progressPercent}%</Text></View>
    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, route.progressPercent))}%` }]} /></View>
    <View style={styles.progressDetails}>
      <Text style={styles.delivered}>{route.deliveredStops} pristatyta</Text>
      {route.failedStops > 0 ? <Text style={styles.failed}>{route.failedStops} nepristatyta</Text> : null}
      <Text style={styles.remaining}>{route.remainingStops} liko</Text>
    </View>

    {route.nextStop ? <View style={styles.nextStop}>
      <View style={styles.nextSequence}><Text style={styles.nextSequenceLabel}>TOLIAU</Text><Text style={styles.nextSequenceValue}>{route.nextStop.sequence}</Text></View>
      <View style={styles.flex}><Text style={styles.nextRecipient}>{route.nextStop.recipient}</Text><Text numberOfLines={2} style={styles.nextAddress}>{route.nextStop.address}</Text><Text style={styles.nextMeta}>{route.nextStop.routeNumber ? `Užsakymo Nr. ${route.nextStop.routeNumber} · ` : ''}{formatWeightKg(route.remainingWeightKg)} kg likę</Text></View>
    </View> : <View style={styles.nextStopDone}><Text style={styles.nextDoneText}>{completed ? 'Maršrutas užbaigtas' : 'Visi pristatymo taškai apdoroti'}</Text></View>}

    <View style={styles.cardFooter}><Text style={[styles.updated, stale && styles.updatedStale]}>{stale ? 'Duomenys vėluoja · ' : ''}Atnaujinta {formatRelative(route.updatedAt)}</Text><Text style={styles.started}>{route.startedAt ? `Startas ${formatClock(route.startedAt)}` : 'Dar nepradėtas'}</Text></View>
  </View>;
}

function SummaryMetric({ label, value, tone, compact, styles }: { label: string; value: number; tone: 'info' | 'warning' | 'success' | 'neutral'; compact: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={[styles.metric, compact && styles.metricCompact]}><View style={[styles.metricAccent, compact && styles.metricAccentCompact, styles[`metricAccent_${tone}`]]} /><Text style={[styles.metricValue, compact && styles.metricValueCompact]}>{value}</Text><Text numberOfLines={1} style={[styles.metricLabel, compact && styles.metricLabelCompact]}>{label}</Text></View>;
}

function vehicleLabel(route: QualityRouteMonitor): string { return route.vehicle ? `${route.vehicle.registrationNumber} · ${route.vehicle.model}` : 'Automobilis nepriskirtas'; }
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }
function statusLabel(status: QualityRouteMonitor['status']): string { return ({ assigned: 'Priskirtas', downloaded: 'Paruoštas', in_progress: 'Kelyje', completed: 'Baigtas', cancelled: 'Atšauktas' } as Record<string, string>)[status] ?? status; }
function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { weekday: 'short', month: 'short', day: 'numeric' }).format(date); }
function formatClock(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date); }
function formatRelative(value: string): string { const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000)); if (seconds < 45) return 'ką tik'; if (seconds < 3600) return `prieš ${Math.floor(seconds / 60)} min.`; return formatClock(value); }
function localDateKey(date: Date): string { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background }, page: { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: spacing.xl, paddingBottom: 80, gap: spacing.xl }, pageMobile: { padding: spacing.md, paddingBottom: 48, gap: spacing.md },
  topbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg }, heading: { flex: 1, minWidth: 280, gap: 3 },
  topbarMobile: { gap: spacing.sm }, headingMobile: { minWidth: 0, width: '100%' }, eyebrow: { ...type.label, color: colors.info }, pageTitle: { ...type.pageTitle, color: colors.text, fontSize: 34, lineHeight: 40 }, subtitle: { ...type.body, color: colors.textMuted },
  livePanel: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  livePanelMobile: { width: '100%', minHeight: 48 },
  liveDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.success }, liveDotOffline: { backgroundColor: colors.danger }, liveLabel: { ...type.label, color: colors.text }, refreshTime: { ...type.meta, color: colors.textMuted },
  refreshButton: { minHeight: 56, paddingHorizontal: spacing.lg, justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: colors.border }, refreshPressed: { backgroundColor: colors.infoSoft }, refreshText: { ...type.button, color: colors.info }, disabled: { opacity: 0.55 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, metricsMobile: { flexWrap: 'nowrap', gap: spacing.xs }, metric: { flexGrow: 1, minWidth: 185, minHeight: 106, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' }, metricCompact: { flex: 1, flexGrow: 1, minWidth: 0, minHeight: 58, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  metricAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 }, metricAccent_info: { backgroundColor: colors.info }, metricAccent_warning: { backgroundColor: colors.warning }, metricAccent_success: { backgroundColor: colors.success }, metricAccent_neutral: { backgroundColor: colors.textSecondary },
  metricAccentCompact: { left: 0, right: 0, top: 0, bottom: undefined, width: undefined, height: 3 }, metricValue: { fontSize: 32, lineHeight: 38, fontFamily: fonts.heading, color: colors.text }, metricValueCompact: { fontSize: 20, lineHeight: 24 }, metricLabel: { ...type.label, color: colors.textMuted, marginTop: spacing.xs }, metricLabelCompact: { fontSize: 9, lineHeight: 12, marginTop: 1, textTransform: 'uppercase' }, warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  empty: { padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, emptyTitle: { ...type.sectionTitle, color: colors.text },
  section: { gap: spacing.md }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, sectionTitle: { ...type.sectionTitle, color: colors.text, fontSize: 20, lineHeight: 26 }, count: { minWidth: 30, textAlign: 'center', paddingVertical: 4, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.infoSoft, ...type.secondaryStrong, color: colors.info },
  routeGrid: { gap: spacing.md }, routeGridDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' }, routeCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md }, routeCardMobile: { padding: spacing.md, gap: spacing.sm }, routeCardDesktop: { width: '48.9%', flexGrow: 1, maxWidth: '50%' }, routeCardCompleted: { borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }, identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, avatar: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoSoft }, avatarText: { ...type.bodyStrong, color: colors.info }, flex: { flex: 1, minWidth: 0 }, driverName: { ...type.sectionTitle, color: colors.text }, vehicle: { ...type.secondary, color: colors.textMuted, marginTop: 2 },
  status: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill }, statusActive: { backgroundColor: colors.infoSoft }, statusWaiting: { backgroundColor: colors.warningSoft }, statusCompleted: { backgroundColor: colors.accentSoft }, statusText: { ...type.label }, statusTextActive: { color: colors.info }, statusTextWaiting: { color: colors.warning }, statusTextCompleted: { color: colors.success },
  routeMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, routeNumber: { ...type.bodyStrong, color: colors.info }, muted: { ...type.secondary, color: colors.textMuted },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }, progressValue: { ...type.bodyStrong, color: colors.text }, percent: { ...type.readout, color: colors.info }, progressTrack: { height: 10, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.surfaceMuted }, progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.info }, progressDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, delivered: { ...type.secondaryStrong, color: colors.success }, failed: { ...type.secondaryStrong, color: colors.danger }, remaining: { ...type.secondaryStrong, color: colors.textMuted },
  nextStop: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, borderWidth: 1, borderColor: colors.border }, nextSequence: { width: 56, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border }, nextSequenceLabel: { ...type.label, color: colors.info }, nextSequenceValue: { fontSize: 26, lineHeight: 32, fontFamily: fonts.heading, color: colors.info }, nextRecipient: { ...type.cardTitle, color: colors.text }, nextAddress: { ...type.body, color: colors.textSecondary, marginTop: 2 }, nextMeta: { ...type.meta, color: colors.info, marginTop: spacing.xs },
  nextStopDone: { minHeight: 74, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, nextDoneText: { ...type.bodyStrong, color: colors.success },
  cardFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle }, updated: { ...type.meta, color: colors.textMuted }, updatedStale: { color: colors.warning }, started: { ...type.meta, color: colors.textMuted },
});
