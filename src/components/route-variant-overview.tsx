import { StyleSheet, Text, View } from 'react-native';
import type { RouteCandidate, RouteOptimizationRequest } from '@/domain/routing/models';
import { clockLabel, durationLabel } from '@/ui/route-eta-labels';
import { useTheme } from '@/ui/theme';
import { spacing, type } from '@/ui/tokens';

export function RouteVariantSummary({ candidate, count, title }: {
  candidate: RouteCandidate; count: number; title: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.section} testID="selected-route-summary">
      <Text style={[styles.title, { color: colors.text }]}>Pasirinktas variantas: {title}</Text>
      <Text style={[type.sectionTitle, { color: colors.info }]}>Variantų: {count} · {candidate.totalDistanceKm.toFixed(1)} km · {durationLabel(candidate.totalWorkMinutes)} · Sustojimų: {candidate.stopSequence.length}</Text>
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
});
