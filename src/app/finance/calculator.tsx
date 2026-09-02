import { Stack, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeEmployeePermissions } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import {
  averageVehicleDayCosts,
  DEFAULT_ROUTE_PRICE_SETTINGS,
  estimateCalculatorRoutePrice,
  estimateVariableDriverEarnings,
  normalizeRoutePriceSettings,
  type CalculatorWageMode,
  type RoutePriceSettings,
} from '@/application/routes/route-price';
import { FoundationScreen } from '@/components/foundation-screen';
import { employeeApi, type ServerFleetVehicle } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const eurFormatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function FinanceCalculatorScreen() {
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const permissions = normalizeEmployeePermissions(profile.permissions);
  const allowed = profile.role === 'admin' || (profile.role === 'dispatcher' && permissions.canManageFinancials);

  const [settings, setSettings] = useState<RoutePriceSettings>(() => normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS));
  const [vehicles, setVehicles] = useState<ServerFleetVehicle[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<'trip' | 'wage'>('trip');

  // Trip calculator inputs
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [fuelNorm, setFuelNorm] = useState('');
  const [distance, setDistance] = useState('');
  const [weight, setWeight] = useState('');
  const [stops, setStops] = useState('');
  const [wageMode, setWageMode] = useState<CalculatorWageMode>('variable');
  const [manualNet, setManualNet] = useState('');
  const [fixedDaily, setFixedDaily] = useState('');

  // Wage calculator inputs
  const [wageKm, setWageKm] = useState('');
  const [wageWeight, setWageWeight] = useState('');
  const [wageStops, setWageStops] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (!online) {
        setSettings(normalizeRoutePriceSettings(DEFAULT_ROUTE_PRICE_SETTINGS));
        setError('Nėra ryšio — naudojami numatytieji tarifai.');
        return;
      }
      const [settingsResponse, vehicleResponse] = await Promise.allSettled([
        employeeApi<{ settings: RoutePriceSettings }>('/api/admin/route-price-settings'),
        employeeApi<{ vehicles: ServerFleetVehicle[] }>('/api/admin/vehicles'),
      ]);
      if (settingsResponse.status === 'fulfilled') {
        setSettings(normalizeRoutePriceSettings(settingsResponse.value.settings));
      }
      if (vehicleResponse.status === 'fulfilled') {
        setVehicles(vehicleResponse.value.vehicles);
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tarifų gauti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [online]);

  useEffect(() => {
    if (!allowed) { router.replace(roleHomePath(profile.role) as Href); return; }
    void load();
  }, [allowed, load, profile.role, router]);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  const averages = useMemo(() => averageVehicleDayCosts(todayIso(), settings), [settings]);

  const tripPrice = useMemo(() => {
    const distanceKm = Number(distance);
    const weightKg = Number(weight || 0);
    const stopCount = Number(stops || 0);
    if (!Number.isFinite(distanceKm)) return null;
    return estimateCalculatorRoutePrice({
      date: todayIso(),
      distanceKm,
      weightKg: Number.isFinite(weightKg) ? weightKg : 0,
      stops: Number.isFinite(stopCount) ? stopCount : 0,
      vehicle: selectedVehicle
        ? { registrationNumber: selectedVehicle.registrationNumber, maximumPayloadKg: selectedVehicle.maximumPayloadKg }
        : null,
      fuelNormLitersPer100Km: fuelNorm.trim() ? Number(fuelNorm) : null,
      wageMode,
      manualDriverNetEur: manualNet.trim() ? Number(manualNet) : null,
      fixedDailyNetEur: fixedDaily.trim() ? Number(fixedDaily) : null,
    }, settings);
  }, [distance, weight, stops, selectedVehicle, fuelNorm, wageMode, manualNet, fixedDaily, settings]);

  const wageEstimate = useMemo(() => {
    const distanceKm = Number(wageKm);
    const weightKg = Number(wageWeight || 0);
    const stopCount = Number(wageStops || 0);
    if (!Number.isFinite(distanceKm)) return null;
    return estimateVariableDriverEarnings({
      distanceKm,
      weightKg: Number.isFinite(weightKg) ? weightKg : 0,
      stops: Number.isFinite(stopCount) ? stopCount : 0,
    }, settings);
  }, [wageKm, wageWeight, wageStops, settings]);

  if (!allowed) return null;

  return <>
    <Stack.Screen options={{ title: 'Skaičiuoklė' }} />
    <FoundationScreen
      contentMaxWidth={900}
      description="Preliminari reiso kaina ir kintamo atlygio įvertis pagal esamus tarifus — be kelionės lapo."
      showFoundationNotice={false}
      title="Skaičiuoklė">

      <View style={styles.segmented} testID="finance-calculator-segments">
        <Pressable
          onPress={() => setSection('trip')}
          style={[styles.segment, section === 'trip' && styles.segmentActive]}
          testID="calculator-section-trip">
          <Text style={[styles.segmentText, section === 'trip' && styles.segmentTextActive]}>Preliminari reiso kaina</Text>
        </Pressable>
        <Pressable
          onPress={() => setSection('wage')}
          style={[styles.segment, section === 'wage' && styles.segmentActive]}
          testID="calculator-section-wage">
          <Text style={[styles.segmentText, section === 'wage' && styles.segmentTextActive]}>Preliminarus atlygis</Text>
        </Pressable>
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
      {busy ? <ActivityIndicator color={colors.info} size="large" /> : null}

      {!busy && section === 'trip' ? <View style={styles.panel} testID="calculator-trip-panel">
        <Text style={styles.panelTitle}>Preliminari reiso kaina</Text>
        <Text style={styles.hint}>Pasirinkite automobilį arba įveskite kuro normą. Be automobilio kelių mokestis ir draudimas imami kaip vidurkis iš tarifų ({averages.vehicleCount} auto).</Text>

        <Text style={styles.label}>Automobilis</Text>
        <View style={styles.chipRow}>
          <Chip active={vehicleId === null} label="Be automobilio" onPress={() => setVehicleId(null)} styles={styles} testID="calculator-vehicle-none" />
          {vehicles.map((vehicle) => (
            <Chip
              active={vehicleId === vehicle.id}
              key={vehicle.id}
              label={vehicle.registrationNumber}
              onPress={() => setVehicleId(vehicle.id)}
              styles={styles}
              testID={`calculator-vehicle-${vehicle.id}`}
            />
          ))}
        </View>

        {vehicleId === null ? <Field label="Kuro norma, l/100 km" onChangeText={setFuelNorm} placeholder={String(averages.fuelNormLitersPer100Km)} styles={styles} testID="calculator-fuel-norm" value={fuelNorm} /> : null}
        <Field label="Atstumas, km" onChangeText={setDistance} placeholder="pvz. 420" styles={styles} testID="calculator-distance" value={distance} />
        <Field label="Svoris, kg" onChangeText={setWeight} placeholder="pvz. 1400" styles={styles} testID="calculator-weight" value={weight} />
        <Field label="Taškai (tsk)" onChangeText={setStops} placeholder="pvz. 14" styles={styles} testID="calculator-stops" value={stops} />

        <Text style={styles.label}>Vairuotojo atlygio režimas</Text>
        <View style={styles.chipRow}>
          <Chip active={wageMode === 'fixed'} label="Fiksuotas" onPress={() => setWageMode('fixed')} styles={styles} testID="calculator-wage-fixed" />
          <Chip active={wageMode === 'variable'} label="Kintamas" onPress={() => setWageMode('variable')} styles={styles} testID="calculator-wage-variable" />
          <Chip active={wageMode === 'manual'} label="Įvesti neto" onPress={() => setWageMode('manual')} styles={styles} testID="calculator-wage-manual" />
        </View>
        {wageMode === 'fixed' ? <Field label="Dienos neto, €" onChangeText={setFixedDaily} placeholder="pvz. 63" styles={styles} testID="calculator-fixed-daily" value={fixedDaily} /> : null}
        {wageMode === 'manual' ? <Field label="Mokėtina neto suma, €" onChangeText={setManualNet} placeholder="pvz. 95" styles={styles} testID="calculator-manual-net" value={manualNet} /> : null}

        {tripPrice ? <View style={styles.result} testID="calculator-trip-result">
          <Text style={styles.resultEyebrow}>PRELIMINARI REISO KAINA</Text>
          <Text style={styles.resultTotal}>{eurFormatter.format(tripPrice.totalEur)}</Text>
          <BreakdownLine label="Kuras" styles={styles} value={eurFormatter.format(tripPrice.fuelCostEur)} />
          <BreakdownLine label="Keliai + draudimas" styles={styles} value={eurFormatter.format(tripPrice.roadCostEur + tripPrice.insuranceCostEur)} />
          <BreakdownLine label="Vairuotojas (su mokesčiais)" styles={styles} value={eurFormatter.format(tripPrice.driverCostEur)} />
          <BreakdownLine label="Rezervas" styles={styles} value={eurFormatter.format(tripPrice.overheadEur)} />
          <Text style={styles.assumptions}>{tripPrice.assumptions.join(' · ')}</Text>
        </View> : <Text style={styles.hint}>Įveskite atstumą (ir atlygio laukus, jei reikia), kad pamatytumėte įvertį.</Text>}
      </View> : null}

      {!busy && section === 'wage' ? <View style={styles.panel} testID="calculator-wage-panel">
        <Text style={styles.panelTitle}>Preliminarus atlygis</Text>
        <Text style={styles.hint}>Tik kintamam atlygiui pagal numatytuosius tarifus (bazė + km + kg + taškai). Fiksuotos sutartys čia neskaičiuojamos.</Text>
        <Field label="Km" onChangeText={setWageKm} placeholder="pvz. 420" styles={styles} testID="calculator-wage-km" value={wageKm} />
        <Field label="Taškai" onChangeText={setWageStops} placeholder="pvz. 14" styles={styles} testID="calculator-wage-stops" value={wageStops} />
        <Field label="Kg" onChangeText={setWageWeight} placeholder="pvz. 1400" styles={styles} testID="calculator-wage-kg" value={wageWeight} />

        {wageEstimate ? <View style={styles.result} testID="calculator-wage-result">
          <Text style={styles.resultEyebrow}>PRELIMINARUS NETO ATLYGIS</Text>
          <Text style={styles.resultTotal}>{eurFormatter.format(wageEstimate.totalNetEur)}</Text>
          <BreakdownLine label="Bazė" styles={styles} value={eurFormatter.format(wageEstimate.baseNetEur)} />
          <BreakdownLine label="Už km" styles={styles} value={eurFormatter.format(wageEstimate.distanceAmountEur)} />
          <BreakdownLine label="Už kg" styles={styles} value={eurFormatter.format(wageEstimate.weightAmountEur)} />
          <BreakdownLine label="Už taškus" styles={styles} value={eurFormatter.format(wageEstimate.stopsAmountEur)} />
          <Text style={styles.assumptions}>
            Tarifai: bazė {wageEstimate.rates.baseNetEur} € · {wageEstimate.rates.perKmEur} €/km · {wageEstimate.rates.perKgEur} €/kg · {wageEstimate.rates.perStopEur} €/tsk
          </Text>
        </View> : <Text style={styles.hint}>Įveskite km, kad pamatytumėte kintamo atlygio įvertį.</Text>}
      </View> : null}
    </FoundationScreen>
  </>;
}

