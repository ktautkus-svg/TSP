import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  VAN_BODY_KINDS,
  vanBodyLabel,
  type LoadingBayView,
  type LoadingSchema,
  type VanBodyKind,
} from '@/domain/loading-schema';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export function LoadingSchemaCard({
  schema,
  bodyKind,
  onBodyKindChange,
}: {
  schema: LoadingSchema;
  bodyKind: VanBodyKind;
  onBodyKindChange: (kind: VanBodyKind) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const front = schema.bays.filter((bay) => bay.orientation === 'vertical');
  const rows = schema.bays.filter((bay) => bay.orientation === 'horizontal');

  return (
    <View style={styles.card} testID="loading-schema-card">
      <Text style={styles.title}>Krovimo schema</Text>
      <Text style={styles.hint}>
        Abu van: priekyje dvi paletės vertikaliai, tada eilės horizontaliai iki durų. Tai tik išdėstymas —
        9 iš 10 kartų krauname be PLL, nebent svoris didelis.
      </Text>
      <View style={styles.bodyRow}>
        {VAN_BODY_KINDS.map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => onBodyKindChange(kind)}
            style={[styles.bodyChip, bodyKind === kind && styles.bodyChipActive]}
            testID={`van-body-${kind}`}>
            <Text style={[styles.bodyChipText, bodyKind === kind && styles.bodyChipTextActive]}>
              {vanBodyLabel(kind)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.cab}>Kabina</Text>
      <View style={styles.frontRow}>
        {front.map((bay) => <BayCell key={bay.id} bay={bay} styles={styles} />)}
      </View>
      {rows.map((bay) => <BayCell key={bay.id} bay={bay} styles={styles} wide />)}
      <Text style={styles.doors}>Durys</Text>
      <Text style={styles.summary}>{schema.summary}</Text>
    </View>
  );
}

function BayCell({
  bay,
  styles,
  wide = false,
}: {
  bay: LoadingBayView;
  styles: ReturnType<typeof createStyles>;
  wide?: boolean;
}) {
  return (
    <View
      style={[styles.bay, wide && styles.bayWide, bay.nearDoors && styles.bayDoor]}
      testID={`loading-bay-${bay.id}`}>
      <Text style={styles.bayLabel}>{bay.label}</Text>
      {bay.placements.length === 0 ? (
        <Text style={styles.empty}>Tuščia</Text>
      ) : bay.placements.map((item) => (
        <Text key={item.stopId} style={styles.item}>
          {item.loadingSequence}. {formatWeightKg(item.weightKg)} kg · {item.stackLabel}
          {item.usePallet ? ' · PLL' : ''}
          {'\n'}
          {shortAddress(item.address)}
        </Text>
      ))}
    </View>
  );
}

function shortAddress(value: string): string {
  const text = value.trim();
  if (text.length <= 42) return text;
  return `${text.slice(0, 40)}…`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
    gap: spacing.sm,
  },
  title: { ...type.cardTitle, color: colors.text },
  hint: { ...type.secondary, color: colors.textSecondary },
  bodyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  bodyChip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  bodyChipActive: { backgroundColor: colors.actionRoute, borderColor: colors.actionRoute },
  bodyChipText: { ...type.secondaryStrong, color: colors.text },
  bodyChipTextActive: { color: colors.textInverse },
  cab: { ...type.label, color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase' },
  doors: { ...type.label, color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase' },
  frontRow: { flexDirection: 'row', gap: spacing.sm },
  bay: {
    flex: 1,
    minHeight: 56,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    gap: 4,
  },
  bayWide: { flex: 0, width: '100%' },
  bayDoor: { borderColor: colors.info },
  bayLabel: { ...type.label, color: colors.info, textTransform: 'uppercase' },
  empty: { ...type.secondary, color: colors.textMuted },
  item: { ...type.secondaryStrong, color: colors.text },
  summary: { ...type.secondary, color: colors.textSecondary },
});
