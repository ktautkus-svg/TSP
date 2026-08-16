import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pushCompletedRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository, type TripSheetWithRoutes } from '@/database/repositories/trip-sheet-repository';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type DisplayTripSheet = ServerTripSheet & { source: 'server' | 'local' };
type DailyTripRow = {
  date: string;
  routeNumbers: string[];
  startAddress: string;
  endAddress: string;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number | null;
  fuelNorm: number | null;
  fuelConsumed: number | null;
  fuelAdded: number | null;
  fuelStart: number | null;
  fuelEnd: number | null;
  compensationEur: number | null;
};
type MonthlyTripGroup = {
  key: string;
  month: string;
  driverName: string;
  vehicle: ServerTripSheet['vehicle'];
  rows: DailyTripRow[];
};

export default function TripSheetScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const [sheets, setSheets] = useState<DisplayTripSheet[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (online) {
        if (profile.role === 'driver') await pushCompletedRouteAssignmentProgress(db);
        const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
        setSheets(response.tripSheets.map((sheet) => ({ ...sheet, source: 'server' })));
      } else {
        setSheets((await repository.list()).map(localSheet));
        setMessage('Rodomi šiame įrenginyje išsaugoti kelionės lapai. Prisijungus bus rodomi serverio duomenys.');
      }
    } catch (error) {
      const local = await repository.list().catch(() => []);
      setSheets(local.map(localSheet));
      setMessage(error instanceof Error ? error.message : 'Kelionės lapų atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [db, online, profile.role, repository]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const syncLocal = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await repository.syncAllCompletedDates();
      await load();
      setMessage('Kelionės lapai atnaujinti.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kelionės lapo atnaujinti nepavyko.');
      setBusy(false);
    }
  };

  const drivers = useMemo(() => [...new Map(sheets.map((sheet) => [sheet.driverId, sheet.driverName])).entries()], [sheets]);
  const visible = profile.role === 'driver' || selectedDriverId === 'all'
    ? sheets
    : sheets.filter((sheet) => sheet.driverId === selectedDriverId);
  const months = useMemo(() => [...new Set(sheets.map((sheet) => sheet.date.slice(0, 7)))].sort().reverse(), [sheets]);
  const monthVisible = selectedMonth === 'all' ? visible : visible.filter((sheet) => sheet.date.startsWith(selectedMonth));
  const monthlyGroups = useMemo(() => buildMonthlyGroups(monthVisible), [monthVisible]);
  const print = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.print();
    else setMessage('PDF arba spausdinimą atidarykite interneto naršyklėje.');
  };
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, title: 'Kelionės lapai' }} />
      <FoundationScreen showFoundationNotice={false} title="Kelionės lapai" description={profile.role === 'driver'
        ? 'Jūsų užbaigtų maršrutų faktiniai darbo duomenys.'
        : 'Visų vairuotojų užbaigti maršrutai, odometrai ir automobiliai.'}>
        <View style={styles.actionRow} testID="trip-sheet-controls">
          <Pressable style={styles.primaryButton} disabled={busy} onPress={() => { void load(); }} testID="refresh-trip-sheets">
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryText}>Atnaujinti</Text>}
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={print} testID="print-trip-sheets"><Text style={styles.secondaryText}>Spausdinti / PDF</Text></Pressable>
        </View>
        {!online ? <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => { void syncLocal(); }} testID="sync-trip-sheets"><Text style={styles.secondaryText}>Atnaujinti iš įrenginio maršrutų</Text></Pressable> : null}
        {profile.role !== 'driver' && drivers.length > 1 ? <View style={styles.filters} testID="trip-sheet-driver-filter">
          <Filter label="Visi vairuotojai" active={selectedDriverId === 'all'} onPress={() => setSelectedDriverId('all')} styles={styles} />
          {drivers.map(([id, name]) => <Filter key={id} label={name} active={selectedDriverId === id} onPress={() => setSelectedDriverId(id)} styles={styles} />)}
        </View> : null}
        {months.length > 1 ? <View style={styles.filters} testID="trip-sheet-month-filter">
          <Filter label="Visi mėnesiai" active={selectedMonth === 'all'} onPress={() => setSelectedMonth('all')} styles={styles} />
          {months.map((month) => <Filter key={month} label={formatMonth(month)} active={selectedMonth === month} onPress={() => setSelectedMonth(month)} styles={styles} />)}
        </View> : null}
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
        {!busy && monthlyGroups.length === 0 ? <View style={styles.empty}><Text style={styles.cardTitle}>Kelionės lapų dar nėra</Text><Text style={styles.meta}>Lapas atsiras automatiškai vairuotojui užbaigus priskirtą maršrutą ir įvedus galutinį odometrą.</Text></View> : null}
        {monthlyGroups.map((group) => <MonthlyTripSheet compact={width < 820} group={group} key={group.key} styles={styles} />)}
      </FoundationScreen>
    </>
  );
}

