import { StyleSheet, Text, View } from 'react-native';
import type { RouteCandidate, RouteOptimizationRequest } from '@/domain/routing/models';
import { clockLabel, durationLabel } from '@/ui/route-eta-labels';
import { useTheme } from '@/ui/theme';
import { radius, spacing, type } from '@/ui/tokens';

export function RouteVariantSummary({ candidate, count, title }: {
  candidate: RouteCandidate; count: number; title: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.summary, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="selected-route-summary">
      <View style={styles.summaryLead}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>PASIRINKTAS VARIANTAS</Text>
        <Text style={[styles.summaryTitle, { color: colors.text }]}>{title}</Text>
      </View>
      <View style={styles.summaryMetrics}>
        <SummaryMetric label="ATSTUMAS" value={`${candidate.totalDistanceKm.toFixed(1)} km`} color={colors.info} muted={colors.textMuted} />
        <SummaryMetric label="TRUKMĖ" value={durationLabel(candidate.totalWorkMinutes)} color={colors.text} muted={colors.textMuted} />
        <SummaryMetric label="SUSTOJIMAI" value={String(candidate.stopSequence.length)} color={colors.text} muted={colors.textMuted} />
        <SummaryMetric label="VARIANTAI" value={String(count)} color={colors.text} muted={colors.textMuted} />
      </View>
    </View>
  );
}

function SummaryMetric({ label, value, color, muted }: { label: string; value: string; color: string; muted: string }) {
  return (
    <View style={styles.summaryMetric}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

export function RouteVariantStops({ candidate, request }: {
  candidate: RouteCandidate; request: RouteOptimizationRequest;
}) {
  const { colors } = useTheme();
  const textStyle = [type.body, { color: colors.textSecondary }];
  const stops = new Map(request.stops.map((stop) => [stop.id, stop]));
  const schedules = new Map(candidate.schedules.map((schedule) => [schedule.stopId, schedule]));
  return (
    <View style={styles.section} testID="selected-route-stops">
      <Text style={[styles.title, { color: colors.text }]}>Pasirinkto varianto sustojimai</Text>
      {candidate.stopSequence.map((stopId, index) => {
        const stop = stops.get(stopId);
        const schedule = schedules.get(stopId);
        return (
          <View key={stopId} style={[styles.stop, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>{index + 1}. {stop?.location.label ?? stopId}</Text>
            {stop?.location.address ? <Text style={textStyle}>{stop.location.address}</Text> : null}
            <Text style={textStyle}>Planuojamas laikas: {clockLabel(schedule?.serviceStartAt) || 'Nenurodytas'}</Text>
            <Text style={textStyle}>{!schedule ? 'Laikas neapskaičiuotas' : schedule.lateMinutes > 0 ? `Numatomas vėlavimas: ${Math.round(schedule.lateMinutes)} min` : schedule.waitingMinutes > 0 ? `Numatomas laukimas: ${Math.round(schedule.waitingMinutes)} min` : 'Suplanuota'}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  title: { ...type.cardTitle, flexShrink: 1 },
  stop: { paddingVertical: spacing.md, borderBottomWidth: 1, gap: spacing.xs },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.lg },
  summaryLead: { minWidth: 210, flex: 1, gap: 2 },
  summaryTitle: { ...type.sectionTitle },
  summaryMetrics: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg },
  summaryMetric: { minWidth: 86, gap: 1 },
  summaryValue: { ...type.bodyStrong },
  summaryLabel: { ...type.label },
});
