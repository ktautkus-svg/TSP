import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
import { estimatePreliminaryRoutePrice, type PreliminaryRoutePrice } from '@/application/routes/route-price';
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type PricedTrip = { sheet: ServerTripSheet; price: PreliminaryRoutePrice };

const eurFormatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const kmFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 });

export default function RoutePriceScreen() {
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
    if (!online) { setError('Nėra ryšio su serveriu. Reiso kaina skaičiuojama serveryje.'); setBusy(false); return; }
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

  const priced: PricedTrip[] = useMemo(() => visible.flatMap((sheet) => {
    if (!sheet.vehicle) return [];
    const price = estimatePreliminaryRoutePrice({
      date: sheet.date,
      distanceKm: sheet.actualDistanceKm ?? sheet.plannedDistanceKm,
      weightKg: sheet.totalWeightKg,
      stops: sheet.totalStops,
      driverName: sheet.driverName,
      vehicle: { registrationNumber: sheet.vehicle.registrationNumber, maximumPayloadKg: sheet.vehicle.maximumPayloadKg },
    });
    return price ? [{ sheet, price }] : [];
  }).sort((left, right) => right.sheet.date.localeCompare(left.sheet.date)), [visible]);
  const skippedCount = visible.length - priced.length;

  const totals = useMemo(() => priced.reduce((sum, trip) => ({
    fuelCostEur: sum.fuelCostEur + trip.price.fuelCostEur,
    roadCostEur: sum.roadCostEur + trip.price.roadCostEur,
    insuranceCostEur: sum.insuranceCostEur + trip.price.insuranceCostEur,
    driverCostEur: sum.driverCostEur + trip.price.driverCostEur,
    overheadEur: sum.overheadEur + trip.price.overheadEur,
    totalEur: sum.totalEur + trip.price.totalEur,
  }), { fuelCostEur: 0, roadCostEur: 0, insuranceCostEur: 0, driverCostEur: 0, overheadEur: 0, totalEur: 0 }), [priced]);

  if (!allowed) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Reiso kaina' }} />
      <FoundationScreen
        contentMaxWidth={1100}
        description="Kiekvieno reiso savikainos įvertis pagal kelionės lapų faktinius duomenis ir esamus tarifus."
        showFoundationNotice={false}
        title="Reiso kaina">

        <View style={styles.periodPanel} testID="route-price-period-panel">
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
              testID={`route-price-period-${item.key}`}>
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

        {!busy && priced.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Pasirinktu laikotarpiu reisų su pilnais duomenimis nėra</Text><Text style={styles.meta}>Pakeiskite laikotarpį arba patikrinkite, ar reisui priskirtas automobilis.</Text></View> : null}

        {!busy && priced.length > 0 ? <View style={styles.totalsRow} testID="route-price-totals">
          <Metric label="Reisų" value={String(priced.length)} styles={styles} />
          <Metric label="Kuras" value={eurFormatter.format(totals.fuelCostEur)} styles={styles} />
          <Metric label="Kelių + draudimas" value={eurFormatter.format(totals.roadCostEur + totals.insuranceCostEur)} styles={styles} />
          <Metric label="Vairuotojas" value={eurFormatter.format(totals.driverCostEur)} styles={styles} />
          <Metric label="Iš viso" value={eurFormatter.format(totals.totalEur)} emphasis styles={styles} />
        </View> : null}

        {!busy && priced.length > 0 ? <View style={styles.table} testID="route-price-table">
          <View style={styles.detailHeaderRow}>
            <Text style={[styles.detailCell, styles.detailHeaderText, styles.detailDateColumn]}>Data</Text>
            <Text style={[styles.detailCell, styles.detailHeaderText, styles.detailVehicleColumn]}>Automobilis · vairuotojas</Text>
            <Text style={[styles.detailCell, styles.detailHeaderText]}>Km</Text>
            <Text style={[styles.detailCell, styles.detailHeaderText]}>Kuras</Text>
            <Text style={[styles.detailCell, styles.detailHeaderText]}>Kelių+draud.</Text>
            <Text style={[styles.detailCell, styles.detailHeaderText]}>Vairuotojas</Text>
            <Text style={[styles.detailCell, styles.detailHeaderText]}>Iš viso</Text>
          </View>
          {priced.map(({ sheet, price }) => <View key={sheet.id} style={styles.detailRow}>
            <Text style={[styles.detailCell, styles.detailDateColumn]}>{sheet.date}</Text>
            <Text style={[styles.detailCell, styles.detailVehicleColumn]}>{sheet.vehicle?.registrationNumber ?? '—'} · {sheet.driverName}</Text>
            <Text style={styles.detailCell}>{kmFormatter.format(sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0)}</Text>
            <Text style={styles.detailCell}>{eurFormatter.format(price.fuelCostEur)}</Text>
            <Text style={styles.detailCell}>{eurFormatter.format(price.roadCostEur + price.insuranceCostEur)}</Text>
            <Text style={styles.detailCell}>{eurFormatter.format(price.driverCostEur)}</Text>
            <Text style={[styles.detailCell, styles.detailTotalCell]}>{eurFormatter.format(price.totalEur)}</Text>
          </View>)}
        </View> : null}

        {!busy && skippedCount > 0 ? <Text style={styles.meta}>{skippedCount} {skippedCount === 1 ? 'reisas' : 'reisai'} praleisti — trūksta automobilio arba nuvažiuoto atstumo.</Text> : null}

        <Text style={styles.disclaimer}>Reiso kaina — įvertis pagal tuos pačius tarifus, kuriuos dispečeris mato planuodamas maršrutą (kuro norma, kelių mokestis, draudimas, vairuotojo sutartis, rezervas). Tai NĖRA galutinė buhalterinė suma — tikslinkite tarifus, jei jie pasikeitė.</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/financial-settings', params: { returnTo: 'finance-route-price' } } as unknown as Href)}
          style={({ pressed }) => [styles.settingsLink, pressed && styles.settingsLinkPressed]}
          testID="route-price-open-settings">
          <MenuArtwork kind="finance" size={44} />
          <View style={styles.flex}>
            <Text style={styles.settingsLinkTitle}>Kuro ir atlygio parametrai</Text>
            <Text style={styles.meta}>Kuro kaina, automobilių ir vairuotojų tarifai, naudojami reiso kainos įverčiui.</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </FoundationScreen>
    </>
  );
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
  table: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: 'hidden', padding: spacing.md, gap: 0 },
  detailHeaderRow: { flexDirection: 'row', paddingBottom: spacing.sm },
  detailRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingVertical: spacing.xs },
  detailCell: { flex: 1, ...type.secondary, color: colors.text, textAlign: 'right' },
  detailHeaderText: { ...type.label, color: colors.textMuted, textAlign: 'right' },
  detailDateColumn: { flex: 1.2, textAlign: 'left' },
  detailVehicleColumn: { flex: 2, textAlign: 'left' },
  detailTotalCell: { ...type.bodyStrong, color: colors.text },
  disclaimer: { ...type.meta, color: colors.textMuted },
  settingsLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  settingsLinkPressed: { opacity: 0.85 },
  settingsLinkTitle: { ...type.bodyStrong, color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