function MonthlyTripSheet({ group, compact, styles }: { group: MonthlyTripGroup; compact: boolean; styles: ReturnType<typeof createStyles> }) {
  const totalDistance = group.rows.reduce((sum, row) => sum + (row.distanceKm ?? 0), 0);
  const totalFuel = group.rows.reduce((sum, row) => sum + (row.fuelConsumed ?? 0), 0);
  const totalCompensation = group.rows.reduce((sum, row) => sum + (row.compensationEur ?? 0), 0);
  const hasCompensation = group.rows.some((row) => row.compensationEur !== null);
  const firstOdometer = group.rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null;
  const lastOdometer = [...group.rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null;
  return <View style={styles.sheet} testID={`monthly-trip-sheet-${group.key}`}>
    <View style={styles.sheetHeader}>
      <View style={styles.flex}>
        <Text style={styles.date}>{formatMonth(group.month)}</Text>
        <Text style={styles.driver}>{group.driverName}</Text>
      </View>
      <View style={styles.vehicleIdentity}>
        <Text style={styles.vehicleNumber}>{group.vehicle?.registrationNumber ?? 'Automobilis nepriskirtas'}</Text>
        {group.vehicle ? <Text style={styles.meta}>{group.vehicle.model}</Text> : null}
      </View>
    </View>

    <View style={styles.metrics}>
      <Metric label="ODOMETRAS" value={`${formatNumber(firstOdometer)} → ${formatNumber(lastOdometer)}`} styles={styles} />
      <Metric label="NUVAŽIUOTA" value={`${formatNumber(totalDistance)} km`} styles={styles} />
      <Metric label="KURAS PAGAL NORMĄ" value={`${formatNumber(totalFuel)} l`} styles={styles} />
      <Metric label="DEGALŲ NORMA" value={group.rows[0]?.fuelNorm === null ? '—' : `${formatNumber(group.rows[0]?.fuelNorm ?? null)} l/100 km`} styles={styles} />
      {hasCompensation ? <Metric label="ATLYGIS" value={formatMoney(totalCompensation)} styles={styles} /> : null}
    </View>

    {!compact ? <View style={styles.tableHeader}>
      <Text style={[styles.tableHeaderText, styles.dateColumn]}>Data</Text>
      <Text style={[styles.tableHeaderText, styles.routeColumn]}>Maršrutas</Text>
      <Text style={[styles.tableHeaderText, styles.numberColumn]}>Odometras pradžioje</Text>
      <Text style={[styles.tableHeaderText, styles.numberColumn]}>Odometras pabaigoje</Text>
      <Text style={[styles.tableHeaderText, styles.numberColumn]}>Atstumas</Text>
      <Text style={[styles.tableHeaderText, styles.numberColumn]}>Kuras pagal normą</Text>
      <Text style={[styles.tableHeaderText, styles.numberColumn]}>Įpilta</Text>
      <Text style={[styles.tableHeaderText, styles.numberColumn]}>Kuro likutis</Text>
      {hasCompensation ? <Text style={[styles.tableHeaderText, styles.moneyColumn]}>Atlygis</Text> : null}
    </View> : null}

    <View style={styles.tableBody}>
      {group.rows.map((row) => compact
        ? <View key={row.date} style={styles.mobileDayRow}>
          <View style={styles.mobileDayHeading}><Text style={styles.mobileDayDate}>{formatDate(row.date)}</Text><Text style={styles.routeBadgeText}>{row.routeNumbers.join(' · ') || 'Regiono kodas nenurodytas'}</Text></View>
          <Text numberOfLines={2} style={styles.routeAddress}>{row.startAddress} → {row.endAddress}</Text>
          <View style={styles.mobileDayMetrics}>
            <Metric label="ODOMETRAS" value={`${formatNumber(row.startOdometer)} → ${formatNumber(row.endOdometer)}`} styles={styles} />
            <Metric label="KM" value={formatNumber(row.distanceKm)} styles={styles} />
            <Metric label="KURO SĄNAUDOS" value={row.fuelConsumed === null ? '—' : `${formatNumber(row.fuelConsumed)} l`} styles={styles} />
            <Metric label="ĮPILTA" value={row.fuelAdded === null ? '—' : `${formatNumber(row.fuelAdded)} l`} styles={styles} />
            <Metric label="KURO LIKUTIS" value={row.fuelEnd === null ? '—' : `${formatNumber(row.fuelStart)} → ${formatNumber(row.fuelEnd)} l`} styles={styles} />
            {row.compensationEur !== null ? <Metric label="ATLYGIS" value={formatMoney(row.compensationEur)} styles={styles} /> : null}
          </View>
        </View>
        : <View key={row.date} style={styles.tableRow}>
          <Text style={[styles.tableCell, styles.dateColumn]}>{formatShortDate(row.date)}</Text>
          <View style={styles.routeColumn}><Text style={styles.tableStrong}>{row.routeNumbers.join(' · ') || '—'}</Text><Text numberOfLines={2} style={styles.tableMeta}>{row.startAddress} → {row.endAddress}</Text></View>
          <Text style={[styles.tableCell, styles.numberColumn]}>{formatNumber(row.startOdometer)}</Text>
          <Text style={[styles.tableCell, styles.numberColumn]}>{formatNumber(row.endOdometer)}</Text>
          <Text style={[styles.tableCell, styles.numberColumn]}>{row.distanceKm === null ? '—' : `${formatNumber(row.distanceKm)} km`}</Text>
          <Text style={[styles.tableCell, styles.numberColumn]}>{row.fuelConsumed === null ? '—' : `${formatNumber(row.fuelConsumed)} l`}</Text>
          <Text style={[styles.tableCell, styles.numberColumn]}>{row.fuelAdded === null ? '—' : `${formatNumber(row.fuelAdded)} l`}</Text>
          <Text style={[styles.tableCell, styles.numberColumn]}>{row.fuelEnd === null ? '—' : `${formatNumber(row.fuelStart)} → ${formatNumber(row.fuelEnd)} l`}</Text>
          {hasCompensation ? <Text style={[styles.tableCell, styles.moneyColumn]}>{row.compensationEur === null ? '—' : formatMoney(row.compensationEur)}</Text> : null}
        </View>)}
    </View>
    <Text style={styles.calculationNote}>Kuro sąnaudos skaičiuojamos: faktiniai dienos kilometrai × automobilio norma / 100. Kuro likutis rodomas, kai vairuotojas yra pateikęs pradinį likutį.</Text>
  </View>;
}

function buildMonthlyGroups(sheets: DisplayTripSheet[]): MonthlyTripGroup[] {
  const groups = new Map<string, { month: string; driverName: string; vehicle: ServerTripSheet['vehicle']; sheets: DisplayTripSheet[] }>();
  for (const sheet of sheets) {
    const month = sheet.date.slice(0, 7);
    const vehicleKey = sheet.vehicle?.id ?? 'no-vehicle';
    const key = `${month}:${sheet.driverId}:${vehicleKey}`;
    const current = groups.get(key) ?? { month, driverName: sheet.driverName, vehicle: sheet.vehicle, sheets: [] };
    current.sheets.push(sheet);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    month: group.month,
    driverName: group.driverName,
    vehicle: group.vehicle,
    rows: buildDailyRows(group.sheets),
  })).sort((left, right) => right.month.localeCompare(left.month) || left.driverName.localeCompare(right.driverName, 'lt'));
}

