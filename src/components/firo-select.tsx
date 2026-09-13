import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChevronDownIcon } from '@/components/app-icons';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

export type FiroSelectOption = {
  id: string;
  /** Shown prominently — e.g. a registration number or a person's name. */
  primary: string;
  /** Shown muted below the primary — e.g. a model or a status. */
  secondary?: string;
};

/**
 * Compact single-select: one closed field showing the current pick, opening
 * into a scrollable list of options. Reuse this instead of a card/button grid
 * whenever a screen needs to pick one item (vehicle, driver, employee…) from
 * a list — a grid of cards should only remain where several items are picked
 * at once or where every option must stay visible for comparison.
 */
export function FiroSelect({
  label,
  placeholder,
  emptyLabel,
  options,
  value,
  onChange,
  testID,
  getOptionTestID,
  disabled,
}: {
  label?: string;
  placeholder: string;
  emptyLabel?: string;
  options: readonly FiroSelectOption[];
  value: string;
  onChange: (id: string) => void;
  testID?: string;
  getOptionTestID?: (option: FiroSelectOption) => string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <View style={styles.container} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        style={[styles.trigger, open && styles.triggerOpen, disabled && styles.triggerDisabled]}
        testID={testID ? `${testID}-trigger` : undefined}>
        <View style={styles.value}>
          <Text numberOfLines={1} style={[styles.primary, !selected && styles.placeholder]}>
            {selected
              ? (selected.secondary ? `${selected.primary} · ${selected.secondary}` : selected.primary)
              : placeholder}
          </Text>
        </View>
        <ChevronDownIcon size={18} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.listContent}>
          {options.length === 0 ? <Text style={styles.empty}>{emptyLabel ?? 'Pasirinkimų nėra.'}</Text> : options.map((option) => {
            const active = option.id === value;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => { onChange(option.id); setOpen(false); }}
                style={[styles.option, active && styles.optionActive]}
                testID={getOptionTestID?.(option)}>
                <View style={styles.optionContent}>
                  <Text style={[styles.optionPrimary, active && styles.optionPrimaryActive]}>{option.primary}</Text>
                  {option.secondary ? <Text style={styles.optionSecondary}>{option.secondary}</Text> : null}
                </View>
                {active ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: { gap: spacing.xs },
    label: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
    trigger: {
      minHeight: 56,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    triggerOpen: { borderColor: colors.info, backgroundColor: colors.infoSoft },
    triggerDisabled: { opacity: 0.6 },
    value: { flex: 1, minWidth: 0, gap: 2 },
    primary: { ...type.bodyStrong, color: colors.text },
    placeholder: { color: colors.textMuted },
    list: { maxHeight: 260, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.surface },
    listContent: { padding: spacing.xs, gap: 4 },
    empty: { ...type.secondary, color: colors.textMuted, padding: spacing.sm },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm },
    optionActive: { backgroundColor: colors.infoSoft },
    optionContent: { flex: 1, minWidth: 0, gap: 2 },
    optionPrimary: { ...type.bodyStrong, color: colors.text },
    optionPrimaryActive: { color: colors.info },
    optionSecondary: { ...type.meta, color: colors.textMuted },
    check: { ...type.bodyStrong, color: colors.info },
  });
}
