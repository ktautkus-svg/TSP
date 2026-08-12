import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export interface RouteResultSummaryProps {
  readonly actualDistance: string;
  readonly plannedDistance: string;
  readonly duration: string;
  readonly deliveredStops: number;
  readonly failedStops: number;
  readonly distanceDeviation: string;
  readonly durationDeviation: string;
  readonly startOdometer: string;
  readonly endOdometer: string;
}

export function RouteResultSummary(props: RouteResultSummaryProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.container} testID="route-completion-result">
      <View style={styles.hero}>
        <View style={styles.checkIcon}>
          <Svg accessibilityLabel="Maršrutas užbaigtas" height={42} viewBox="0 0 48 48" width={42}>
            <Circle cx={24} cy={24} fill="none" r={20} stroke={colors.textInverse} strokeWidth={3.4} />
            <Path d="m14 24 7 7 14-15" fill="none" stroke={colors.textInverse} strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} />
          </Svg>
        </View>
        <Text style={styles.heroTitle}>Maršrutas baigtas</Text>
        <Text style={styles.heroText}>Visi darbo dienos duomenys išsaugoti.</Text>
      </View>

      <View style={styles.metrics}>
        <Metric label="ATSTUMAS" value={props.actualDistance} styles={styles} />
        <Metric label="LAIKAS" value={props.duration} styles={styles} />
        <Metric label="PRISTATYTA" value={String(props.deliveredStops)} styles={styles} />
        <Metric label="NEPAVYKO" value={String(props.failedStops)} styles={styles} tone={props.failedStops > 0 ? 'danger' : 'default'} />
      </View>

      <View style={styles.details}>
        <Detail label="Planuotas atstumas" value={props.plannedDistance} styles={styles} />
        <Detail label="Atstumo nuokrypis" value={props.distanceDeviation} styles={styles} />
        <Detail label="Laiko nuokrypis" value={props.durationDeviation} styles={styles} />
        <Detail label="Odometras" value={`${props.startOdometer} → ${props.endOdometer}`} styles={styles} />
      </View>
    </View>
  );
}

function Metric({ label, value, styles, tone = 'default' }: { readonly label: string; readonly value: string; readonly styles: ReturnType<typeof createStyles>; readonly tone?: 'default' | 'danger' }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, tone === 'danger' && styles.metricDanger]}>{value}</Text></View>;
}

function Detail({ label, value, styles }: { readonly label: string; readonly value: string; readonly styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  hero: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, backgroundColor: colors.success, gap: spacing.sm },
  checkIcon: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentStrong },
  heroTitle: { ...type.pageTitle, color: colors.textInverse, textAlign: 'center' },
  heroText: { ...type.body, color: colors.textInverse, textAlign: 'center', opacity: 0.86 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceSubtle },
  metric: { flexGrow: 1, minWidth: '45%', minHeight: 78, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.sm, gap: 2 },
  metricLabel: { ...type.label, color: colors.textMuted, textAlign: 'center' },
  metricValue: { ...type.readout, color: colors.text, textAlign: 'center' },
  metricDanger: { color: colors.danger },
  details: { padding: spacing.md },
  detailRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  detailLabel: { ...type.secondary, color: colors.textMuted },
  detailValue: { ...type.secondaryStrong, color: colors.text, textAlign: 'right' },
});
