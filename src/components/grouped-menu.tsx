import { Children, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronDownIcon, ChevronRightIcon } from '@/components/app-icons';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export function GroupedMenuSection({ children, label, testID }: { children: ReactNode; label: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rows = Children.toArray(children);
  return <View style={styles.section} testID={testID}>
    <Text style={styles.sectionLabel}>{label}</Text>
    <View style={styles.body}>
      {rows.map((row, index) => <View key={index}>
        {index > 0 ? <View style={styles.divider} /> : null}
        {row}
      </View>)}
    </View>
  </View>;
}

export function GroupedMenuRow({
  description,
  disabled = false,
  expanded,
  icon,
  onPress,
  testID,
  title,
  tone = 'info',
}: {
  description?: string;
  disabled?: boolean;
  expanded?: boolean;
  icon?: ReactNode;
  onPress: () => void;
  testID?: string;
  title: string;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}
    testID={testID}>
    {icon ? <View style={[styles.icon, iconTone(tone, styles)]}>{icon}</View> : null}
    <View style={styles.copy}>
      <Text style={[styles.title, tone === 'danger' && styles.dangerTitle]}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
    {expanded === undefined ? <ChevronRightIcon color={colors.info} /> : expanded ? <ChevronDownIcon color={colors.info} /> : <ChevronRightIcon color={colors.info} />}
  </Pressable>;
}

function iconTone(tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral', styles: ReturnType<typeof createStyles>) {
  if (tone === 'success') return styles.iconSuccess;
  if (tone === 'warning') return styles.iconWarning;
  if (tone === 'danger') return styles.iconDanger;
  if (tone === 'neutral') return styles.iconNeutral;
  return styles.iconInfo;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  section: { gap: spacing.xs },
  sectionLabel: { ...type.label, color: colors.textMuted, paddingHorizontal: spacing.xs },
  body: { overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  divider: { height: 1, marginHorizontal: spacing.md, backgroundColor: colors.border },
  row: { minHeight: 72, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { backgroundColor: colors.surfaceSubtle },
  disabled: { opacity: 0.48 },
  icon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconInfo: { backgroundColor: colors.infoSoft },
  iconSuccess: { backgroundColor: colors.accentSoft },
  iconWarning: { backgroundColor: colors.warningSoft },
  iconDanger: { backgroundColor: colors.dangerSoft },
  iconNeutral: { backgroundColor: colors.surfaceMuted },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.bodyStrong, color: colors.text },
  dangerTitle: { color: colors.danger },
  description: { ...type.secondary, color: colors.textSecondary },
});
