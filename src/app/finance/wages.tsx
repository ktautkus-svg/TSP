import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import {
  PERIOD_OPTIONS,
  anchorFieldLabel,
  formatDateKey,
  formatDateRange,
  formatPeriodTitle,
  localDateKey,
  periodRange,
  type PeriodMode,
} from '@/application/reporting/period-range';
import { aggregateWageDays } from '@/application/finance/wage-report';
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { parseVehicleDayAssignmentId } from '@/domain/nll182-odometer-log';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const UNASSIGNED_DRIVER_ID = 'unassigned';

type DriverFinanceRow = {
  driverId: string;
  driverName: string;
  routes: number;
  km: number;
  fuelLiters: number;
  fuelCostEur: number;
  wageEur: number;
  totalEur: number;
  sheets: ServerTripSheet[];
};

const eurFormatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const kmFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });

export default function FinanceScreen() {
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const allowed = profile.role === 'admin' || (profile.role === 'dispatcher' && permissions.canManageFinancials);

  const [tripSheets, setTripSheets] = useState<ServerTripSheet[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const initialDate = useMemo(() => localDateKey(new Date()), []);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [anchorDate, setAnchorDate] = useState(initialDate);
  const [customFrom, setCustomFrom] = useState(initialDate);
  const [customTo, setCustomTo] = useState(initialDate);

  const load = useCallback(async () => {
    if (!online) { setError('Nėra ryšio su serveriu. Finansų ataskaita skaičiuojama serveryje.'); setBusy(false); return; }
    setBusy(true);
    try {
      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
      setTripSheets(response.tripSheets);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kelionės lapų gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [online]);

  useEffect(() => {
    if (!allowed) { router.replace(roleHomePath(profile.role) as Href); return; }
    void load();
  }, [allowed, load, profile.role, router]);

  const period = useMemo(() => periodRange(periodMode, anchorDate, customFrom, customTo), [anchorDate, customFrom, customTo, periodMode]);
  const visible = useMemo(() => tripSheets.filter((sheet) => sheet.date >= period.from && sheet.date <= period.to), [tripSheets, period]);
  const rows = useMemo(() => aggregateByDriver(visible), [visible]);
  const wageDays = useMemo(() => aggregateWageDays(visible), [visible]);
  const showDriverNames = useMemo(() => new Set(wageDays.map((day) => day.driverId)).size > 1, [wageDays]);
  const unassignedRow = useMemo(() => rows.find((row) => row.driverId === UNASSIGNED_DRIVER_ID) ?? null, [rows]);
  const totals = useMemo(() => {
    const operational = rows.reduce((sum, row) => ({
      routes: sum.routes + row.routes,
      km: sum.km + row.km,
      fuelLiters: sum.fuelLiters + row.fuelLiters,
      fuelCostEur: sum.fuelCostEur + row.fuelCostEur,
    }), { routes: 0, km: 0, fuelLiters: 0, fuelCostEur: 0 });
    // The headline and the visible list intentionally share the exact same
    // daily rows, so the displayed total cannot drift from the amounts below.
    const wageEur = wageDays.reduce((sum, day) => sum + day.wageEur, 0);
    return { ...operational, wageEur, totalEur: operational.fuelCostEur + wageEur };
  }, [rows, wageDays]);

  const deleteUnassigned = (row: DriverFinanceRow) => {
    Alert.alert(
      'Ištrinti neaiškias dienas?',
      `Bus visam laikui pašalinta ${row.sheets.length} ${row.sheets.length === 1 ? 'diena' : 'dienos'} be priskirto vairuotojo (kelionių lapų importas). Veiksmo atšaukti negalima.`,
      [
        { text: 'Atšaukti', style: 'cancel' },
        { text: 'Ištrinti', style: 'destructive', onPress: () => { void (async () => {
          setCleaningUp(true);
          const failures: string[] = [];
          for (const sheet of row.sheets) {
            // sheet.vehicle is null when the vehicle was renamed after this
            // reading was recorded (the old plate no longer resolves to a
            // live vehicle) — the raw id survives inside the assignment id,
            // which is built as vehicle-day-<vehicleId>-<date>.
            const vehicleId = sheet.vehicle?.id ?? parseVehicleDayAssignmentId(sheet.assignmentId)?.vehicleId ?? null;
            if (!vehicleId) { failures.push(sheet.date); continue; }
            try {
              await employeeApi(`/api/admin/trip-sheets/unassigned-day/${encodeURIComponent(vehicleId)}/${encodeURIComponent(sheet.date)}`, { method: 'DELETE' });
            } catch {
              failures.push(sheet.date);
            }
          }
          await load();
          setCleaningUp(false);
          if (failures.length > 0) setError(`Nepavyko ištrinti: ${failures.join(', ')}.`);
        })(); } },
      ],
    );
  };

  if (!allowed) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Darbuotojų atlygis' }} />
      <FoundationScreen
        contentMaxWidth={1100}
        description="Kiekvieno vairuotojo atlygis ir kuro sąnaudos pagal kelionės lapų faktinius duomenis."
        showFoundationNotice={false}
        title="Darbuotojų atlygis">

        <View style={styles.periodPanel} testID="finance-period-panel">
          <View style={styles.periodHeading}>
            <Text style={styles.periodTitle}>{formatPeriodTitle(periodMode, period.from, period.to)}</Text>
            <Text style={styles.periodSummary}>{formatDateRange(period.from, period.to)}</Text>
          </View>
          <View accessibilityLabel="Laikotarpio tipas" accessibilityRole="tablist" style={styles.periodTabs}>
            {PERIOD_OPTIONS.map((item) => <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: periodMode === item.key }}
              onPress={() => setPeriodMode(item.key)}
              style={[styles.periodTab, periodMode === item.key && styles.periodTabActive]}
              testID={`finance-period-${item.key}`}>
              <Text style={[styles.periodTabText, periodMode === item.key && styles.periodTabTextActive]}>{item.label}</Text>
            </Pressable>)}
          </View>
          <View style={styles.dateFields}>
            {periodMode === 'custom' ? <>
              <DateField label="Nuo" value={customFrom} onChange={setCustomFrom} styles={styles} />
              <DateField label="Iki" value={customTo} onChange={setCustomTo} styles={styles} />
            </> : <DateField label={anchorFieldLabel(periodMode)} value={anchorDate} onChange={setAnchorDate} styles={styles} />}
          </View>
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={colors.info} size="large" /> : null}

        {!busy && rows.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Pasirinktu laikotarpiu duomenų nėra</Text><Text style={styles.meta}>Pakeiskite laikotarpį arba patikrinkite, ar kelionės lapai užpildyti.</Text></View> : null}

        {!busy && rows.length > 0 ? <View style={styles.totalsRow} testID="finance-totals">
          <Metric label="Reisų" value={String(totals.routes)} styles={styles} />
          <Metric label="Km" value={kmFormatter.format(totals.km)} styles={styles} />
          <Metric label="Kuras" value={eurFormatter.format(totals.fuelCostEur)} styles={styles} />
          <Metric label="Atlygis" value={eurFormatter.format(totals.wageEur)} styles={styles} />
          <Metric label="Iš viso" value={eurFormatter.format(totals.totalEur)} emphasis styles={styles} />
        </View> : null}

        {!busy && wageDays.length > 0 ? <View style={styles.wageList} testID="finance-wage-days">
          <View style={styles.wageListHeading}>
            <Text style={styles.wageListTitle}>Atlygis pagal dieną</Text>
            <Text style={styles.meta}>Viena diena rodoma vieną kartą, nepriklausomai nuo reisų skaičiaus.</Text>
          </View>
          {wageDays.map((day) => <View key={day.key} style={styles.wageDayRow} testID={`finance-wage-day-${day.key}`}>
            <View style={styles.wageDayIdentity}>
              <Text style={styles.wageDayDate}>{formatDateKey(day.date)}</Text>
              {showDriverNames ? <Text style={styles.wageDayDriver}>{day.driverName}</Text> : null}
              {day.preliminary ? <Text style={styles.wageDayStatus}>Preliminaru</Text> : null}
            </View>
            <Text style={styles.wageDayAmount}>{eurFormatter.format(day.wageEur)}</Text>
          </View>)}
          {unassignedRow ? <View style={styles.unassignedCleanup}>
            <Text style={styles.meta}>Yra dienų be priskirto vairuotojo. Jei tai bandomieji importo įrašai, juos galima pašalinti.</Text>
            <Pressable disabled={cleaningUp} onPress={() => deleteUnassigned(unassignedRow)} style={[styles.dangerButton, cleaningUp && styles.disabled]} testID="finance-delete-unassigned">
              <Text style={styles.dangerButtonText}>{cleaningUp ? 'Šalinama…' : 'Ištrinti nepriskirtas dienas'}</Text>
            </Pressable>
          </View> : null}
        </View> : null}

        <Text style={styles.disclaimer}>Kuro suma skaičiuojama iš pylimų, kuriuose nurodyta kaina — jei kaina nenurodyta, litrai matomi, bet į € sumą neįskaičiuojami. Atlygis skaičiuojamas serveryje pagal vairuotojo sutartį. „Iš viso“ šiuo metu apima tik kurą ir atlygį — draudimas, kelių mokestis ir kitos sąnaudos į reiso kainos skaičiuoklę bus įtraukti atskirai vėliau.</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'finance-wages' } } as unknown as Href)}
          style={({ pressed }) => [styles.settingsLink, pressed && styles.settingsLinkPressed]}
          testID="finance-open-settings">
          <MenuArtwork kind="finance" size={44} />
          <View style={styles.flex}>
            <Text style={styles.settingsLinkTitle}>Kuro ir atlygio parametrai</Text>
            <Text style={styles.meta}>Kuro kaina, automobilių ir vairuotojų tarifai, naudojami maršruto kainos įverčiui.</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </FoundationScreen>
    </>
  );
}

