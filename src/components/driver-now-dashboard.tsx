import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { RouteMapView } from '@/components/route-map';
import { driverNowCopy } from '@/data/driver-ui';
import type { RoutingLocation } from '@/domain/routing/models';
import type { DeliveryStop, Route } from '@/domain/route';
import { useElapsedRouteTime } from '@/hooks/use-elapsed-route-time';
import { stitchColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import type { RouteProgress } from '@/application/routes/route-workday';

export interface DriverNowDashboardProps {
  readonly route: Route;
  readonly routeLabel: string;
  readonly progress: RouteProgress;
  readonly stops: DeliveryStop[];
  readonly onContinue: () => void;
  readonly onOpenMap: () => void;
}

export function DriverNowDashboard({ route, routeLabel, progress, stops, onContinue, onOpenMap }: DriverNowDashboardProps) {
  const { scheme } = useTheme();
  const palette = stitchColorsFor(scheme).driverNow;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const elapsed = useElapsedRouteTime({ startedAt: route.startedAt });
  const nearbyStops = stops.filter((stop) => stop.deliveryStatus === 'pending').slice(0, 3);
  const map = routeMap(route, stops);
  const deliveryPercent = Math.max(0, Math.min(100, progress.deliveryPercent));

  return <View style={styles.dashboard} testID="driver-now-dashboard">
    <View style={styles.routeCard}>
      <View style={styles.routeHeading}>
        <View style={styles.routeIdentity}>
          <Text style={styles.routeNumber}>{routeLabel}</Text>
          <Text style={styles.routeDate}>{formatRouteDate(route.date)}</Text>
        </View>
        <Text style={styles.status}>VYKDOMAS</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${deliveryPercent}%` }]} />
      </View>
      <View style={styles.metrics}>
        <Metric palette={palette} styles={styles} icon="weight" label={driverNowCopy.remainingWeight} value={`${formatMetric(progress.remainingKnownWeightKg)} kg`} />
        <Metric palette={palette} styles={styles} icon="pin" label={driverNowCopy.points} value={`${progress.remainingStops} / ${progress.totalStops}`} />
        <Metric palette={palette} styles={styles} icon="route" label={driverNowCopy.remainingDistance} value={`${formatMetric(progress.preliminaryRemainingDistanceKm)} km`} />
        <Metric palette={palette} styles={styles} icon="timer" label={driverNowCopy.elapsedTime} value={elapsed} />
      </View>
    </View>

    <Pressable accessibilityLabel={driverNowCopy.mapAction} accessibilityRole="button" onPress={onOpenMap} style={styles.mapCard}>
      {map ? <RouteMapView compact allowStraightLineFallback startLocation={map.start} orderedStops={map.stops} endLocation={map.end} /> : <View style={styles.mapEmpty}><MapIcon palette={palette} /><Text style={styles.mapEmptyText}>{driverNowCopy.noCoordinates}</Text></View>}
      <View style={styles.mapAction}><Text style={styles.mapActionText}>{driverNowCopy.mapAction}</Text><Text style={styles.chevron}>›</Text></View>
    </Pressable>

    <View style={styles.stopsSection}>
      <Text style={styles.sectionTitle}>{driverNowCopy.nearbyStops}</Text>
      {nearbyStops.map((stop) => <StopPreview key={stop.id} palette={palette} styles={styles} stop={stop} />)}
    </View>

    <Pressable accessibilityLabel={driverNowCopy.continueRoute} accessibilityRole="button" onPress={onContinue} style={({ pressed }) => [styles.continueButton, pressed && styles.continuePressed]}>
      <Text style={styles.continueText}>{driverNowCopy.continueRoute}</Text>
      <NavigationIcon palette={palette} />
    </Pressable>
  </View>;
}

interface MetricProps {
  readonly icon: 'weight' | 'pin' | 'route' | 'timer';
  readonly label: string;
  readonly value: string;
  readonly palette: DriverPalette;
  readonly styles: DriverStyles;
}

function Metric({ icon, label, value, palette, styles }: MetricProps) {
  return <View style={styles.metric}>
    <DashboardIcon kind={icon} palette={palette} />
    <View style={styles.metricCopy}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>
  </View>;
}

interface StopPreviewProps {
  readonly stop: DeliveryStop;
  readonly palette: DriverPalette;
  readonly styles: DriverStyles;
}

function StopPreview({ stop, palette, styles }: StopPreviewProps) {
  const order = stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder;
  const window = [shortTime(stop.deliveryTimeFrom), shortTime(stop.deliveryTimeTo)].filter(Boolean).join('–');
  return <View style={[styles.stopCard, window && styles.stopTimed]}>
    <View style={styles.stopNumber}><Text style={styles.stopNumberText}>{order}</Text></View>
    <View style={styles.stopCopy}><Text style={styles.stopAddress}>{stop.address || stop.normalizedAddress || stop.originalAddress}</Text><Text style={styles.stopWeight}>{stop.weightKg === null ? 'Svoris nenurodytas' : `${formatMetric(stop.weightKg)} kg`}</Text></View>
    {window ? <View style={styles.stopWindow}><DashboardIcon kind="timer" palette={palette} size={15} /><Text style={styles.stopWindowText}>{window}</Text></View> : null}
  </View>;
}

interface DashboardIconProps {
  readonly kind: 'weight' | 'pin' | 'route' | 'timer';
  readonly size?: number;
  readonly palette: DriverPalette;
}

function DashboardIcon({ kind, size = 22, palette }: DashboardIconProps) {
  const color = palette.muted;
  return <Svg accessibilityLabel="" height={size} viewBox="0 0 24 24" width={size}>
    {kind === 'weight' ? <Path d="M7 8a5 5 0 0 1 10 0h1.2l2 12H3.8l2-12Zm3 0h4a2 2 0 0 0-4 0Z" fill={color} fillRule="evenodd" /> : null}
    {kind === 'pin' ? <Path d="M12 22s7-6.4 7-13a7 7 0 1 0-14 0c0 6.6 7 13 7 13Zm0-9.6A3.4 3.4 0 1 0 12 5.6a3.4 3.4 0 0 0 0 6.8Z" fill={color} fillRule="evenodd" /> : null}
    {kind === 'route' ? <Path d="M7 3v5m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v8m0 0v5m0-5c7 0 4-9 11-9m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v14" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.9} /> : null}
    {kind === 'timer' ? <><Circle cx={12} cy={13} fill="none" r={8} stroke={color} strokeWidth={1.9} /><Path d="M9 2h6M12 5v8l4 2" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.9} /></> : null}
  </Svg>;
}

function MapIcon({ palette }: { readonly palette: DriverPalette }) {
  return <Svg accessibilityLabel="" height={42} viewBox="0 0 24 24" width={42}><Path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15" fill="none" stroke={palette.routeBlue} strokeLinejoin="round" strokeWidth={1.5} /></Svg>;
}

function NavigationIcon({ palette }: { readonly palette: DriverPalette }) {
  return <Svg accessibilityLabel="" height={21} viewBox="0 0 24 24" width={21}><Path d="m12 3 7 17-7-4-7 4Z" fill="none" stroke={palette.surface} strokeLinejoin="round" strokeWidth={2} /></Svg>;
}

function routeMap(route: Route, stops: DeliveryStop[]): { start: RoutingLocation; stops: RoutingLocation[]; end: RoutingLocation } | null {
  const start = endpointLocation('start', route.startLocation);
  const end = endpointLocation('end', route.endLocation ?? route.startLocation);
  if (!start || !end) return null;
  const mappedStops = stops.flatMap((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude) ? [{ id: stop.id, label: stop.address, address: stop.address, latitude: stop.latitude as number, longitude: stop.longitude as number }] : []);
  return { start, stops: mappedStops, end };
}

function endpointLocation(id: string, endpoint: Route['startLocation']): RoutingLocation | null {
  if (!endpoint || !Number.isFinite(endpoint.latitude) || !Number.isFinite(endpoint.longitude)) return null;
  return { id, label: endpoint.normalizedAddress || endpoint.originalAddress, address: endpoint.originalAddress, latitude: endpoint.latitude as number, longitude: endpoint.longitude as number };
}

function shortTime(value: string | null): string {
  if (!value) return '';
  const match = value.match(/(\d{2}:\d{2})/);
  return match?.[1] ?? value;
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value);
}

function formatRouteDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

type DriverPalette = ReturnType<typeof stitchColorsFor>['driverNow'];
type DriverStyles = ReturnType<typeof createStyles>;

const createStyles = (palette: DriverPalette) => StyleSheet.create({
  dashboard: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: spacing.lg },
  routeCard: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, padding: spacing.md, gap: spacing.md },
  routeHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  routeIdentity: { flex: 1, minWidth: 0, gap: 2 },
  routeNumber: { ...type.pageTitle, fontSize: 25, lineHeight: 30, color: palette.text },
  routeDate: { ...type.secondary, color: palette.muted },
  status: { ...type.label, color: palette.surface, backgroundColor: palette.progress, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, overflow: 'hidden' },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: palette.progressSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: palette.progress },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  metric: { width: '50%', minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metricCopy: { minWidth: 0, gap: 1 },
  metricLabel: { ...type.label, color: palette.muted },
  metricValue: { fontFamily: fonts.mono, fontSize: 16, lineHeight: 21, color: palette.text },
  mapCard: { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, overflow: 'hidden' },
  mapEmpty: { height: 190, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm, backgroundColor: palette.routeBlueSoft },
  mapEmptyText: { ...type.secondary, color: palette.muted, textAlign: 'center' },
  mapAction: { minHeight: 54, borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mapActionText: { ...type.bodyStrong, color: palette.text },
  chevron: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 30, color: palette.text },
  stopsSection: { gap: spacing.sm },
  sectionTitle: { ...type.pageTitle, fontSize: 22, lineHeight: 27, color: palette.text, marginBottom: spacing.xs },
  stopCard: { minHeight: 82, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface, padding: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stopTimed: { borderLeftWidth: 4, borderLeftColor: palette.warning },
  stopNumber: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: palette.routeBlueSoft, alignItems: 'center', justifyContent: 'center' },
  stopNumberText: { fontFamily: fonts.mono, fontSize: 14, color: palette.text },
  stopCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  stopAddress: { ...type.bodyStrong, color: palette.text },
  stopWeight: { ...type.secondary, color: palette.muted },
  stopWindow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: 2 },
  stopWindowText: { ...type.label, color: palette.text },
  continueButton: { minHeight: 56, borderRadius: radius.md, backgroundColor: palette.routeBlue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  continuePressed: { backgroundColor: palette.routeBluePressed },
  continueText: { ...type.button, fontSize: 16, color: palette.surface },
});