function buildDailyRows(sheets: DisplayTripSheet[]): DailyTripRow[] {
  const byDate = new Map<string, DisplayTripSheet[]>();
  for (const sheet of sheets) byDate.set(sheet.date, [...(byDate.get(sheet.date) ?? []), sheet]);
  const rows = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, daySheets]) => {
    const distanceValues = daySheets.map((sheet) => sheet.actualDistanceKm ?? sheet.plannedDistanceKm).filter((value): value is number => value !== null);
    const distanceKm = distanceValues.length > 0 ? distanceValues.reduce((sum, value) => sum + value, 0) : null;
    const fuelNorm = daySheets.find((sheet) => sheet.fuelNormLitersPer100Km !== null)?.fuelNormLitersPer100Km ?? null;
    const fuelConsumed = distanceKm !== null && fuelNorm !== null ? distanceKm * fuelNorm / 100 : null;
    const fuelStart = daySheets.find((sheet) => sheet.vehicle?.fuelRemainingLiters !== null && sheet.vehicle?.fuelRemainingLiters !== undefined)?.vehicle?.fuelRemainingLiters ?? null;
    return {
      date,
      routeNumbers: [...new Set(daySheets.flatMap((sheet) => sheet.routeNumbers))],
      startAddress: daySheets[0]?.startAddress ?? 'Pradžia nenurodyta',
      endAddress: daySheets[daySheets.length - 1]?.endAddress ?? 'Pabaiga nenurodyta',
      startOdometer: minimum(daySheets.map((sheet) => sheet.startOdometer)),
      endOdometer: maximum(daySheets.map((sheet) => sheet.endOdometer)),
      distanceKm,
      fuelNorm,
      fuelConsumed,
      fuelAdded: null,
      fuelStart,
      fuelEnd: fuelStart !== null && fuelConsumed !== null ? Math.max(0, fuelStart - fuelConsumed) : null,
      compensationEur: daySheets.find((sheet) => sheet.compensation)?.compensation?.totalNetEur ?? null,
    };
  });
  return rows.map((row, index) => {
    const previousEnd = index > 0 ? rows[index - 1]?.fuelEnd ?? null : null;
    return { ...row, fuelAdded: row.fuelStart !== null && previousEnd !== null ? Math.max(0, row.fuelStart - previousEnd) : null };
  });
}