function aggregateByDriver(sheets: readonly ServerTripSheet[]): DriverFinanceRow[] {
  const buckets = new Map<string, { driverId: string; driverName: string; routeIds: Set<string>; km: number; fuelLiters: number; fuelCostEur: number; sheets: ServerTripSheet[] }>();
  const wageByDriverDate = new Map<string, number>();
  const countedFuelEntryIds = new Set<string>();
  for (const sheet of sheets) {
    if (!buckets.has(sheet.driverId)) buckets.set(sheet.driverId, { driverId: sheet.driverId, driverName: sheet.driverName, routeIds: new Set(), km: 0, fuelLiters: 0, fuelCostEur: 0, sheets: [] });
    const bucket = buckets.get(sheet.driverId)!;
    bucket.routeIds.add(sheet.routeId);
    bucket.km += sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0;
    bucket.sheets.push(sheet);
    for (const entry of sheet.fuelEntries) {
      if (countedFuelEntryIds.has(entry.id)) continue;
      countedFuelEntryIds.add(entry.id);
      bucket.fuelLiters += entry.liters;
      bucket.fuelCostEur += entry.totalCost ?? 0;
    }
    // Compensation is computed per driver per day and attached to every sheet
    // from that day, so it must be deduped by driver+date before summing —
    // otherwise a driver with two routes the same day would be paid twice.
    if (sheet.compensation) {
      const key = `${sheet.driverId}:${sheet.date}`;
      if (!wageByDriverDate.has(key)) wageByDriverDate.set(key, sheet.compensation.totalNetEur);
    }
  }
  const wageByDriver = new Map<string, number>();
  for (const [key, value] of wageByDriverDate) {
    const driverId = key.slice(0, key.lastIndexOf(':'));
    wageByDriver.set(driverId, (wageByDriver.get(driverId) ?? 0) + value);
  }
  return [...buckets.values()]
    .map((bucket) => {
      const wageEur = wageByDriver.get(bucket.driverId) ?? 0;
      return {
        driverId: bucket.driverId,
        driverName: bucket.driverName,
        routes: bucket.routeIds.size,
        km: bucket.km,
        fuelLiters: bucket.fuelLiters,
        fuelCostEur: bucket.fuelCostEur,
        wageEur,
        totalEur: bucket.fuelCostEur + wageEur,
        sheets: bucket.sheets.sort((left, right) => right.date.localeCompare(left.date)),
      };
    })
    .sort((left, right) => right.totalEur - left.totalEur);
}

