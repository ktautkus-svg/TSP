import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { calendarPresetRange } from '@/application/reporting/period-range';
import {
  estimatePreliminaryRoutePrice,
  isFinalTripCost,
  type PreliminaryRoutePrice,
} from '@/application/routes/route-price';
import { FoundationScreen } from '@/components/foundation-screen';
import { MenuArtwork } from '@/components/menu-artwork';
import { PeriodCalendarPicker } from '@/components/period-calendar-picker';
import { employeeApi, type ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type PricedTrip = {
  sheet: ServerTripSheet;
  price: PreliminaryRoutePrice;
  final: boolean;
};

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const initialPeriod = useMemo(() => calendarPresetRange('thisMonth'), []);
  const [periodFrom, setPeriodFrom] = useState(initialPeriod.from);
  const [periodTo, setPeriodTo] = useState(initialPeriod.to);

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

  const period = useMemo(() => ({ from: periodFrom, to: periodTo }), [periodFrom, periodTo]);
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
    return price ? [{ sheet, price, final: isFinalTripCost(sheet) }] : [];
  }).sort((left, right) => right.sheet.date.localeCompare(left.sheet.date)), [visible]);
  const skippedCount = visible.length - priced.length;
  const finalCount = priced.filter((trip) => trip.final).length;
  const prelimCount = priced.length - finalCount;

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
        description="Kiekvieno reiso savikaina pagal kelionės lapus ir tarifus. Galutinė — tik su odometru; kitaip preliminarinė."
        showFoundationNotice={false}
        title="Reiso kaina">

        <View style={styles.periodPanel} testID="route-price-period-panel">
          <PeriodCalendarPicker
            from={periodFrom}
            onChange={(from, to) => { setPeriodFrom(from); setPeriodTo(to); }}
            testID="route-price-period-calendar"
            to={periodTo}
          />
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

        {!busy && priced.length > 0 ? <View style={styles.list} testID="route-price-table">
          <View style={styles.listHeader} testID="route-price-list-header">
            <Text style={[styles.headerCell, styles.colDate]}>Data</Text>
            <Text style={[styles.headerCell, styles.colName]}>Vardas Pavardė</Text>
            <Text style={[styles.headerCell, styles.colPlate]}>Mašinos nr</Text>
            <Text style={[styles.headerCell, styles.colPrice]}>Kaina</Text>
          </View>
          {priced.map(({ sheet, price, final }) => {
            const expanded = expandedId === sheet.id;
            return <View key={sheet.id} style={styles.rowCard} testID={`route-price-row-${sheet.id}`}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpandedId((current) => current === sheet.id ? null : sheet.id)}
                style={({ pressed }) => [styles.rowSummary, pressed && styles.rowPressed]}
                testID={`route-price-expand-${sheet.id}`}>
                <Text style={[styles.cell, styles.colDate]}>{sheet.date}</Text>
                <Text numberOfLines={2} style={[styles.cell, styles.colName]}>{sheet.driverName}</Text>
                <Text style={[styles.cell, styles.colPlate]}>{sheet.vehicle?.registrationNumber ?? '—'}</Text>
                <View style={styles.colPrice}>
                  <Text style={styles.priceValue}>{eurFormatter.format(price.totalEur)}</Text>
                  <Text style={[styles.priceBadge, final ? styles.priceBadgeFinal : styles.priceBadgePrelim]}>
                    {final ? 'galutinė' : 'preliminarinė'}
                  </Text>
                </View>
              </Pressable>
              {expanded ? <View style={styles.detail} testID={`route-price-detail-${sheet.id}`}>
                <DetailLine label="Km" value={kmFormatter.format(sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0)} styles={styles} />
                <DetailLine label="Kuras" value={eurFormatter.format(price.fuelCostEur)} styles={styles} />
                <DetailLine label="Keliai + draudimas" value={eurFormatter.format(price.roadCostEur + price.insuranceCostEur)} styles={styles} />
                <DetailLine label="Vairuotojas" value={eurFormatter.format(price.driverCostEur)} styles={styles} />
                <DetailLine label="Rezervas" value={eurFormatter.format(price.overheadEur)} styles={styles} />
                <DetailLine label="Iš viso" value={eurFormatter.format(price.totalEur)} strong styles={styles} />
                <Text style={styles.detailNote}>
                  {final
                    ? 'Galutinė: maršrutas užbaigtas ir įvestas odometras.'
                    : 'Preliminarinė: pagal planavimo tarifus (kuro norma, keliai, draudimas, vairuotojo sutartis, rezervas). Trūksta odometro arba faktinio atstumo.'}
                </Text>
              </View> : null}
            </View>;
          })}
        </View> : null}

        {!busy && priced.length > 0 ? <Text style={styles.meta} testID="route-price-finality-summary">
          {finalCount} galutinė{finalCount === 1 ? '' : finalCount % 10 === 0 ? '' : ''} · {prelimCount} preliminarinė{prelimCount === 1 ? '' : ''}
        </Text> : null}

        {!busy && skippedCount > 0 ? <Text style={styles.meta}>{skippedCount} {skippedCount === 1 ? 'reisas' : 'reisai'} praleisti — trūksta automobilio arba nuvažiuoto atstumo.</Text> : null}

        <Text style={styles.disclaimer}>
          Preliminarinė reiso kaina — įvertis pagal tuos pačius tarifus, kuriuos dispečeris mato planuodamas maršrutą (kuro norma, kelių mokestis, draudimas, vairuotojo sutartis, rezervas). Galutinė — kai maršrutas užbaigtas ir įvestas odometras. Tai NĖRA buhalterinė suma — tikslinkite tarifus, jei jie pasikeitė.
        </Text>

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

function DetailLine({ label, value, strong, styles }: { label: string; value: string; strong?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.detailLine}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={[styles.detailValue, strong && styles.detailValueStrong]}>{value}</Text>
  </View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  periodPanel: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.md },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  empty: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: 4 },
  emptyTitle: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexGrow: 1, minWidth: 100, minHeight: 74, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 2 },
  metricValue: { ...type.sectionTitle, color: colors.text },
  metricValueEmphasis: { color: colors.info },
  metricLabel: { ...type.label, color: colors.textMuted },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: 'hidden' },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, backgroundColor: colors.surfaceMuted },
  headerCell: { ...type.label, color: colors.textMuted },
  rowCard: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  rowSummary: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 52 },
  rowPressed: { opacity: 0.88, backgroundColor: colors.surfaceSubtle },
  cell: { ...type.secondary, color: colors.text },
  colDate: { width: 92, flexShrink: 0 },
  colName: { flex: 1.4, minWidth: 0 },
  colPlate: { width: 72, flexShrink: 0 },
  colPrice: { width: 88, flexShrink: 0, alignItems: 'flex-end', gap: 2 },
  priceValue: { ...type.bodyStrong, color: colors.text, textAlign: 'right' },
  priceBadge: { ...type.meta, textTransform: 'lowercase' },
  priceBadgePrelim: { color: colors.warning },
  priceBadgeFinal: { color: colors.success },
  detail: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: 6, backgroundColor: colors.surfaceSubtle },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  detailLabel: { ...type.secondary, color: colors.textMuted },
  detailValue: { ...type.secondary, color: colors.text },
  detailValueStrong: { ...type.bodyStrong, color: colors.text },
  detailNote: { ...type.meta, color: colors.textMuted, marginTop: 4 },
  disclaimer: { ...type.meta, color: colors.textMuted },
  settingsLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  settingsLinkPressed: { opacity: 0.85 },
  settingsLinkTitle: { ...type.bodyStrong, color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
