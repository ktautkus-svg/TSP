import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  normalizeRoutePriceSettings,
  type DriverCostProfile,
  type RoutePriceSettings,
  type VehicleCostProfile,
} from '@/application/routes/route-price';
import { employeeApi } from '@/infrastructure/auth/employee-session';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const MONTHS = ['Sausis', 'Vasaris', 'Kovas', 'Balandis', 'Gegužė', 'Birželis', 'Liepa', 'Rugpjūtis', 'Rugsėjis', 'Spalis', 'Lapkritis', 'Gruodis'];

export function RoutePriceSettingsPanel({
  settings,
  canEdit,
  onSaved,
  onClose,
}: {
  settings: RoutePriceSettings;
  canEdit: boolean;
  onSaved: (settings: RoutePriceSettings) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(() => cloneSettings(settings));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setDraft(cloneSettings(settings)), [settings]);

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const normalized = normalizeRoutePriceSettings(draft);
      const response = await employeeApi<{ settings: RoutePriceSettings }>('/api/admin/route-price-settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: normalized }),
      });
      const saved = normalizeRoutePriceSettings(response.settings);
      setDraft(cloneSettings(saved));
      onSaved(saved);
      setMessage('Kainos parametrai išsaugoti. Naujos preliminarios kainos perskaičiuotos.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kainos parametrų išsaugoti nepavyko.');
    } finally {
      setSaving(false);
    }
  };

  const updateMonth = (key: 'fuelPriceByMonth' | 'workingDaysByMonth', index: number, value: number) => {
    setDraft((current) => {
      const values = [...current[key]];
      values[index] = value;
      return { ...current, [key]: values };
    });
  };

  const updateVehicle = (registration: string, key: keyof VehicleCostProfile, value: number) => {
    setDraft((current) => ({
      ...current,
      vehicleCosts: {
        ...current.vehicleCosts,
        [registration]: { ...current.vehicleCosts[registration], [key]: value },
      },
    }));
  };

  const updateDriver = (name: string, key: string, value: number) => {
    setDraft((current) => ({
      ...current,
      driverCosts: {
        ...current.driverCosts,
        [name]: { ...current.driverCosts[name], [key]: value } as DriverCostProfile,
      },
    }));
  };

  const updateFallbackVehicle = (size: keyof RoutePriceSettings['fallbackVehicleCosts'], key: keyof VehicleCostProfile, value: number) => {
    setDraft((current) => ({
      ...current,
      fallbackVehicleCosts: {
        ...current.fallbackVehicleCosts,
        [size]: { ...current.fallbackVehicleCosts[size], [key]: value },
      },
    }));
  };

  return <View style={styles.panel} testID="route-price-settings">
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text style={styles.title}>Kainos parametrai</Text>
        <Text style={styles.description}>Čia saugomi visi preliminarios maršruto kainos dydžiai. Jie nekeičia maršruto eiliškumo ar optimizavimo.</Text>
      </View>
      <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>Uždaryti</Text></Pressable>
    </View>

    {!canEdit ? <Text style={styles.notice}>Dispečeris parametrus gali peržiūrėti. Keisti gali tik administratorius.</Text> : null}
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}

    <PriceSection title="Bendri skaičiavimo dydžiai" styles={styles}>
      <View style={styles.fieldGrid}>
        <NumberField disabled={!canEdit} label="Rezervas / antkainis, %" value={draft.overheadPercent} onChange={(value) => setDraft((current) => ({ ...current, overheadPercent: value }))} styles={styles} />
        <NumberField disabled={!canEdit} label="Darbdavio mokesčiai, %" value={draft.payrollTaxPercent} onChange={(value) => setDraft((current) => ({ ...current, payrollTaxPercent: value }))} styles={styles} />
        <NumberField disabled={!canEdit} label="Mažo auto riba, kg" value={draft.fallbackPayloadThresholdsKg.smallMax} onChange={(value) => setDraft((current) => ({ ...current, fallbackPayloadThresholdsKg: { ...current.fallbackPayloadThresholdsKg, smallMax: value } }))} styles={styles} />
        <NumberField disabled={!canEdit} label="Vidutinio auto riba, kg" value={draft.fallbackPayloadThresholdsKg.mediumMax} onChange={(value) => setDraft((current) => ({ ...current, fallbackPayloadThresholdsKg: { ...current.fallbackPayloadThresholdsKg, mediumMax: value } }))} styles={styles} />
      </View>
    </PriceSection>

    <PriceSection title="Kuras ir darbo dienos pagal mėnesį" styles={styles}>
      <View style={styles.monthGrid}>
        {MONTHS.map((month, index) => <View key={month} style={styles.monthRow}>
          <Text style={styles.rowTitle}>{month}</Text>
          <NumberField compact disabled={!canEdit} label="Kuras, €/l" value={draft.fuelPriceByMonth[index]} onChange={(value) => updateMonth('fuelPriceByMonth', index, value)} styles={styles} />
          <NumberField compact disabled={!canEdit} label="Darbo dienos" value={draft.workingDaysByMonth[index]} onChange={(value) => updateMonth('workingDaysByMonth', index, value)} styles={styles} />
        </View>)}
      </View>
    </PriceSection>

    <PriceSection title="Numatytasis vairuotojo tarifas" styles={styles}>
      <VariableDriverFields disabled={!canEdit} profile={draft.defaultDriverCost} onChange={(key, value) => setDraft((current) => ({ ...current, defaultDriverCost: { ...current.defaultDriverCost, [key]: value } }))} styles={styles} />
    </PriceSection>

    <PriceSection title="Vairuotojų individualūs tarifai" styles={styles}>
      {Object.entries(draft.driverCosts).sort(([left], [right]) => left.localeCompare(right, 'lt')).map(([name, profile]) => <View key={name} style={styles.dataRow}>
        <View style={styles.rowHeading}><Text style={styles.rowTitle}>{name}</Text><Text style={styles.rowMeta}>{profile.type === 'fixed' ? 'Fiksuotas dienos tarifas' : 'Kintamas tarifas'}</Text></View>
        {profile.type === 'fixed'
          ? <NumberField disabled={!canEdit} label="Dienos neto, €" value={profile.dailyNetEur} onChange={(value) => updateDriver(name, 'dailyNetEur', value)} styles={styles} />
          : <VariableDriverFields disabled={!canEdit} profile={profile} onChange={(key, value) => updateDriver(name, key, value)} styles={styles} />}
      </View>)}
    </PriceSection>

    <PriceSection title="Automobilių sąnaudų parametrai" styles={styles}>
      <Text style={styles.sectionHint}>Degalų norma skaičiuojama l/100 km, draudimas – metams, kelių mokestis – mėnesiui.</Text>
      {Object.entries(draft.vehicleCosts).sort(([left], [right]) => left.localeCompare(right)).map(([registration, profile]) => <View key={registration} style={styles.dataRow}>
        <Text style={styles.rowTitle}>{registration}</Text>
        <VehicleFields disabled={!canEdit} profile={profile} onChange={(key, value) => updateVehicle(registration, key, value)} styles={styles} />
      </View>)}
    </PriceSection>

    <PriceSection title="Tarifai automobiliams be individualių duomenų" styles={styles}>
      {(['small', 'medium', 'large'] as const).map((size) => <View key={size} style={styles.dataRow}>
        <Text style={styles.rowTitle}>{size === 'small' ? 'Mažas automobilis' : size === 'medium' ? 'Vidutinis automobilis' : 'Didelis automobilis'}</Text>
        <VehicleFields disabled={!canEdit} profile={draft.fallbackVehicleCosts[size]} onChange={(key, value) => updateFallbackVehicle(size, key, value)} styles={styles} />
      </View>)}
    </PriceSection>

    <View style={styles.footer}>
      <Text style={styles.footerHint}>Pakeitimai pradės galioti tik paspaudus „Išsaugoti parametrus“.</Text>
      {canEdit ? <Pressable disabled={saving} onPress={() => void save()} style={[styles.saveButton, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? 'Saugoma…' : 'Išsaugoti parametrus'}</Text></Pressable> : null}
    </View>
  </View>;
}

