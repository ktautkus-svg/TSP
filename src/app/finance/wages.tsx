import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import {
  calendarPresetRange,
  formatDateKey,
} from '@/application/reporting/period-range';
import { aggregateWageDays, type WageDayRow } from '@/application/finance/wage-report';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { PeriodCalendarPicker } from '@/components/period-calendar-picker';
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
const eur2Formatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kmFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });

const ALL_DRIVERS = 'all';

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
  const initialPeriod = useMemo(() => calendarPresetRange('thisMonth'), []);
  const [periodFrom, setPeriodFrom] = useState(initialPeriod.from);
  const [periodTo, setPeriodTo] = useState(initialPeriod.to);
  const [driverFilter, setDriverFilter] = useState<string>(ALL_DRIVERS);
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

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

  const period = useMemo(() => ({ from: periodFrom, to: periodTo }), [periodFrom, periodTo]);
  const inPeriod = useMemo(
    () => tripSheets.filter((sheet) => sheet.date >= period.from && sheet.date <= period.to),
    [tripSheets, period],
  );
  const drivers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const sheet of inPeriod) if (!seen.has(sheet.driverId)) seen.set(sheet.driverId, sheet.driverName);
    return [...seen].map(([driverId, driverName]) => ({ driverId, driverName }))
      .sort((left, right) => left.driverName.localeCompare(right.driverName, 'lt'));
  }, [inPeriod]);
  // A driver filter chosen for one period may not exist in another — fall back
  // to "all" rather than showing an empty report.
  const activeDriver = driverFilter !== ALL_DRIVERS && drivers.some((driver) => driver.driverId === driverFilter)
    ? driverFilter
    : ALL_DRIVERS;
  const visible = useMemo(
    () => inPeriod.filter((sheet) => activeDriver === ALL_DRIVERS || sheet.driverId === activeDriver),
    [inPeriod, activeDriver],
  );
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
          <PeriodCalendarPicker
            from={periodFrom}
            onChange={(from, to) => { setPeriodFrom(from); setPeriodTo(to); }}
            testID="finance-period-calendar"
            to={periodTo}
          />
        </View>

        {!busy && drivers.length > 1 ? <View style={styles.driverFilter} testID="finance-driver-filter">
          <Text style={styles.driverFilterLabel}>DARBUOTOJAS</Text>
          <View style={styles.driverChips}>
            <DriverChip active={activeDriver === ALL_DRIVERS} label="Visi" onPress={() => { setDriverFilter(ALL_DRIVERS); setExpandedDayKey(null); }} styles={styles} testID="finance-driver-all" />
            {drivers.map((driver) => (
              <DriverChip
                key={driver.driverId}
                active={activeDriver === driver.driverId}
                label={driver.driverName}
                onPress={() => { setDriverFilter(driver.driverId); setExpandedDayKey(null); }}
                styles={styles}
                testID={`finance-driver-${driver.driverId}`}
              />
            ))}
          </View>
        </View> : null}

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
          {wageDays.map((day) => {
            const expanded = expandedDayKey === day.key;
            return <View key={day.key} testID={`finance-wage-day-${day.key}`}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpandedDayKey(expanded ? null : day.key)}
                style={({ pressed }) => [styles.wageDayRow, pressed && styles.wageDayRowPressed]}
                testID={`finance-wage-day-toggle-${day.key}`}>
                <View style={styles.wageDayIdentity}>
                  <Text style={styles.wageDayDate}>{formatDateKey(day.date)}</Text>
                  {showDriverNames ? <Text style={styles.wageDayDriver}>{day.driverName}</Text> : null}
                  {day.preliminary ? <Text style={styles.wageDayStatus}>Preliminaru</Text> : null}
                </View>
                <Text style={styles.wageDayAmount}>{eurFormatter.format(day.wageEur)}</Text>
                <Text style={styles.wageDayChevron}>{expanded ? '⌃' : '⌄'}</Text>
              </Pressable>
              {expanded ? <WageDayDetail day={day} styles={styles} /> : null}
            </View>;
          })}
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

function DriverChip({ active, label, onPress, styles, testID }: { active: boolean; label: string; onPress: () => void; styles: ReturnType<typeof createStyles>; testID: string }) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={({ pressed }) => [styles.driverChip, active && styles.driverChipActive, pressed && styles.driverChipPressed]}
    testID={testID}>
    <Text style={[styles.driverChipText, active && styles.driverChipTextActive]}>{label}</Text>
  </Pressable>;
}

function DetailLine({ label, value, emphasis, styles }: { label: string; value: string; emphasis?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.detailLine}>
    <Text style={styles.detailLineLabel}>{label}</Text>
    <Text style={[styles.detailLineValue, emphasis && styles.detailLineValueEmphasis]}>{value}</Text>
  </View>;
}

