import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { actualFuelCostEur, predictFuelCostEur, type RouteFuelQuote } from '@/application/routes/route-fuel-cost';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

const EMPTY_QUOTE: RouteFuelQuote = {
  distanceKm: null,
  litersPer100Km: null,
  pricePerLiter: null,
  consumedLiters: null,
};

export function RouteFuelQuoteCard({
  quote,
  priceDraft,
  onPriceDraft,
  onSavePrice,
  saving = false,
  canEditPrice = false,
}: {
  quote?: RouteFuelQuote | null;
  priceDraft?: string;
  onPriceDraft?: (value: string) => void;
  onSavePrice?: () => void;
  saving?: boolean;
  canEditPrice?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const shown = quote ?? EMPTY_QUOTE;
  const predicted = predictFuelCostEur(shown);
  const actual = actualFuelCostEur(shown);

  return <View style={styles.card} testID="route-fuel-quote">
    <Text style={styles.title}>REISO KURAS</Text>
    <FuelLine label="Reiso km" value={quantity(shown.distanceKm, 'km')} styles={styles} />
    <FuelLine label="Sąnaudos" value={quantity(shown.litersPer100Km, 'l/100 km')} styles={styles} />
    <FuelLine label="Kuro kaina" value={quantity(shown.pricePerLiter, '€/l')} styles={styles} />
    <FuelLine label="Numatomos kuro išlaidos" value={money(predicted)} styles={styles} />
    <FuelLine label="Faktinės kuro išlaidos" value={money(actual)} styles={styles} />
    {canEditPrice ? <View style={styles.editor}>
      <Text style={styles.editorLabel}>Kuro kaina €/l šiam mėnesiui</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={onPriceDraft}
        placeholder="€/l"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID="route-fuel-price-input"
        value={priceDraft ?? ''}
      />
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={onSavePrice}
        style={[styles.save, saving && styles.disabled]}
        testID="route-fuel-price-save">
        <Text style={styles.saveText}>{saving ? 'Saugoma…' : 'Išsaugoti kainą'}</Text>
      </Pressable>
    </View> : null}
  </View>;
}

function FuelLine({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.line}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>;
}

function quantity(value: number | null, unit: string): string {
  if (value === null) return 'Trūksta duomenų';
  return `${formatNumber(value)} ${unit}`;
}

function money(value: number | null): string {
  if (value === null) return 'Trūksta duomenų';
  return `${formatNumber(value)} €`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value);
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  title: { ...type.label, color: colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  label: { ...type.secondary, color: colors.text, flexShrink: 1 },
  value: { ...type.bodyStrong, color: colors.text, textAlign: 'right' },
  editor: { gap: spacing.xs, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  editorLabel: { ...type.label, color: colors.text },
  input: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, color: colors.text, ...type.bodyStrong },
  save: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary },
  saveText: { ...type.button, color: colors.textInverse },
  disabled: { opacity: 0.55 },
});
