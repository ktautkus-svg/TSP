import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { canViewOrgStatistics } from '@/application/auth/employee-permissions';
import { roleHomePath } from '@/application/navigation/role-home';
import { assignmentsToStatsRows } from '@/application/statistics/assignment-rows';
import { toEarningsRows, type EarningsSheetInput } from '@/application/statistics/earnings';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { FoundationScreen } from '@/components/foundation-screen';
import { StatBarChart } from '@/components/stat-bar-chart';
import { StatisticsRepository } from '@/database/repositories/statistics-repository';
import {
  PERIOD_PRESETS,
  bestPoint,
  buildStatsSeries,
  computeEarningsMetrics,
  computePeriodMetrics,
  percentChange,
  periodForPreset,
  previousPeriod,
  type EarningsMetrics,
  type FailureReasonCount,
  type PeriodMetrics,
  type PeriodPreset,
  type StatsPoint,
  type StatsRouteRow,
} from '@/domain/statistics';
import { employeeApi, type EmployeeProfile, type ServerRouteAssignment, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { devWarn } from '@/ui/dev-log';
import { formatLithuanianDate } from '@/ui/history-labels';
import { durationLabel } from '@/ui/route-eta-labels';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

const TABS = [
  { id: 'km', label: 'Kilometrai' },
  { id: 'stops', label: 'Taškai' },
  { id: 'weight', label: 'Svoris' },
  { id: 'earnings', label: 'Atlygis' },
  { id: 'quality', label: 'Kokybė' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Šiandien',
  week: 'Savaitė',
  month: 'Mėnuo',
  year: '12 mėn.',
  custom: 'Pasirinkti',
};

const numberFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });

function formatInt(value: number): string {
  return numberFormatter.format(Math.round(value));
}
function formatDecimal(value: number, fractionDigits = 1): string {
  return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: fractionDigits }).format(value);
}
function formatOrDash(value: number | null, formatValue: (value: number) => string): string {
  return value === null ? '—' : formatValue(value);
}