function WageDayDetail({ day, styles }: { day: WageDayRow; styles: ReturnType<typeof createStyles> }) {
  const breakdown = day.sheets.find((sheet) => sheet.compensation)?.compensation ?? null;
  const fuelEntries = [...new Map(day.sheets.flatMap((sheet) => sheet.fuelEntries).map((entry) => [entry.id, entry])).values()];
  return <View style={styles.wageDayDetail} testID={`finance-wage-day-detail-${day.key}`}>
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>{day.sheets.length > 1 ? `Maršrutai (${day.sheets.length})` : 'Maršrutas'}</Text>
      {day.sheets.map((sheet) => (
        <View key={sheet.id} style={styles.detailRoute}>
          <Text style={styles.detailRouteTitle}>{sheet.routeNumbers.length > 0 ? sheet.routeNumbers.join(' · ') : 'Maršrutas'}</Text>
          <Text style={styles.detailRouteMeta}>
            {kmFormatter.format(sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0)} km · {sheet.deliveredStops}/{sheet.totalStops} tašk.{sheet.vehicle ? ` · ${sheet.vehicle.registrationNumber}` : ''}
          </Text>
        </View>
      ))}
    </View>

    {breakdown ? <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>Atlygio sudėtis{breakdown.preliminary ? ' · preliminaru' : ''}</Text>
      <DetailLine label="Bazinis (diena)" value={eur2Formatter.format(breakdown.fixedAmountEur)} styles={styles} />
      <DetailLine label={`Atstumas · ${kmFormatter.format(breakdown.distanceKm)} km (${breakdown.distanceSource === 'odometer' ? 'odometras' : 'planuota'})`} value={eur2Formatter.format(breakdown.distanceAmountEur)} styles={styles} />
      <DetailLine label={`Svoris · ${kmFormatter.format(breakdown.weightKg)} kg`} value={eur2Formatter.format(breakdown.weightAmountEur)} styles={styles} />
      <DetailLine label={`Taškai · ${breakdown.stops}`} value={eur2Formatter.format(breakdown.stopsAmountEur)} styles={styles} />
      <DetailLine label="Iš viso neto" value={eur2Formatter.format(breakdown.totalNetEur)} emphasis styles={styles} />
    </View> : <Text style={styles.meta}>Atlygio detalizacija dar neapskaičiuota.</Text>}

    {fuelEntries.length > 0 ? <View style={styles.detailSection}>
      <Text style={styles.detailSectionTitle}>Kuras</Text>
      {fuelEntries.map((entry) => (
        <DetailLine
          key={entry.id}
          label={`${kmFormatter.format(entry.liters)} l${entry.receiptNumber ? ` · čekis ${entry.receiptNumber}` : ''}`}
          value={entry.totalCost != null ? eur2Formatter.format(entry.totalCost) : '—'}
          styles={styles}
        />
      ))}
    </View> : null}
  </View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  periodPanel: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  driverFilter: { gap: spacing.sm },
  driverFilterLabel: { ...type.label, color: colors.textMuted, paddingHorizontal: spacing.xs },
  driverChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  driverChip: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  driverChipActive: { backgroundColor: colors.info, borderColor: colors.info },
  driverChipPressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  driverChipText: { ...type.secondaryStrong, color: colors.textSecondary },
  driverChipTextActive: { color: colors.textInverse },
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
  wageDayRowPressed: { backgroundColor: colors.surfaceSubtle },
  wageDayIdentity: { flex: 1, minWidth: 0, gap: 2 },
  wageDayDate: { ...type.bodyStrong, color: colors.text },
  wageDayDriver: { ...type.secondary, color: colors.textSecondary },
  wageDayStatus: { ...type.meta, color: colors.warning },
  wageDayAmount: { ...type.sectionTitle, color: colors.text, textAlign: 'right' },
  wageDayChevron: { ...type.body, color: colors.textMuted },
  wageDayDetail: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md, backgroundColor: colors.surfaceSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  detailSection: { gap: spacing.xs },
  detailSectionTitle: { ...type.label, color: colors.textMuted },
  detailRoute: { gap: 1 },
  detailRouteTitle: { ...type.secondaryStrong, color: colors.text },
  detailRouteMeta: { ...type.meta, color: colors.textMuted },
  detailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 26 },
  detailLineLabel: { ...type.secondary, color: colors.textSecondary, flex: 1, minWidth: 0 },
  detailLineValue: { ...type.secondaryStrong, color: colors.text, textAlign: 'right' },
  detailLineValueEmphasis: { color: colors.info },
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
