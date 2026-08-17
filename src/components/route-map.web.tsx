import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { decodePolyline } from '@/domain/routing/evaluation/geo';
import type { RoutingLocation } from '@/domain/routing/models';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export interface RouteMapViewProps {
  readonly startLocation: RoutingLocation;
  readonly orderedStops: RoutingLocation[];
  readonly endLocation: RoutingLocation;
  readonly encodedPolyline?: string;
  readonly totalDistanceKm?: number;
  readonly totalDurationMinutes?: number;
  readonly allowStraightLineFallback?: boolean;
  readonly compact?: boolean;
  readonly polylineError?: string | null;
}

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

/**
 * Wheel over the map scrolls the page; Ctrl (or Cmd) + wheel zooms the map.
 *
 * Leaflet's own handler calls preventDefault on every wheel event, so a map
 * parked mid-screen ate the scroll and the page looked frozen — on the route
 * options screen the driver could not reach the choices past it. Turning the
 * zoom off outright would have thrown away a feature that was deliberately kept
 * before, so the handler stays and is simply gated on the modifier key.
 */
function WheelZoomGuard() {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.disable();
    const container = map.getContainer();
    const onWheel = (event: WheelEvent) => {
      const wantsZoom = event.ctrlKey || event.metaKey;
      if (wantsZoom && !map.scrollWheelZoom.enabled()) map.scrollWheelZoom.enable();
      if (!wantsZoom && map.scrollWheelZoom.enabled()) map.scrollWheelZoom.disable();
    };
    // Capture, so the decision is made before Leaflet's own listener runs.
    container.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => container.removeEventListener('wheel', onWheel, { capture: true });
  }, [map]);
  return null;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const fit = () => {
      map.invalidateSize({ animate: false });
      if (points.length === 1) map.setView(points[0], 13);
      else map.fitBounds(points, { padding: [28, 28], animate: false });
    };
    fit();
    const first = window.setTimeout(fit, 80);
    const second = window.setTimeout(fit, 350);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(fit);
    observer?.observe(map.getContainer());
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
      observer?.disconnect();
    };
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
  compact = false,
  polylineError,
}: RouteMapViewProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Keep the existing map interaction and reduce only its vertical footprint
  // by roughly one centimetre, leaving page surface available for scrolling.
  const mapHeight = compact ? 190 : width >= 1024 ? 500 : width >= 720 ? 390 : 330;
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
    <View style={[styles.container, compact && styles.compactContainer]}>
      {!compact ? <View style={styles.header}>
        <Text style={styles.title}>Maršruto žemėlapis</Text>
        {totalDistanceKm !== undefined && totalDurationMinutes !== undefined ? (
          <Text style={styles.badge}>
            {totalDistanceKm.toFixed(1)} km · {Math.round(totalDurationMinutes)} min
          </Text>
        ) : null}
      </View> : null}

      <View style={[styles.canvasContainer, { height: mapHeight }]} testID="route-map-canvas">
        <MapContainer
          center={[startLocation.latitude, startLocation.longitude]}
          zoom={12}
          // Left on, but handed to WheelZoomGuard below, which only lets Leaflet
          // take the wheel while Ctrl (or Cmd) is held.
          scrollWheelZoom
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <WheelZoomGuard />
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

      {!compact && (polylineError || (!encodedPolyline && !allowStraightLineFallback)) ? (
        <Text style={styles.pending}>Maršruto linija dar kraunama. Taškai jau rodomi žemėlapyje.</Text>
      ) : null}
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
  compactContainer: { borderWidth: 0, borderRadius: 0, padding: 0, gap: 0 },
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
    position: 'relative',
    width: '100%',
    minHeight: 330,
    height: 330,
    borderRadius: 12,
    backgroundColor: colors.background,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pending: { color: colors.textMuted, fontSize: 13 },
});
