import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export interface RouteListCardProps {
  readonly actionLabel: string;
  readonly dateLabel: string;
  readonly disabled?: boolean;
  readonly distanceLabel: string;
  readonly numberLabel: string;
  readonly onPress: () => void;
  readonly statusLabel: string;
  readonly statusTone: 'active' | 'planned' | 'completed' | 'cancelled';
  readonly stopsLabel: string;
  readonly testID?: string;
  readonly weightLabel: string;
}

export function RouteListCard(props: RouteListCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const active = props.statusTone === 'active';
  return (
    <Pressable
      accessibilityLabel={`${props.numberLabel}, ${props.dateLabel}, ${props.statusLabel}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.card, active && styles.cardActive, props.disabled && styles.disabled, pressed && styles.pressed]}
      testID={props.testID}>
      <View style={styles.heading}>
        <View style={styles.identity}>
          <Text style={styles.date}>{props.dateLabel}</Text>
          <Text style={styles.number}>{props.numberLabel}</Text>
        </View>
        <Text style={[styles.status, statusStyle(props.statusTone, styles)]}>{props.statusLabel}</Text>
      </View>
      <View style={styles.metrics}>
        <Metric label="SVORIS" styles={styles} value={props.weightLabel} />
        <Metric label="TAŠKAI" styles={styles} value={props.stopsLabel} />
        <Metric label="ATSTUMAS" styles={styles} value={props.distanceLabel} />
      </View>
      <View style={[styles.action, active && styles.actionActive]}><Text style={[styles.actionText, active && styles.actionTextActive]}>{props.actionLabel}</Text></View>
    </Pressable>
  );
}

function Metric({ label, styles, value }: { readonly label: string; readonly styles: ReturnType<typeof createStyles>; readonly value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={styles.metricValue}>{value}</Text></View>;
}

function statusStyle(tone: RouteListCardProps['statusTone'], styles: ReturnType<typeof createStyles>) {
  if (tone === 'active') return styles.statusActive;
  if (tone === 'completed') return styles.statusCompleted;
  if (tone === 'cancelled') return styles.statusCancelled;
  return styles.statusPlanned;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.md },
  cardActive: { borderWidth: 2, borderColor: colors.info },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.52 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  identity: { flex: 1, minWidth: 0, gap: 2 },
  date: { ...type.label, color: colors.textMuted },
  number: { ...type.sectionTitle, fontSize: 20, color: colors.text },
  status: { ...type.label, overflow: 'hidden', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusActive: { color: colors.info, backgroundColor: colors.infoSoft },
  statusPlanned: { color: colors.textSecondary, backgroundColor: colors.surfaceMuted },
  statusCompleted: { color: colors.success, backgroundColor: colors.accentSoft },
  statusCancelled: { color: colors.textMuted, backgroundColor: colors.surfaceMuted },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, minWidth: 0, gap: 2 },
  metricLabel: { ...type.label, color: colors.textMuted },
  metricValue: { ...type.bodyStrong, color: colors.text },
  action: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  actionActive: { borderColor: colors.info, backgroundColor: colors.info },
  actionText: { ...type.button, color: colors.textSecondary },
  actionTextActive: { color: colors.textInverse },
});