function Metric({ label, value, emphasis, styles }: { label: string; value: string; emphasis?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}>
    <Text style={[styles.metricValue, emphasis && styles.metricValueEmphasis]}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>;
}

function DateField({ label, value, onChange, styles }: { label: string; value: string; onChange: (value: string) => void; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.dateField}>
    <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
    <DateInput
      accessibilityLabel={label}
      onChangeText={onChange}
      style={styles.dateInput}
      value={value}
    />
  </View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  periodPanel: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  periodHeading: { gap: 2 },
  periodTitle: { ...type.sectionTitle, color: colors.text },
  periodSummary: { ...type.secondary, color: colors.textMuted },
  periodTabs: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  periodTab: { flex: 1, minWidth: 90, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSubtle },
  periodTabActive: { borderColor: colors.info, backgroundColor: colors.info },
  periodTabText: { ...type.button, color: colors.textSecondary },
  periodTabTextActive: { color: colors.textInverse },
  dateFields: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  dateField: { flex: 1, minWidth: 140, gap: 4 },
  fieldLabel: { ...type.label, color: colors.textMuted },
  dateInput: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, ...type.bodyStrong, color: colors.text },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  empty: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: 4 },
  emptyTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexGrow: 1, minWidth: 100, minHeight: 74, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  metricValue: { ...type.sectionTitle, color: colors.text },
  metricValueEmphasis: { color: colors.info },
  metricLabel: { ...type.label, color: colors.textMuted },
  wageList: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: 'hidden' },
  wageListHeading: { padding: spacing.md, gap: 2, backgroundColor: colors.surfaceSubtle },
  wageListTitle: { ...type.sectionTitle, color: colors.text },
  wageDayRow: { minHeight: 64, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  wageDayIdentity: { flex: 1, minWidth: 0, gap: 2 },
  wageDayDate: { ...type.bodyStrong, color: colors.text },
  wageDayDriver: { ...type.secondary, color: colors.textSecondary },
  wageDayStatus: { ...type.meta, color: colors.warning },
  wageDayAmount: { ...type.sectionTitle, color: colors.text, textAlign: 'right' },
  unassignedCleanup: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  dangerButton: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  dangerButtonText: { ...type.button, color: colors.danger },
  disabled: { opacity: 0.6 },
  disclaimer: { ...type.meta, color: colors.textMuted },
  settingsLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  settingsLinkPressed: { opacity: 0.85 },
  settingsLinkTitle: { ...type.bodyStrong, color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
