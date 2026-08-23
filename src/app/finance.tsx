import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import {
  PERIOD_OPTIONS,
  anchorFieldLabel,
  formatDateRange,
  formatPeriodTitle,
  localDateKey,
  periodRange,
  type PeriodMode,
} from '@/application/reporting/period-range';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type DriverFinanceRow = {
  driverId: string;
  driverName: string;
  routes: number;
  km: number;
  fuelLiters: number;
  fuelCostEur: number;
  wageEur: number;
  totalEur: number;
};

const eurFormatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const kmFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });
const litersFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });

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
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    routes: sum.routes + row.routes,
    km: sum.km + row.km,
    fuelLiters: sum.fuelLiters + row.fuelLiters,
    fuelCostEur: sum.fuelCostEur + row.fuelCostEur,
    wageEur: sum.wageEur + row.wageEur,
    totalEur: sum.totalEur + row.totalEur,
  }), { routes: 0, km: 0, fuelLiters: 0, fuelCostEur: 0, wageEur: 0, totalEur: 0 }), [rows]);

  if (!allowed) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Finansai' }} />
      <FoundationScreen
        contentMaxWidth={1100}
        description="Reiso savikaina pagal kelionės lapų faktinius duomenis: kuro pylimai ir apskaičiuotas atlygis."
        showFoundationNotice={false}
        title="Finansai">

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

        {!busy && rows.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
          <View style={styles.table} testID="finance-driver-table">
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableCell, styles.tableHeaderText, styles.driverColumn]}>Vairuotojas</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Reisai</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Km</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Kuras (l)</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Kuras €</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Atlygis €</Text>
              <Text style={[styles.tableCell, styles.tableHeaderText]}>Iš viso €</Text>
            </View>
            {rows.map((row) => <View key={row.driverId} style={styles.tableRow} testID={`finance-driver-row-${row.driverId}`}>
              <Text style={[styles.tableCell, styles.driverColumn, styles.driverName]}>{row.driverName}</Text>
              <Text style={styles.tableCell}>{row.routes}</Text>
              <Text style={styles.tableCell}>{kmFormatter.format(row.km)}</Text>
              <Text style={styles.tableCell}>{litersFormatter.format(row.fuelLiters)}</Text>
              <Text style={styles.tableCell}>{eurFormatter.format(row.fuelCostEur)}</Text>
              <Text style={styles.tableCell}>{eurFormatter.format(row.wageEur)}</Text>
              <Text style={[styles.tableCell, styles.tableCellStrong]}>{eurFormatter.format(row.totalEur)}</Text>
            </View>)}
          </View>
        </ScrollView> : null}

        <Text style={styles.disclaimer}>Kuro suma skaičiuojama iš pylimų, kuriuose nurodyta kaina — jei kaina nenurodyta, litrai matomi, bet į € sumą neįskaičiuojami. Atlygis skaičiuojamas serveryje pagal vairuotojo sutartį.</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'finance' } } as unknown as Href)}
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
  const buckets = new Map<string, { driverId: string; driverName: string; routeIds: Set<string>; km: number; fuelLiters: number; fuelCostEur: number }>();
  const wageByDriverDate = new Map<string, number>();
  for (const sheet of sheets) {
    if (!buckets.has(sheet.driverId)) buckets.set(sheet.driverId, { driverId: sheet.driverId, driverName: sheet.driverName, routeIds: new Set(), km: 0, fuelLiters: 0, fuelCostEur: 0 });
    const bucket = buckets.get(sheet.driverId)!;
    bucket.routeIds.add(sheet.routeId);
    bucket.km += sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0;
    for (const entry of sheet.fuelEntries) {
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
    <Pressable onPress={() => undefined} style={styles.dateValue}><Text style={styles.dateValueText}>{value}</Text></Pressable>
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
  dateValue: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, justifyContent: 'center', paddingHorizontal: spacing.sm, backgroundColor: colors.surfaceSubtle },
  dateValueText: { ...type.body, color: colors.text },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  empty: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: 4 },
  emptyTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexGrow: 1, minWidth: 100, minHeight: 74, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  metricValue: { ...type.sectionTitle, color: colors.text },
  metricValueEmphasis: { color: colors.info },
  metricLabel: { ...type.label, color: colors.textMuted },
  tableScroll: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong },
  table: { minWidth: 720 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: colors.surfaceSubtle, borderBottomWidth: 1, borderBottomColor: colors.borderStrong },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  tableCell: { width: 96, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, ...type.secondary, color: colors.text, textAlign: 'right' },
  tableCellStrong: { ...type.secondaryStrong, color: colors.text },
  tableHeaderText: { ...type.label, color: colors.textMuted, textAlign: 'right' },
  driverColumn: { width: 168, textAlign: 'left' },
  driverName: { ...type.bodyStrong, color: colors.text },
  disclaimer: { ...type.meta, color: colors.textMuted },
  settingsLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  settingsLinkPressed: { opacity: 0.85 },
  settingsLinkTitle: { ...type.bodyStrong, color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