export default function StatisticsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new StatisticsRepository(db), [db]);

  const now = useMemo(() => new Date(), []);
  const orgCapable = canViewOrgStatistics(profile);

  const [localRows, setLocalRows] = useState<StatsRouteRow[]>([]);
  const [localFailures, setLocalFailures] = useState<FailureReasonCount[]>([]);
  const [drivers, setDrivers] = useState<EmployeeProfile[]>([]);
  const [assignments, setAssignments] = useState<ServerRouteAssignment[]>([]);
  const [tripSheets, setTripSheets] = useState<ServerTripSheet[]>([]);
  const [orgLoaded, setOrgLoaded] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState('all');
  const [selectedVehicleId, setSelectedVehicleId] = useState('all');
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('km');
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void repository.getRows(now, 365, profile.role === 'driver' ? profile.id : null).then(({ rows, failureCounts }) => {
      if (!mounted) return;
      setLocalRows(rows);
      setLocalFailures(failureCounts);
      setError(null);
    }).catch((reason) => {
      devWarn('STATISTICS_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Statistikos atkurti nepavyko.');
    });
    if (online) {
      void employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets')
        .then((result) => { if (mounted) setTripSheets(result.tripSheets); })
        .catch((reason) => devWarn('STATISTICS_TRIP_SHEETS_FAILED', reason));
    }
    if (orgCapable && online) {
      void Promise.all([
        employeeApi<{ users: EmployeeProfile[] }>('/api/admin/users'),
        employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
      ]).then(([users, routes]) => {
        if (!mounted) return;
        setDrivers(users.users.filter((user) => user.role === 'driver' && !user.disabled));
        setAssignments(routes.assignments);
        setOrgLoaded(true);
      }).catch((reason) => {
        devWarn('ADMIN_STATISTICS_LOAD_FAILED', reason);
      });
    }
    return () => { mounted = false; };
  }, [now, online, orgCapable, profile.id, profile.role, repository]));

  const vehicles = useMemo(() => [...new Map(
    assignments.map((assignment) => assignment.vehicle).filter((vehicle): vehicle is NonNullable<typeof vehicle> => Boolean(vehicle)).map((vehicle) => [vehicle.id, vehicle]),
  ).values()], [assignments]);

  const usingOrgData = orgCapable && orgLoaded;

  const { rows, failureCounts } = useMemo(() => {
    if (usingOrgData) return assignmentsToStatsRows(assignments, selectedDriverId, selectedVehicleId);
    return { rows: localRows, failureCounts: localFailures };
  }, [usingOrgData, assignments, selectedDriverId, selectedVehicleId, localRows, localFailures]);

  const earningsRows = useMemo(() => {
    const filteredSheets: EarningsSheetInput[] = usingOrgData
      ? tripSheets.filter((sheet) => (selectedDriverId === 'all' || sheet.driverId === selectedDriverId)
        && (selectedVehicleId === 'all' || sheet.vehicle?.id === selectedVehicleId))
      : tripSheets;
    return toEarningsRows(filteredSheets);
  }, [tripSheets, usingOrgData, selectedDriverId, selectedVehicleId]);
  const canSeeEarnings = tripSheets.length === 0 ? true : tripSheets.some((sheet) => sheet.compensation !== null);

  const empty = rows.length === 0;

  const period = useMemo(() => {
    if (preset !== 'custom') return periodForPreset(preset, now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) return periodForPreset('month', now);
    return periodForPreset('custom', now, { fromKey: customFrom, toKey: customTo });
  }, [preset, customFrom, customTo, now]);
  const previous = useMemo(() => previousPeriod(period), [period]);

  const current = useMemo(() => computePeriodMetrics(rows, failureCounts, period), [rows, failureCounts, period]);
  const previousMetrics = useMemo(() => computePeriodMetrics(rows, failureCounts, previous), [rows, failureCounts, previous]);
  const series = useMemo(() => buildStatsSeries(rows, period), [rows, period]);

  const quickToday = useMemo(() => computePeriodMetrics(rows, failureCounts, periodForPreset('today', now)), [rows, failureCounts, now]);
  const quickWeek = useMemo(() => computePeriodMetrics(rows, failureCounts, periodForPreset('week', now)), [rows, failureCounts, now]);
  const quickMonth = useMemo(() => computePeriodMetrics(rows, failureCounts, periodForPreset('month', now)), [rows, failureCounts, now]);
  const quickYear = useMemo(() => computePeriodMetrics(rows, failureCounts, periodForPreset('year', now)), [rows, failureCounts, now]);

  const earningsCurrent = useMemo(() => computeEarningsMetrics(earningsRows, period), [earningsRows, period]);
  const earningsPrevious = useMemo(() => computeEarningsMetrics(earningsRows, previous), [earningsRows, previous]);
  const earningsToday = useMemo(() => computeEarningsMetrics(earningsRows, periodForPreset('today', now)), [earningsRows, now]);
  const earningsWeek = useMemo(() => computeEarningsMetrics(earningsRows, periodForPreset('week', now)), [earningsRows, now]);
  const earningsMonth = useMemo(() => computeEarningsMetrics(earningsRows, periodForPreset('month', now)), [earningsRows, now]);
  const earningsYear = useMemo(() => computeEarningsMetrics(earningsRows, periodForPreset('year', now)), [earningsRows, now]);

  const goHome = () => router.replace(roleHomePath(profile.role) as Href);

  const applyCustomRange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      setCustomError('Įveskite abi datas formatu YYYY-MM-DD.');
      return;
    }
    setCustomError(null);
    setPreset('custom');
  };

  return (
    <>
    <Stack.Screen options={{ gestureEnabled: false }} />
    <View style={styles.screen}>
      <FoundationScreen
        showFoundationNotice={false}
        title="Statistika"
        description="Maršrutų, taškų, svorio, atlygio ir kokybės rodikliai pasirinktu laikotarpiu.">

        {orgCapable && drivers.length > 0 ? (
          <View style={styles.filterRow} testID="statistics-driver-filter">
            <Chip active={selectedDriverId === 'all'} label="Visi vairuotojai" onPress={() => setSelectedDriverId('all')} styles={styles} />
            {drivers.map((driver) => (
              <Chip key={driver.id} active={selectedDriverId === driver.id} label={driver.displayName} onPress={() => setSelectedDriverId(driver.id)} styles={styles} />
            ))}
          </View>
        ) : null}
        {orgCapable && vehicles.length > 0 ? (
          <View style={styles.filterRow} testID="statistics-vehicle-filter">
            <Chip active={selectedVehicleId === 'all'} label="Visi automobiliai" onPress={() => setSelectedVehicleId('all')} styles={styles} />
            {vehicles.map((vehicle) => (
              <Chip key={vehicle.id} active={selectedVehicleId === vehicle.id} label={vehicle.registrationNumber} onPress={() => setSelectedVehicleId(vehicle.id)} styles={styles} />
            ))}
          </View>
        ) : null}

        <View style={styles.filterRow} testID="statistics-period-filter">
          {PERIOD_PRESETS.map((item) => (
            <Chip key={item} active={preset === item} label={PERIOD_LABELS[item]} onPress={() => setPreset(item)} styles={styles} />
          ))}
        </View>
        {preset === 'custom' ? (
          <View style={styles.customRange} testID="statistics-custom-range">
            <TextInput accessibilityLabel="Nuo" value={customFrom} onChangeText={setCustomFrom}
              placeholder="Nuo, YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={styles.customInput} />
            <TextInput accessibilityLabel="Iki" value={customTo} onChangeText={setCustomTo}
              placeholder="Iki, YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={styles.customInput} />
            <Pressable onPress={applyCustomRange} style={styles.customApply}><Text style={styles.customApplyText}>Taikyti</Text></Pressable>
          </View>
        ) : null}
        {customError ? <Text style={styles.error}>{customError}</Text> : null}

        <Pressable style={styles.tripSheetButton} onPress={() => router.push({ pathname: '/trip-sheet', params: { returnTo: 'statistics' } } as Href)} testID="open-trip-sheets">
          <Text style={styles.tripSheetText}>Kelionės lapai</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.tabRow} testID="statistics-tabs">
          {TABS.map((tab) => (
            <Chip key={tab.id} active={activeTab === tab.id} label={tab.label} onPress={() => setActiveTab(tab.id)} styles={styles} />
          ))}
        </View>

        {empty && activeTab !== 'earnings' ? (
          <View style={styles.empty}>
            <Text style={styles.cardTitle}>Statistikos dar nėra</Text>
            <Text style={styles.meta}>Užbaikite bent vieną maršrutą — skaičiai atsiras čia.</Text>
          </View>
        ) : (
          <>
            {activeTab === 'km' ? (
              <KmTab styles={styles} colors={colors} current={current} previous={previousMetrics}
                series={series.points} granularity={series.granularity}
                today={quickToday} week={quickWeek} month={quickMonth} year={quickYear} />
            ) : null}
            {activeTab === 'stops' ? (
              <StopsTab styles={styles} colors={colors} current={current} previous={previousMetrics}
                series={series.points} granularity={series.granularity}
                today={quickToday} week={quickWeek} month={quickMonth} year={quickYear} />
            ) : null}
            {activeTab === 'weight' ? (
              <WeightTab styles={styles} colors={colors} current={current} previous={previousMetrics}
                series={series.points} granularity={series.granularity}
                today={quickToday} week={quickWeek} month={quickMonth} year={quickYear} />
            ) : null}
            {activeTab === 'earnings' ? (
              <EarningsTab styles={styles} colors={colors} current={earningsCurrent} previous={earningsPrevious}
                routeCount={current.routeCount} totalKm={current.totalKm} dayCount={current.dayCount}
                today={earningsToday} week={earningsWeek} month={earningsMonth} year={earningsYear}
                canSee={canSeeEarnings} />
            ) : null}
            {activeTab === 'quality' ? (
              <QualityTab styles={styles} colors={colors} current={current} previous={previousMetrics}
                series={series.points} granularity={series.granularity}
                today={quickToday} week={quickWeek} month={quickMonth} year={quickYear} />
            ) : null}
          </>
        )}

        {profile.role !== 'driver' ? <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable> : null}
      </FoundationScreen>
      {profile.role === 'driver' ? <DriverAppTabs active="statistics" /> : null}
    </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared scaffold pieces
