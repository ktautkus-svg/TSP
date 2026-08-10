import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Polyline,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { decodePolyline } from '@/domain/routing/evaluation/geo';
import type { RoutingLocation } from '@/domain/routing/models';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type RouteMapViewProps = {
  startLocation: RoutingLocation;
  orderedStops: RoutingLocation[];
  endLocation: RoutingLocation;
  encodedPolyline?: string;
  totalDistanceKm?: number;
  totalDurationMinutes?: number;
  allowStraightLineFallback?: boolean;
  polylineError?: string | null;
};

const WIDTH = 320;
const HEIGHT = 200;
const PADDING = 35;

export function RouteMapView({
  startLocation,
  orderedStops,
  endLocation,
  encodedPolyline,
  totalDistanceKm,
  totalDurationMinutes,
  allowStraightLineFallback = false,
  polylineError,
}: RouteMapViewProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const routePoints = encodedPolyline
    ? decodePolyline(encodedPolyline)
    : allowStraightLineFallback
      ? [startLocation, ...orderedStops, endLocation]
      : [];
  const projectionPoints = [...routePoints, startLocation, ...orderedStops, endLocation];
  const validPoints = projectionPoints.filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );
  const latitudes = validPoints.map((point) => point.latitude);
  const longitudes = validPoints.map((point) => point.longitude);
  const minLat = latitudes.length ? Math.min(...latitudes) : 0;
  const maxLat = latitudes.length ? Math.max(...latitudes) : 0;
  const minLng = longitudes.length ? Math.min(...longitudes) : 0;
  const maxLng = longitudes.length ? Math.max(...longitudes) : 0;
  const latSpan = Math.max(0.0005, maxLat - minLat);
  const lngSpan = Math.max(0.0005, maxLng - minLng);
  const project = (point: { latitude: number; longitude: number }) => ({
    x: PADDING + ((point.longitude - minLng) / lngSpan) * (WIDTH - 2 * PADDING),
    y: HEIGHT - (PADDING + ((point.latitude - minLat) / latSpan) * (HEIGHT - 2 * PADDING)),
  });
  const start = project(startLocation);
  const rawEnd = project(endLocation);
  const samePhysicalEnd =
    startLocation.latitude === endLocation.latitude &&
    startLocation.longitude === endLocation.longitude;
  const end = samePhysicalEnd
    ? { x: Math.min(WIDTH - 12, rawEnd.x + 12), y: Math.min(HEIGHT - 12, rawEnd.y + 12) }
    : rawEnd;
  const polylinePoints = routePoints
    .map(project)
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Maršruto schema</Text>
        {totalDistanceKm !== undefined && totalDurationMinutes !== undefined ? (
          <Text style={styles.badge}>
            {totalDistanceKm.toFixed(1)} km · {Math.round(totalDurationMinutes)} min
          </Text>
        ) : null}
      </View>

      <View style={styles.canvasContainer}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Defs>
            <LinearGradient id="routeGradient" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#2563EB" stopOpacity={0.9} />
              <Stop offset="1" stopColor="#7C3AED" stopOpacity={0.9} />
            </LinearGradient>
          </Defs>
          {routePoints.length > 1 ? (
            <Polyline
              points={polylinePoints}
              fill="none"
              stroke="url(#routeGradient)"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          <Marker x={start.x} y={start.y} color="#10B981" label="S" />
          {orderedStops.map((stop, index) => {
            const point = project(stop);
            return (
              <Marker
                key={stop.id}
                x={point.x}
                y={point.y}
                color="#2563EB"
                label={String(index + 1)}
                radius={7}
              />
            );
          })}
          <Marker x={end.x} y={end.y} color="#EF4444" label="G" />
        </Svg>
      </View>

      {polylineError ? (
        <Text style={styles.error}>Kelio linijos gauti nepavyko: {polylineError}</Text>
      ) : !encodedPolyline && !allowStraightLineFallback ? (
        <Text style={styles.pending}>Tikroji kelio linija dar negauta.</Text>
      ) : allowStraightLineFallback && !encodedPolyline ? (
        <Text style={styles.synthetic}>Sintetinė schema jungia taškus tiesiomis linijomis.</Text>
      ) : null}

      {/* Full per-stop address list lives in the candidate card's own "Rodyti
          eiliškumą" toggle — repeating it here just made the map noisy. */}
      <View style={styles.legend}>
        <Legend styles={styles} color="#10B981" text={`Startas: ${startLocation.label}`} />
        {orderedStops.length > 0 ? (
          <Legend styles={styles} color="#2563EB" text={`${orderedStops.length} ${orderedStops.length === 1 ? 'sustojimas' : 'sustojimai'} (numeriai žemėlapyje)`} />
        ) : null}
        <Legend styles={styles} color="#EF4444" text={`Grįžimas: ${endLocation.label}`} />
      </View>
    </View>
  );
}

function Marker(props: { x: number; y: number; color: string; label: string; radius?: number }) {
  const radius = props.radius ?? 8;
  return (
    <G>
      <Circle cx={props.x} cy={props.y} r={radius} fill={props.color} stroke="#FFFFFF" strokeWidth={2} />
      <SvgText
        x={props.x}
        y={props.y + 3}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={8}
        fontWeight="bold">
        {props.label}
      </SvgText>
    </G>
  );
}

function Legend({ styles, color, text }: { styles: ReturnType<typeof createStyles>; color: string; text: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  container: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  badge: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 13,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  canvasContainer: {
    width: '100%',
    minHeight: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.background,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  pending: { color: colors.textMuted, fontSize: 13 },
  synthetic: { color: colors.warning, fontSize: 13 },
  legend: { gap: 5, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.text, fontSize: 13, flexShrink: 1 },
});
