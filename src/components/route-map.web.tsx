import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { mapGeometrySignature, shouldRefitMap } from '@/application/routes/map-camera';
import { decodePolyline } from '@/domain/routing/evaluation/geo';
import type { RoutingLocation } from '@/domain/routing/models';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

// CARTO started watermarking keyless basemaps with “API KEY REQUIRED”. For this
// personal, human-operated map use the official OSM endpoint and preserve a
// normal browser Referer, as required by OSM's tile usage policy. The URL stays
// configurable so a self-hosted/contracted OSM-compatible service can be used
// without another application release.
const MAP_TILE_URL = process.env.EXPO_PUBLIC_OSM_TILE_URL?.trim()
  || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

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
  /** When false, hide the idle „line not received yet“ hint (e.g. before the driver asks for the real polyline). Errors still show. */
  readonly expectPolyline?: boolean;
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

function MapCamera({
  points,
  signature,
  fitRequest,
}: {
  points: [number, number][];
  signature: string;
  fitRequest: number;
}) {
  const map = useMap();
  const userAdjusted = useRef(false);
  const fitting = useRef(false);
  const fitted = useRef<string | null>(null);
  const lastRequest = useRef(0);
  useEffect(() => {
    const markAdjusted = () => { if (!fitting.current) userAdjusted.current = true; };
    map.on('zoomstart', markAdjusted);
    map.on('dragstart', markAdjusted);
    return () => {
      map.off('zoomstart', markAdjusted);
      map.off('dragstart', markAdjusted);
    };
  }, [map]);
  useEffect(() => {
    const explicit = fitRequest !== lastRequest.current;
    if (explicit) {
      lastRequest.current = fitRequest;
      userAdjusted.current = false;
    }
    if (!shouldRefitMap({
      previousSignature: fitted.current,
      nextSignature: signature,
      userAdjusted: userAdjusted.current,
      explicit,
    })) return;
    const fit = () => {
      fitting.current = true;
      map.invalidateSize({ animate: false });
      if (points.length === 1) map.setView(points[0]!, 13, { animate: false });
      else map.fitBounds(points, { padding: [28, 28], animate: false });
      window.setTimeout(() => { fitting.current = false; }, 150);
    };
    fit();
    fitted.current = signature;
    const settled = window.setTimeout(fit, 80);
    return () => window.clearTimeout(settled);
  }, [fitRequest, map, points, signature]);
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
  expectPolyline = true,
}: RouteMapViewProps) {
  const [tileFailed, setTileFailed] = useState(false);
  const [showFailureDetails, setShowFailureDetails] = useState(false);
  const [tileAttempt, setTileAttempt] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Keep the existing map interaction and reduce only its vertical footprint
  // by roughly one centimetre, leaving page surface available for scrolling.
  const mapHeight = compact ? 150 : width >= 1024 ? 500 : width >= 720 ? 390 : 330;
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

  const signature = mapGeometrySignature(allPoints);
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
        <Pressable accessibilityRole="button" onPress={() => setFitRequest((value) => value + 1)} style={styles.retry} testID="show-full-route">
          <Text style={styles.retryText}>Rodyti visą maršrutą</Text>
        </Pressable>
      </View> : <Pressable accessibilityRole="button" onPress={() => setFitRequest((value) => value + 1)} style={styles.retry} testID="show-full-route">
        <Text style={styles.retryText}>Rodyti visą maršrutą</Text>
      </Pressable>}

      <View style={[styles.canvasContainer, compact && styles.compactCanvas, { height: tileFailed ? 'auto' : mapHeight }]} testID="route-map-canvas">
        {tileFailed ? (
          <View style={styles.failure} testID="route-map-error" accessibilityLiveRegion="polite">
            <Text style={styles.title}>Nepavyko įkelti žemėlapio</Text>
            <Text style={styles.pending}>Sustojimų duomenys išlieka pasiekiami. Galite tęsti darbą be žemėlapio.</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFailureDetails }} style={styles.retry}
              onPress={() => setShowFailureDetails((value) => !value)}>
              <Text style={styles.attention}>Reikia dėmesio: žemėlapio sluoksnis nepasiekiamas</Text>
            </Pressable>
            {showFailureDetails ? <Text style={styles.pending}>Nepavyko gauti žemėlapio vaizdų iš tiekėjo. Patikrinkite interneto ryšį arba bandykite vėliau. Tai nekeičia apskaičiuoto maršruto.</Text> : null}
            <Pressable accessibilityRole="button" style={styles.retry} testID="retry-route-map"
              onPress={() => { setTileAttempt((value) => value + 1); setTileFailed(false); setShowFailureDetails(false); }}>
              <Text style={styles.retryText}>Bandyti dar kartą</Text>
            </Pressable>
          </View>
        ) : <MapContainer
          center={[startLocation.latitude, startLocation.longitude]}
          zoom={12}
          scrollWheelZoom
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <TileLayer
            key={tileAttempt}
            eventHandlers={{ tileerror: () => setTileFailed(true) }}
            attribution={MAP_TILE_ATTRIBUTION}
            url={MAP_TILE_URL}
            maxZoom={19}
            referrerPolicy="strict-origin-when-cross-origin"
          />
          <WheelZoomGuard />
          <MapCamera fitRequest={fitRequest} points={allPoints} signature={signature} />
          {polylinePositions.length > 1 ? (
            <Polyline
              key={polylinePositions.map((point) => point.join(',')).join('|')}
              positions={polylinePositions}
              pathOptions={{ color: '#2563EB', weight: 4, opacity: 0.85 }}
            />
          ) : null}
          <Marker position={[startLocation.latitude, startLocation.longitude]} icon={startIcon} />
          {orderedStops.map((stop, index) => (
            <Marker
              key={`${index}-${stop.id}`}
              position={[stop.latitude, stop.longitude]}
              icon={pinIcon('#2563EB', String(index + 1))}
            />
          ))}
          <Marker position={[endLocation.latitude, endLocation.longitude]} icon={endIcon} />
        </MapContainer>}
      </View>

      {!tileFailed && !compact && (polylineError || (expectPolyline && !encodedPolyline && !allowStraightLineFallback)) ? (
        <Text style={styles.pending}>{polylineError ? 'Kelio linijos įkelti nepavyko. Sustojimų taškai rodomi žemėlapyje.' : 'Kelio linija dar negauta. Sustojimų taškai rodomi žemėlapyje.'}</Text>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  failure: { justifyContent: 'center', padding: spacing.md, gap: spacing.sm },
  retry: { minHeight: 48, justifyContent: 'center', padding: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md },
  retryText: { ...type.button, color: colors.info },
  attention: { ...type.secondaryStrong, color: colors.warning },
  container: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  compactContainer: { borderWidth: 0, borderRadius: 0, padding: 0, gap: 0 },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, ...type.sectionTitle },
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
    zIndex: 0,
  },
  compactCanvas: { minHeight: 190, height: 190 },
  pending: { color: colors.textMuted, fontSize: 13 },
});