function PriceSection({ title, children, styles }: { title: string; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function VariableDriverFields({ disabled, profile, onChange, styles }: { disabled: boolean; profile: Exclude<DriverCostProfile, { type: 'fixed' }>; onChange: (key: keyof Omit<typeof profile, 'type'>, value: number) => void; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.fieldGrid}>
    <NumberField compact disabled={disabled} label="Bazė, €" value={profile.baseNetEur} onChange={(value) => onChange('baseNetEur', value)} styles={styles} />
    <NumberField compact disabled={disabled} label="Už km, €" value={profile.perKmEur} onChange={(value) => onChange('perKmEur', value)} styles={styles} />
    <NumberField compact disabled={disabled} label="Už kg, €" value={profile.perKgEur} onChange={(value) => onChange('perKgEur', value)} styles={styles} />
    <NumberField compact disabled={disabled} label="Už tašką, €" value={profile.perStopEur} onChange={(value) => onChange('perStopEur', value)} styles={styles} />
  </View>;
}

function VehicleFields({ disabled, profile, onChange, styles }: { disabled: boolean; profile: VehicleCostProfile; onChange: (key: keyof VehicleCostProfile, value: number) => void; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.fieldGrid}>
    <NumberField compact disabled={disabled} label="l/100 km" value={profile.fuelNormLitersPer100Km} onChange={(value) => onChange('fuelNormLitersPer100Km', value)} styles={styles} />
    <NumberField compact disabled={disabled} label="Draudimas, €/m." value={profile.annualInsuranceEur} onChange={(value) => onChange('annualInsuranceEur', value)} styles={styles} />
    <NumberField compact disabled={disabled} label="Kelių mok., €/mėn." value={profile.monthlyRoadTaxEur} onChange={(value) => onChange('monthlyRoadTaxEur', value)} styles={styles} />
  </View>;
}

function NumberField({ disabled, label, value, onChange, compact, styles }: { disabled: boolean; label: string; value: number; onChange: (value: number) => void; compact?: boolean; styles: ReturnType<typeof createStyles> }) {
  const [textValue, setTextValue] = useState(formatInput(value));
  useEffect(() => setTextValue(formatInput(value)), [value]);
  const commit = () => {
    const parsed = Number(textValue.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
    else setTextValue(formatInput(value));
  };
  return <View style={[styles.field, compact && styles.fieldCompact]}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      editable={!disabled}
      keyboardType="decimal-pad"
      onBlur={commit}
      onChangeText={setTextValue}
      selectTextOnFocus
      style={[styles.input, disabled && styles.inputDisabled]}
      value={textValue}
    />
  </View>;
}

function cloneSettings(settings: RoutePriceSettings): RoutePriceSettings {
  return normalizeRoutePriceSettings(JSON.parse(JSON.stringify(settings)) as unknown);
}
function formatInput(value: number): string { return String(value).replace('.', ','); }

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  panel: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.surface, gap: spacing.lg },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 260, gap: spacing.xs },
  title: { ...type.pageTitle, fontSize: 26, lineHeight: 32, color: colors.text },
  description: { ...type.body, color: colors.textSecondary },
  closeButton: { minHeight: 44, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong },
  closeText: { ...type.button, color: colors.textSecondary },
  notice: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft, color: colors.warning },
  message: { ...type.bodyStrong, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft, color: colors.info },
  section: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  sectionTitle: { ...type.sectionTitle, color: colors.text },
  sectionHint: { ...type.secondary, color: colors.textMuted },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  field: { flexGrow: 1, flexBasis: 200, minWidth: 150, gap: 5 },
  fieldCompact: { flexBasis: 150 },
  label: { ...type.label, color: colors.textMuted },
  input: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, color: colors.text, ...type.body },
  inputDisabled: { backgroundColor: colors.surfaceMuted, color: colors.textSecondary },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  monthRow: { flexGrow: 1, flexBasis: 300, minWidth: 260, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, gap: spacing.sm },
  dataRow: { paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowMeta: { ...type.secondary, color: colors.textMuted },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  footerHint: { ...type.secondary, flex: 1, minWidth: 240, color: colors.textMuted },
  saveButton: { minHeight: 50, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.actionPrimary },
  saveText: { ...type.button, color: colors.textInverse },
  disabled: { opacity: 0.5 },
});
