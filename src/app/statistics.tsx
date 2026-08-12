import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { StatBarChart } from '@/components/stat-bar-chart';
import { StatisticsRepository } from '@/database/repositories/statistics-repository';
import type { StatisticsPeriodTotals, StatisticsSnapshot } from '@/domain/statistics';
import { formatLithuanianDate } from '@/ui/history-labels';
import { durationLabel } from '@/ui/route-eta-labels';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { employeeApi, type EmployeeProfile, type ServerRouteAssignment } from '@/infrastructure/auth/employee-session';
import { buildStatisticsSnapshot, type FailureReasonCount, type StatsRouteRow } from '@/domain/statistics';

export default function StatisticsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new StatisticsRepository(db), [db]);
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [drivers, setDrivers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('all');
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void repository.getSnapshot(new Date(), 365, profile.role === 'driver' ? profile.id : null).then((data) => {
      if (!mounted) return;
      setSnapshot(data);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('STATISTICS_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Statistikos atkurti nepavyko.');
    });
    if (profile.role === 'admin' && online) {
      void Promise.all([
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
      ]).then(([users, routes]) => {
        if (!mounted) return;
        setDrivers(users.users.filter((user) => user.role === 'driver' && !user.disabled));
        setAssignments(routes.assignments);
      }).catch((reason) => {
        if (__DEV__) console.warn('ADMIN_STATISTICS_LOAD_FAILED', reason);
      });
    }
    return () => { mounted = false; };
  }, [online, profile.id, profile.role, repository]));

  const goHome = () => router.replace('/' as Href);

  const remoteSnapshot = useMemo(() => profile.role === 'admin' && assignments.length > 0
    ? assignmentStatistics(assignments, selectedDriverId)
    : null, [assignments, profile.role, selectedDriverId]);
  const displaySnapshot = remoteSnapshot ?? snapshot;
  const empty = displaySnapshot !== null && displaySnapshot.allTime.routeCount === 0;

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
      headerRight: () => null,
    }} />
    <View style={styles.screen}>
      <FoundationScreen
        showFoundationNotice={false}
        title="Statistika"
        description="Paskutinių 12 mėnesių užbaigti ir atšaukti maršrutai.">
      {profile.role === 'admin' && drivers.length > 0 ? (
        <View style={styles.driverFilters} testID="statistics-driver-filter">
          <Pressable onPress={() => setSelectedDriverId('all')} style={[styles.driverFilter, selectedDriverId === 'all' && styles.driverFilterActive]}><Text style={[styles.driverFilterText, selectedDriverId === 'all' && styles.driverFilterTextActive]}>Visi vairuotojai</Text></Pressable>
          {drivers.map((driver) => <Pressable key={driver.id} onPress={() => setSelectedDriverId(driver.id)} style={[styles.driverFilter, selectedDriverId === driver.id && styles.driverFilterActive]}><Text style={[styles.driverFilterText, selectedDriverId === driver.id && styles.driverFilterTextActive]}>{driver.displayName}</Text></Pressable>)}
        </View>
      ) : null}
      <Pressable style={styles.tripSheetButton} onPress={() => router.push('/trip-sheet' as Href)} testID="open-trip-sheets">
        <Text style={styles.tripSheetText}>Kelionės lapai</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.cardTitle}>Statistikos dar nėra</Text>
          <Text style={styles.meta}>Užbaikite bent vieną maršrutą — skaičiai atsiras čia.</Text>
        </View>
      ) : null}
      {displaySnapshot && !empty ? (
        <>
          <View style={styles.tileRow}>
            <SummaryTile styles={styles} label="Šiandien" totals={displaySnapshot.today} />
            <SummaryTile styles={styles} label="Ši savaitė" totals={displaySnapshot.thisWeek} />
            <SummaryTile styles={styles} label="Šis mėnuo" totals={displaySnapshot.thisMonth} />
            <SummaryTile styles={styles} label="12 mėn." totals={displaySnapshot.allTime} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kilometrai per dieną (30 d.)</Text>
            <StatBarChart
              colors={colors}
              color={colors.primary}
              data={displaySnapshot.dailySeries.map((day) => ({ label: shortDayLabel(day.date), value: day.km }))}
              valueFormatter={(value) => `${value.toFixed(0)} km`}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kilometrai per mėnesį (12 mėn.)</Text>
            <StatBarChart
              colors={colors}
              color={colors.info}
              data={displaySnapshot.monthlySeries.map((month) => ({ label: shortMonthLabel(month.month), value: month.km }))}
              valueFormatter={(value) => `${value.toFixed(0)} km`}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pristatymo baigtys (12 mėn.)</Text>
            <OutcomeBar styles={styles} colors={colors} totals={displaySnapshot.allTime} />
          </View>

          {displaySnapshot.failureReasons.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nesėkmės priežastys</Text>
              {displaySnapshot.failureReasons.map((item) => (
                <View key={item.reason} style={styles.failureRow}>
                  <Text style={styles.meta}>{item.reason}</Text>
                  <Text style={styles.failureCount}>{item.count}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {displaySnapshot.bestDay ? (
            <View style={styles.highlightCard}>
              <Text style={styles.cardTitle}>Geriausia diena</Text>
              <Text style={styles.meta}>
                {formatLithuanianDate(displaySnapshot.bestDay.date)} — {displaySnapshot.bestDay.km.toFixed(1)} km
                {displaySnapshot.bestDay.kmIsActual ? '' : ' (planuota)'}
              </Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vidurkiai (12 mėn.)</Text>
            <Text style={styles.meta}>Km taškui: {displaySnapshot.averageKmPerStop === null ? '—' : `${displaySnapshot.averageKmPerStop.toFixed(2)} km`}</Text>
            <Text style={styles.meta}>Taškų maršrutui: {displaySnapshot.averageStopsPerRoute === null ? '—' : displaySnapshot.averageStopsPerRoute.toFixed(1)}</Text>
            <Text style={styles.meta}>Maršruto trukmė: {displaySnapshot.averageRouteDurationMinutes === null ? '—' : durationLabel(displaySnapshot.averageRouteDurationMinutes)}</Text>
          </View>
        </>
      ) : null}
      {profile.role === 'admin' ? (
        <View style={styles.card} testID="statistics-route-results">
          <Text style={styles.cardTitle}>Atskiri maršrutų rezultatai</Text>
          {assignments
            .filter((assignment) => (selectedDriverId === 'all' || assignment.driverId === selectedDriverId) && ['completed', 'cancelled'].includes(String(assignment.routeSnapshot.route.status ?? assignment.status)))
            .map((assignment) => {
              const route = assignment.routeSnapshot.route;
              const summary = parseAssignmentSummary(route.completion_summary_json);
              return <View key={assignment.id} style={styles.routeResult}>
                <Text style={styles.routeResultTitle}>{assignmentRouteNumbers(assignment)} · {String(route.date ?? assignment.assignedAt.slice(0, 10))}</Text>
                <Text style={styles.meta}>{assignment.driverName} · pristatyta {summary?.deliveredStops ?? 0} · nepristatyta {summary?.failedStops ?? 0}</Text>
                <Text style={styles.meta}>Svoris {nullableMetric(route.total_weight_kg)?.toFixed(0) ?? '—'} kg · planuota {nullableMetric(route.estimated_distance_km)?.toFixed(1) ?? '—'} km · faktinė {nullableMetric(route.actual_distance_km)?.toFixed(1) ?? '—'} km</Text>
                <Text style={styles.meta}>Odometras {nullableMetric(route.start_odometer)?.toFixed(1) ?? '—'} → {nullableMetric(route.end_odometer)?.toFixed(1) ?? '—'}</Text>
              </View>;
            })}
        </View>
      ) : null}
      <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
      </FoundationScreen>
      {profile.role === 'driver' ? <DriverAppTabs active="statistics" /> : null}
    </View>
    </>
  );
}

function assignmentStatistics(assignments: ServerRouteAssignment[], driverId: string): StatisticsSnapshot {
  const selected = assignments.filter((assignment) => driverId === 'all' || assignment.driverId === driverId);
  const rows: StatsRouteRow[] = [];
  const failures = new Map<string, number>();
  for (const assignment of selected) {
    const route = assignment.routeSnapshot.route;
    const status = String(route.status ?? assignment.status);
    if (!['completed', 'cancelled'].includes(status)) continue;
    let completionSummary: StatsRouteRow['completionSummary'] = null;
    try {
      const raw = route.completion_summary_json;
      completionSummary = typeof raw === 'string' ? JSON.parse(raw) as StatsRouteRow['completionSummary'] : null;
    } catch { completionSummary = null; }
    rows.push({
      date: String(route.date ?? assignment.assignedAt.slice(0, 10)),
      status,
      estimatedDistanceKm: nullableMetric(route.estimated_distance_km),
      actualDistanceKm: nullableMetric(route.actual_distance_km),
      totalStops: Number(route.total_stops ?? assignment.routeSnapshot.stops.length),
      startedAt: typeof route.started_at === 'string' ? route.started_at : null,
      completedAt: typeof route.completed_at === 'string' ? route.completed_at : null,
      completionSummary,
    });
    for (const stop of assignment.routeSnapshot.stops) {
      if (stop.delivery_status !== 'failed' || typeof stop.failure_reason !== 'string') continue;
      failures.set(stop.failure_reason, (failures.get(stop.failure_reason) ?? 0) + 1);
    }
  }
  const failureCounts: FailureReasonCount[] = [...failures].map(([reason, count]) => ({ reason, count }));
  return buildStatisticsSnapshot(rows, failureCounts, new Date(), 365);
}

function nullableMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAssignmentSummary(value: unknown): StatsRouteRow['completionSummary'] {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as StatsRouteRow['completionSummary']; } catch { return null; }
}

function assignmentRouteNumbers(assignment: ServerRouteAssignment): string {
  const values = new Set(assignment.routeSnapshot.stops
    .map((stop) => typeof stop.order_number === 'string' ? stop.order_number.trim() : '')
    .filter(Boolean)
    .map((value) => /^R/i.test(value) ? value.toUpperCase() : `R${value}`));
  return values.size > 0 ? [...values].join(', ') : `R-${assignment.routeId.slice(-5).toUpperCase()}`;
}

function SummaryTile({ styles, label, totals }: { styles: ReturnType<typeof createStyles>; label: string; totals: StatisticsPeriodTotals }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{totals.totalKm.toFixed(0)} km</Text>
      <Text style={styles.tileMeta}>{totals.deliveredStops} pristatyta{totals.failedStops > 0 ? ` · ${totals.failedStops} nepavyko` : ''}</Text>
    </View>
  );
}

function OutcomeBar({ styles, colors, totals }: { styles: ReturnType<typeof createStyles>; colors: ColorPalette; totals: StatisticsPeriodTotals }) {
  const total = totals.deliveredStops + totals.failedStops + totals.unmarkedStops;
  if (total === 0) return <Text style={styles.meta}>Dar nėra pažymėtų taškų.</Text>;
  return (
    <>
      <View style={styles.outcomeBar}>
        <View style={{ flex: totals.deliveredStops, backgroundColor: colors.success }} />
        <View style={{ flex: totals.failedStops, backgroundColor: colors.danger }} />
        <View style={{ flex: totals.unmarkedStops, backgroundColor: colors.warning }} />
      </View>
      <View style={styles.outcomeLegendRow}>
        <Text style={[styles.outcomeLegend, { color: colors.success }]}>Pristatyta {totals.deliveredStops}</Text>
        <Text style={[styles.outcomeLegend, { color: colors.danger }]}>Nepavyko {totals.failedStops}</Text>
        <Text style={[styles.outcomeLegend, { color: colors.warning }]}>Nepažymėta {totals.unmarkedStops}</Text>
      </View>
    </>
  );
}

function shortDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat('lt-LT', { timeZone: 'Europe/Vilnius', day: '2-digit', month: '2-digit' }).format(date);
}

function shortMonthLabel(monthKey: string): string {
  const date = new Date(`${monthKey}-01T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return monthKey;
  return new Intl.DateTimeFormat('lt-LT', { timeZone: 'Europe/Vilnius', month: 'short', year: '2-digit' }).format(date);
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 900, backgroundColor: colors.background },
  driverFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  driverFilter: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  driverFilterActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  driverFilterText: { ...type.secondaryStrong, color: colors.textSecondary },
  driverFilterTextActive: { color: colors.info },
  routeResult: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  routeResultTitle: { ...type.bodyStrong, color: colors.text },
  empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  highlightCard: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.infoSoft, gap: spacing.xs },
  cardTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  error: { ...type.secondaryStrong, color: colors.danger },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, minWidth: '45%', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  tileLabel: { ...type.label, color: colors.textMuted },
  tileValue: { ...type.readout, color: colors.text },
  tileMeta: { color: colors.textMuted, fontSize: 13 },
  failureRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  failureCount: { ...type.bodyStrong, color: colors.text },
  outcomeBar: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
  outcomeLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  outcomeLegend: { ...type.meta },
  homeButton: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  tripSheetButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  tripSheetText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  homeText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.textInverse },
});