function minimum(values: Array<number | null>): number | null { const present = values.filter((value): value is number => value !== null); return present.length > 0 ? Math.min(...present) : null; }
function maximum(values: Array<number | null>): number | null { const present = values.filter((value): value is number => value !== null); return present.length > 0 ? Math.max(...present) : null; }

function Filter({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable onPress={onPress} style={[styles.filter, active && styles.filterActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function localSheet(sheet: TripSheetWithRoutes): DisplayTripSheet {
  return {
    id: sheet.id, assignmentId: sheet.id, routeId: sheet.routeIds[0] ?? sheet.id, routeNumbers: [], date: sheet.date, status: 'completed',
    driverId: 'local', driverName: 'Šio įrenginio vairuotojas', vehicle: { id: sheet.vehicleId, registrationNumber: sheet.vehicleName, model: sheet.vehicleName, maximumPayloadKg: 0 }, fuelNormLitersPer100Km: null,
    startOdometer: sheet.startOdometer, endOdometer: sheet.endOdometer, actualDistanceKm: sheet.actualDistanceKm,
    plannedDistanceKm: sheet.plannedDistanceKm, startedAt: sheet.actualStartAt, completedAt: sheet.completedAt,
    durationMinutes: sheet.actualDurationMinutes, totalStops: sheet.totalStops, deliveredStops: sheet.totalStops,
    totalWeightKg: sheet.totalDeliveredWeightKg, deliveredWeightKg: sheet.totalDeliveredWeightKg,
    startAddress: sheet.startLocation.address ?? sheet.startLocation.label, endAddress: sheet.endLocation.address ?? sheet.endLocation.label, compensation: null, source: 'local',
  };
}

function formatDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { dateStyle: 'long' }).format(date); }
function formatShortDate(value: string): string { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { month: '2-digit', day: '2-digit' }).format(date); }
function formatMonth(value: string): string { const date = new Date(`${value}-15T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(date); }
function formatNumber(value: number | null): string { return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value); }
function formatDuration(minutes: number | null): string { if (minutes === null) return '—'; const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} val. ${rest} min.` : `${rest} min.`; }
function formatTime(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('lt-LT', { hour: '2-digit', minute: '2-digit' }).format(date); }
function formatMoney(value: number): string { return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minWidth: 120, minHeight: 48, justifyContent: 'center' }, headerText: { ...type.button, color: colors.brandNavy },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { flexGrow: 1, minWidth: 150, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }, secondaryText: { ...type.button, color: colors.textSecondary },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, filter: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, justifyContent: 'center' }, filterActive: { backgroundColor: colors.info, borderColor: colors.info }, filterText: { ...type.secondaryStrong, color: colors.text }, filterTextActive: { color: colors.textInverse },
  message: { ...type.secondary, color: colors.textMuted }, empty: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.xs },
  sheet: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, flex: { flex: 1, minWidth: 0 }, date: { ...type.sectionTitle, color: colors.text }, driver: { ...type.bodyStrong, color: colors.info, marginTop: 2 },
  vehicleIdentity: { alignItems: 'flex-end', gap: 2 },
  routeBadge: { borderRadius: radius.sm, backgroundColor: colors.infoSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, routeBadgeText: { ...type.label, color: colors.info },
  vehicleBar: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 2 }, vehicleNumber: { ...type.readout, color: colors.text },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { flexGrow: 1, minWidth: 115, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle, gap: 2 }, metricLabel: { ...type.label, color: colors.textMuted }, metricValue: { ...type.bodyStrong, color: colors.text },
  compensation: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surfaceSubtle, gap: spacing.sm }, compensationHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, compensationEyebrow: { ...type.label, color: colors.success }, compensationTotal: { ...type.readout, color: colors.text, marginTop: 2 }, compensationSource: { ...type.secondary, color: colors.textMuted }, compensationRows: { gap: 3 }, compensationLine: { ...type.secondary, color: colors.textSecondary },
  routeBlock: { borderLeftWidth: 3, borderLeftColor: colors.info, paddingLeft: spacing.sm, gap: 2 }, routeLabel: { ...type.label, color: colors.textMuted }, routeAddress: { ...type.body, color: colors.text }, cardTitle: { ...type.sectionTitle, color: colors.text }, meta: { ...type.secondary, color: colors.textMuted },
  tableHeader: { minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tableHeaderText: { ...type.label, color: colors.textMuted },
  tableBody: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  tableRow: { minHeight: 68, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tableCell: { ...type.secondary, color: colors.text, textAlign: 'right' },
  tableStrong: { ...type.bodyStrong, color: colors.text },
  tableMeta: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  dateColumn: { width: 72 },
  routeColumn: { flex: 1, minWidth: 180 },
  numberColumn: { width: 112, textAlign: 'right' },
  moneyColumn: { width: 92, textAlign: 'right' },
  mobileDayRow: { paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  mobileDayHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  mobileDayDate: { ...type.cardTitle, color: colors.text },
  mobileDayMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  calculationNote: { ...type.meta, color: colors.textMuted, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle },
});
