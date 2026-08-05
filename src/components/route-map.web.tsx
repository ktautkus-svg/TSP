import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';

import { decodePolyline } from '@/domain/routing/evaluation/geo';
import type { RoutingLocation } from '@/domain/routing/models';
import { colors, spacing } from '@/ui/tokens';

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

function pinIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: 'route-map-pin',
    html: `<div style="
      width: 26px; height: 26px; border-radius: 50%;
      background: ${color}; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; font-size: 11px; font-family: sans-serif;
    ">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

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
  const routePoints = useMemo(() => (
    encodedPolyline
      ? decodePolyline(encodedPolyline)
      : allowStraightLineFallback
        ? [startLocation, ...orderedStops, endLocation]
        : []
  ), [encodedPolyline, allowStraightLineFallback, startLocation, orderedStops, endLocation]);

  const polylinePositions: [number, number][] = routePoints.map((point) => [point.latitude, point.longitude]);
  const allPoints: [number, number][] = ([
    [startLocation.latitude, startLocation.longitude],
    ...orderedStops.map((stop): [number, number] => [stop.latitude, stop.longitude]),
    [endLocation.latitude, endLocation.longitude],
    ...polylinePositions,
  ] as [number, number][]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  const startIcon = useMemo(() => pinIcon('#10B981', 'S'), []);
  const endIcon = useMemo(() => pinIcon('#EF4444', 'G'), []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Maršruto žemėlapis</Text>
        {totalDistanceKm !== undefined && totalDurationMinutes !== undefined ? (
          <Text style={styles.badge}>
            {totalDistanceKm.toFixed(1)} km · {Math.round(totalDurationMinutes)} min
          </Text>
        ) : null}
      </View>

      <View style={styles.canvasContainer}>
        <MapContainer
          center={[startLocation.latitude, startLocation.longitude]}
          zoom={12}
          scrollWheelZoom
          style={{ width: '100%', height: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={allPoints} />
          {polylinePositions.length > 1 ? (
            <Polyline positions={polylinePositions} pathOptions={{ color: '#2563EB', weight: 4, opacity: 0.85 }} />
          ) : null}
          <Marker position={[startLocation.latitude, startLocation.longitude]} icon={startIcon} />
          {orderedStops.map((stop, index) => (
            <Marker
              key={stop.id}
              position={[stop.latitude, stop.longitude]}
              icon={pinIcon('#2563EB', String(index + 1))}
            />
          ))}
          <Marker position={[endLocation.latitude, endLocation.longitude]} icon={endIcon} />
        </MapContainer>
      </View>

      {polylineError ? (
        <Text style={styles.error}>Kelio linijos gauti nepavyko: {polylineError}</Text>
      ) : !encodedPolyline && !allowStraightLineFallback ? (
        <Text style={styles.pending}>Tikroji kelio linija dar negauta.</Text>
      ) : allowStraightLineFallback && !encodedPolyline ? (
        <Text style={styles.synthetic}>Sintetinė schema jungia taškus tiesiomis linijomis.</Text>
      ) : null}

      <View style={styles.legend}>
        <Legend color="#10B981" text={`Startas: ${startLocation.label}`} />
        {orderedStops.map((stop, index) => (
          <Legend key={stop.id} color="#2563EB" text={`${index + 1}. ${stop.label}`} />
        ))}
        <Legend color="#EF4444" text={`Grįžimas: ${endLocation.label}`} />
      </View>
    </View>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 260,
    height: 260,
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