// ---------------------------------------------------------------------------

function Chip({ active, label, onPress, styles }: { active: boolean; label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function BigNumber({ value, label, comparisonPercent, comparisonIsPoints, styles }: {
  value: string;
  label: string;
  comparisonPercent: number | null;
  /** True for a percentage-of-percentage metric (on-time %), where the delta is shown in points, not relative %. */
  comparisonIsPoints?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const up = comparisonPercent !== null && comparisonPercent > 0.05;
  const down = comparisonPercent !== null && comparisonPercent < -0.05;
  return (
    <View style={styles.bigNumberBlock}>
      <Text style={styles.bigNumber}>{value}</Text>
      <Text style={styles.bigNumberLabel}>{label}</Text>
      {comparisonPercent === null ? (
        <Text style={styles.comparisonMeta}>Nėra su kuo palyginti</Text>
      ) : (
        <Text style={[styles.comparisonValue, up && styles.comparisonUp, down && styles.comparisonDown]}>
          {up ? '▲' : down ? '▼' : '–'} {formatDecimal(Math.abs(comparisonPercent), 1)}{comparisonIsPoints ? ' p.p.' : '%'} nei ankstesnį tokį patį laikotarpį
        </Text>
      )}
    </View>
  );
}

function QuickCards({ items, styles }: { items: { label: string; value: string }[]; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.quickRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.quickCard}>
          <Text style={styles.quickLabel}>{item.label}</Text>
          <Text style={styles.quickValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Averages({ items, styles }: { items: { label: string; value: string }[]; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Vidurkiai</Text>
      {items.map((item) => <Text key={item.label} style={styles.meta}>{item.label}: {item.value}</Text>)}
    </View>
  );
}

function RecordCard({ dateKey, valueLabel, granularity, styles }: {
  dateKey: string;
  valueLabel: string;
  granularity: 'day' | 'month';
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.highlightCard}>
      <Text style={styles.cardTitle}>Rekordas</Text>
      <Text style={styles.meta}>{granularity === 'day' ? formatLithuanianDate(dateKey) : dateKey} — {valueLabel}</Text>
    </View>
  );
}

function chartData(points: StatsPoint[], metric: (point: StatsPoint) => number, granularity: 'day' | 'month'): { label: string; value: number }[] {
  return points.map((point) => ({ label: granularity === 'day' ? shortDayLabel(point.key) : shortMonthLabel(point.key), value: metric(point) }));
}

// ---------------------------------------------------------------------------
// Kilometrai
// ---------------------------------------------------------------------------

function KmTab({ styles, colors, current, previous, series, granularity, today, week, month, year }: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: StatsPoint[];
  granularity: 'day' | 'month';
  today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics; year: PeriodMetrics;
}) {
  const record = bestPoint(series, (point) => point.km);
  return (
    <>
      <BigNumber value={`${formatInt(current.totalKm)} km`} label="Pasirinktu laikotarpiu" comparisonPercent={percentChange(current.totalKm, previous.totalKm)} styles={styles} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Kilometrai {granularity === 'day' ? 'per dieną' : 'per mėnesį'}</Text>
        <StatBarChart colors={colors} color={colors.primary} data={chartData(series, (point) => point.km, granularity)} valueFormatter={(value) => `${value.toFixed(0)} km`} />
      </View>
      <QuickCards styles={styles} items={[
        { label: 'Šiandien', value: `${formatInt(today.totalKm)} km` },
        { label: 'Ši savaitė', value: `${formatInt(week.totalKm)} km` },
        { label: 'Šis mėnuo', value: `${formatInt(month.totalKm)} km` },
        { label: '12 mėn.', value: `${formatInt(year.totalKm)} km` },
      ]} />
      <Averages styles={styles} items={[
        { label: 'Vidutiniškai per dieną', value: formatOrDash(current.averageKmPerDay, (value) => `${formatDecimal(value)} km`) },
        { label: 'Km vienam taškui', value: formatOrDash(current.averageKmPerStop, (value) => `${formatDecimal(value, 2)} km`) },
        { label: 'Km vienam maršrutui', value: formatOrDash(current.averageKmPerRoute, (value) => `${formatDecimal(value)} km`) },
      ]} />
      {record ? <RecordCard dateKey={record.key} valueLabel={`${formatDecimal(record.km)} km${record.kmIsActual ? '' : ' (planuota)'}`} granularity={granularity} styles={styles} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Taškai
// ---------------------------------------------------------------------------

function StopsTab({ styles, colors, current, previous, series, granularity, today, week, month, year }: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: StatsPoint[];
  granularity: 'day' | 'month';
  today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics; year: PeriodMetrics;
}) {
  const record = bestPoint(series, (point) => point.deliveredStops);
  return (
    <>
      <BigNumber value={formatInt(current.deliveredStops)} label="Pristatyta taškų pasirinktu laikotarpiu" comparisonPercent={percentChange(current.deliveredStops, previous.deliveredStops)} styles={styles} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pristatyta taškų {granularity === 'day' ? 'per dieną' : 'per mėnesį'}</Text>
        <StatBarChart colors={colors} color={colors.success} data={chartData(series, (point) => point.deliveredStops, granularity)} valueFormatter={(value) => formatInt(value)} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pristatymų vykdymas</Text>
        <OutcomeBar styles={styles} colors={colors} delivered={current.deliveredStops} failed={current.failedStops} unmarked={current.unmarkedStops} />
      </View>
      {current.failureReasons.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nesėkmės priežastys</Text>
          {current.failureReasons.map((item) => (
            <View key={item.reason} style={styles.failureRow}>
              <Text style={styles.meta}>{item.reason}</Text>
              <Text style={styles.failureCount}>{item.count}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <QuickCards styles={styles} items={[
        { label: 'Šiandien', value: formatInt(today.deliveredStops) },
        { label: 'Ši savaitė', value: formatInt(week.deliveredStops) },
        { label: 'Šis mėnuo', value: formatInt(month.deliveredStops) },
        { label: '12 mėn.', value: formatInt(year.deliveredStops) },
      ]} />
      <Averages styles={styles} items={[
        { label: 'Taškų vienam maršrutui', value: formatOrDash(current.averageStopsPerRoute, (value) => formatDecimal(value, 1)) },
        { label: 'Taškų per dieną', value: formatOrDash(current.averageStopsPerDay, (value) => formatDecimal(value, 1)) },
      ]} />
      {record ? <RecordCard dateKey={record.key} valueLabel={`${formatInt(record.deliveredStops)} pristatyta`} granularity={granularity} styles={styles} /> : null}
    </>
  );
}

function OutcomeBar({ styles, colors, delivered, failed, unmarked }: { styles: ReturnType<typeof createStyles>; colors: ColorPalette; delivered: number; failed: number; unmarked: number }) {
  const total = delivered + failed + unmarked;
  if (total === 0) return <Text style={styles.meta}>Dar nėra pažymėtų taškų.</Text>;
  return (
    <>
      <View style={styles.outcomeBar}>
        <View style={{ flex: delivered, backgroundColor: colors.success }} />
        <View style={{ flex: failed, backgroundColor: colors.danger }} />
        <View style={{ flex: unmarked, backgroundColor: colors.warning }} />
      </View>
      <View style={styles.outcomeLegendRow}>
        <Text style={[styles.outcomeLegend, { color: colors.success }]}>Pristatyta {delivered}</Text>
        <Text style={[styles.outcomeLegend, { color: colors.danger }]}>Nepavyko {failed}</Text>
        <Text style={[styles.outcomeLegend, { color: colors.warning }]}>Nepažymėta {unmarked}</Text>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Svoris
// ---------------------------------------------------------------------------

function WeightTab({ styles, colors, current, previous, series, granularity, today, week, month, year }: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: StatsPoint[];
  granularity: 'day' | 'month';
  today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics; year: PeriodMetrics;
}) {
  const record = bestPoint(series, (point) => point.weightKg);
  return (
    <>
      <BigNumber value={`${formatInt(current.totalWeightKg)} kg`} label="Pasirinktu laikotarpiu" comparisonPercent={percentChange(current.totalWeightKg, previous.totalWeightKg)} styles={styles} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Svoris {granularity === 'day' ? 'per dieną' : 'per mėnesį'}</Text>
        <StatBarChart colors={colors} color={colors.info} data={chartData(series, (point) => point.weightKg, granularity)} valueFormatter={(value) => `${value.toFixed(0)} kg`} />
      </View>
      <QuickCards styles={styles} items={[
        { label: 'Šiandien', value: `${formatInt(today.totalWeightKg)} kg` },
        { label: 'Ši savaitė', value: `${formatInt(week.totalWeightKg)} kg` },
        { label: 'Šis mėnuo', value: `${formatInt(month.totalWeightKg)} kg` },
        { label: '12 mėn.', value: `${formatInt(year.totalWeightKg)} kg` },
      ]} />
      <Averages styles={styles} items={[
        { label: 'Kg vienam maršrutui', value: formatOrDash(current.averageWeightKgPerRoute, (value) => `${formatDecimal(value)} kg`) },
        { label: 'Kg vienam taškui', value: formatOrDash(current.averageWeightKgPerStop, (value) => `${formatDecimal(value)} kg`) },
        {
          label: 'Vidutinė apkrova nuo keliamosios galios',
          value: current.averageLoadPercent === null ? '— (reikia automobilio duomenų)' : `${formatDecimal(current.averageLoadPercent)} %`,
        },
      ]} />
      {record ? <RecordCard dateKey={record.key} valueLabel={`${formatDecimal(record.weightKg)} kg`} granularity={granularity} styles={styles} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Atlygis
// ---------------------------------------------------------------------------

function EarningsTab({ styles, colors, current, previous, routeCount, totalKm, dayCount, today, week, month, year, canSee }: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  current: EarningsMetrics;
  previous: EarningsMetrics;
  routeCount: number;
  totalKm: number;
  dayCount: number;
  today: EarningsMetrics; week: EarningsMetrics; month: EarningsMetrics; year: EarningsMetrics;
  canSee: boolean;
}) {
  if (!canSee) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Atlygis</Text>
        <Text style={styles.meta}>Šio profilio teisės neapima atlygio skaičiavimo peržiūros.</Text>
      </View>
    );
  }
  const perDay = dayCount === 0 ? null : current.totalEur / dayCount;
  const perRoute = routeCount === 0 ? null : current.totalEur / routeCount;
  const perKm = totalKm === 0 ? null : current.totalEur / totalKm;
  return (
    <>
      <BigNumber value={`${formatDecimal(current.totalEur)} €`} label="Pasirinktu laikotarpiu, netto" comparisonPercent={percentChange(current.totalEur, previous.totalEur)} styles={styles} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Atlygis {current.series.granularity === 'day' ? 'per dieną' : 'per mėnesį'}</Text>
        <StatBarChart colors={colors} color={colors.success} data={current.series.points.map((point) => ({ label: current.series.granularity === 'day' ? shortDayLabel(point.key) : shortMonthLabel(point.key), value: point.eur }))} valueFormatter={(value) => `${value.toFixed(0)} €`} />
      </View>
      <QuickCards styles={styles} items={[
        { label: 'Šiandien', value: `${formatDecimal(today.totalEur)} €` },
        { label: 'Ši savaitė', value: `${formatDecimal(week.totalEur)} €` },
        { label: 'Šis mėnuo', value: `${formatDecimal(month.totalEur)} €` },
        { label: '12 mėn.', value: `${formatDecimal(year.totalEur)} €` },
      ]} />
      <Averages styles={styles} items={[
        { label: 'Per dieną', value: formatOrDash(perDay, (value) => `${formatDecimal(value)} €`) },
        { label: 'Vienam maršrutui', value: formatOrDash(perRoute, (value) => `${formatDecimal(value)} €`) },
        { label: 'Vienam kilometrui', value: formatOrDash(perKm, (value) => `${formatDecimal(value, 2)} €`) },
      ]} />
      {current.bestDay ? <RecordCard dateKey={current.bestDay.key} valueLabel={`${formatDecimal(current.bestDay.eur)} €`} granularity={current.series.granularity} styles={styles} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Kokybė
// ---------------------------------------------------------------------------

function QualityTab({ styles, colors, current, previous, series, granularity, today, week, month, year }: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: StatsPoint[];
  granularity: 'day' | 'month';
  today: PeriodMetrics; week: PeriodMetrics; month: PeriodMetrics; year: PeriodMetrics;
}) {
  const onTimePercentOf = (point: StatsPoint): number | null =>
    point.onTimeStops + point.lateStops === 0 ? null : (point.onTimeStops / (point.onTimeStops + point.lateStops)) * 100;
  const record = series.reduce<{ key: string; percent: number } | null>((best, point) => {
    const percent = onTimePercentOf(point);
    if (percent === null) return best;
    if (!best || percent > best.percent) return { key: point.key, percent };
    return best;
  }, null);

  const pointDelta = current.onTimeWindowPercent === null || previous.onTimeWindowPercent === null
    ? null
    : current.onTimeWindowPercent - previous.onTimeWindowPercent;

  return (
    <>
      <BigNumber
        value={current.onTimeWindowPercent === null ? '—' : `${formatDecimal(current.onTimeWindowPercent)} %`}
        label="Pataikymas į laiko langą"
        comparisonPercent={pointDelta}
        comparisonIsPoints
        styles={styles}
      />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pataikymas į laiko langą {granularity === 'day' ? 'per dieną' : 'per mėnesį'}</Text>
        <StatBarChart colors={colors} color={colors.info} data={series.map((point) => ({ label: granularity === 'day' ? shortDayLabel(point.key) : shortMonthLabel(point.key), value: onTimePercentOf(point) ?? 0 }))} valueFormatter={(value) => `${value.toFixed(0)} %`} />
      </View>
      <QuickCards styles={styles} items={[
        { label: 'Šiandien', value: today.onTimeWindowPercent === null ? '—' : `${formatDecimal(today.onTimeWindowPercent)} %` },
        { label: 'Ši savaitė', value: week.onTimeWindowPercent === null ? '—' : `${formatDecimal(week.onTimeWindowPercent)} %` },
        { label: 'Šis mėnuo', value: month.onTimeWindowPercent === null ? '—' : `${formatDecimal(month.onTimeWindowPercent)} %` },
        { label: '12 mėn.', value: year.onTimeWindowPercent === null ? '—' : `${formatDecimal(year.onTimeWindowPercent)} %` },
      ]} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Maršrutai</Text>
        <Text style={styles.meta}>Vėluota bent viename taške: {current.routesWithLateStop}</Text>
        <Text style={styles.meta}>Visi taškai laiku: {current.routesFullyOnTime}</Text>
        <Text style={styles.meta}>Vidutinis vėlavimas minutėmis: — (šis rodiklis dar nerenkamas — sistema kol kas žymi tik „laiku“/„vėluoja“, be minučių)</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Planas prieš faktą</Text>
        <Text style={styles.meta}>Km: planuota {formatDecimal(current.plannedKm)} · faktinė {formatDecimal(current.actualKmForQuality)}</Text>
        <Text style={styles.meta}>Laikas: planuota {durationLabel(current.plannedDurationMinutes)} · faktinė {durationLabel(current.actualDurationMinutes)}</Text>
        <Text style={styles.meta}>Vidutinė maršruto trukmė: {current.averageRouteDurationMinutes === null ? '—' : durationLabel(current.averageRouteDurationMinutes)}</Text>
      </View>
      {record ? <RecordCard dateKey={record.key} valueLabel={`${formatDecimal(record.percent)} % laiku`} granularity={granularity} styles={styles} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  chip: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  chipActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  chipText: { ...type.secondaryStrong, color: colors.textSecondary },
  chipTextActive: { color: colors.info },
  customRange: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  customInput: { flexGrow: 1, minWidth: 140, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, paddingHorizontal: spacing.md, color: colors.text },
  customApply: { minHeight: 44, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  customApplyText: { ...type.button, color: colors.textInverse },
  empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  highlightCard: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.infoSoft, gap: spacing.xs },
  cardTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  error: { ...type.secondaryStrong, color: colors.danger },

  bigNumberBlock: { paddingVertical: spacing.sm, gap: 2 },
  bigNumber: { fontSize: 44, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  bigNumberLabel: { ...type.secondary, color: colors.textMuted },
  comparisonValue: { ...type.secondaryStrong, color: colors.textMuted },
  comparisonUp: { color: colors.success },
  comparisonDown: { color: colors.danger },
  comparisonMeta: { ...type.secondary, color: colors.textMuted },

  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickCard: { flexGrow: 1, minWidth: '45%', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  quickLabel: { ...type.label, color: colors.textMuted },
  quickValue: { ...type.readout, color: colors.text },

  failureRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  failureCount: { ...type.bodyStrong, color: colors.text },
  outcomeBar: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
  outcomeLegendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  outcomeLegend: { ...type.meta },

  homeButton: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  tripSheetButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  tripSheetText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  homeText: { ...type.button, color: colors.textSecondary },
});