function Field({
  label, value, onChangeText, placeholder, styles, testID,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  styles: ReturnType<typeof createStyles>;
  testID: string;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      keyboardType="decimal-pad"
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={styles.placeholder.color as string}
      style={styles.input}
      testID={testID}
      value={value}
    />
  </View>;
}

function Chip({
  active, label, onPress, styles, testID,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  testID: string;
}) {
  return <Pressable
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}
    testID={testID}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </Pressable>;
}

function BreakdownLine({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.breakdownLine}>
    <Text style={styles.breakdownLabel}>{label}</Text>
    <Text style={styles.breakdownValue}>{value}</Text>
  </View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  segmented: { flexDirection: 'row', gap: spacing.xs, padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.borderStrong },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { ...type.label, color: colors.textSecondary, textAlign: 'center' },
  segmentTextActive: { color: colors.textInverse },
  warning: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  panel: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.sm },
  panelTitle: { ...type.sectionTitle, color: colors.text },
  hint: { ...type.secondary, color: colors.textMuted },
  label: { ...type.label, color: colors.textSecondary, marginTop: 4 },
  field: { gap: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: spacing.sm, ...type.body, color: colors.text, backgroundColor: colors.surfaceSubtle },
  placeholder: { color: colors.textSubtle },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...type.label, color: colors.textSecondary },
  chipTextActive: { color: colors.primary },
  result: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft, gap: 6 },
  resultEyebrow: { ...type.label, color: colors.info },
  resultTotal: { ...type.readout, color: colors.text, marginBottom: 4 },
  breakdownLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  breakdownLabel: { ...type.secondary, color: colors.textMuted },
  breakdownValue: { ...type.secondary, color: colors.text },
  assumptions: { ...type.meta, color: colors.textMuted, marginTop: 4 },
});
