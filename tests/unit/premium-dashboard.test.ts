import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, '../../', path), 'utf8');

describe('premium route dashboard', () => {
  it('renders restrained code-native instrument gauges driven by live values', () => {
    const gauge = source('src/components/instrument-gauge.tsx');
    // Premium 270-degree cluster: a restrained blue route arc, fine scale and
    // a slim line needle. There are no decorative wedges or triangle needles.
    expect(gauge).toContain('const DIAL_START = 225');
    expect(gauge).toContain('const DIAL_SWEEP = 270');
    expect(gauge).not.toContain('WEDGE_PATH');
    expect(gauge).not.toContain('<Path');
    expect(gauge).toContain('const fraction = delivered / safeMaximum');
    expect(gauge).toContain('remaining ?? safeMaximum - delivered');
    expect(gauge).toContain('needleAngle');
    expect(gauge).toContain('const needleTip = polar(needleAngle, 70)');
    expect(gauge).not.toContain('redZone');
    expect(gauge).not.toContain('fraction >= 0.85');
    expect(gauge).toContain('id="routeProgress"');
    expect(gauge).toContain('cockpitColors.routeBlue');
    expect(gauge).toContain('LIKO');
    expect(gauge).toContain('{unit}');
    expect(gauge).toContain('stroke="url(#steelRing)"');
    expect(gauge).toContain('stroke="url(#routeProgress)"');
    expect(gauge).toContain('useGrouping: false');
    expect(gauge).toContain('fontFamily={fonts.heading}');
    expect(gauge).toContain('fontSize={readoutFontSize}');
    expect(gauge).toContain('<SvgText');
    expect(gauge).not.toContain('<Image');
  });

  it('composes the premium windshield and restrained HUD progress rail', () => {
    const road = source('src/components/road-progress-bar.tsx');
    expect(road).toContain('route-windshield-premium-v2.png');
    expect(road).toContain('resizeMode="cover"');
    expect(road).toContain('Math.round(clamped * 100)');
    expect(road).toContain('Animated.timing');
    expect(road).toContain('<Svg');
    expect(road).toContain('displayedProgress * 100');
    expect(road).toContain('<Image');
    expect(road).not.toContain('<SvgImage');
    expect(road).toContain('MARŠRUTO EIGA');
    expect(road).toContain('cockpitColors.routeBlue');
    expect(road).toContain('MARŠRUTAS BAIGTAS');
    expect(road).not.toContain('cloudBlob');
    expect(road).toContain('<WeatherOverlay');
    expect(road).toContain('<TimeOfDayOverlay');
    // Night must stay readable through glass: soft indigo, moon, not a blackout.
    expect(road).toContain("timeOfDay === 'night'");
    expect(road).toContain('moonGlow');
    expect(road).toContain('opacity: 0.52');
    expect(road).not.toContain('opacity: 0.93');
  });

  it('matches the compact continuous dashboard while preserving route actions', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('<BrandHeader onMenuPress');
    expect(delivery).not.toContain('ŠIANDIENOS MARŠRUTAS');
    expect(delivery).toContain('<RoadProgressBar');
    expect(delivery.indexOf('<RoadProgressBar')).toBeLessThan(delivery.indexOf('<InstrumentGauge'));
    expect(delivery).toContain('<InstrumentGauge');
    // The arc/needle tracks delivered totals while the clean numeric readout
    // shows what is still on board.
    expect(delivery).toContain('value={progress.totalKnownWeightKg - progress.remainingKnownWeightKg}');
    expect(delivery).toContain('remaining={progress.remainingKnownWeightKg}');
    expect(delivery).toContain('unit="kg"');
    expect(delivery).toContain('value={progress.totalStops - progress.remainingStops}');
    expect(delivery).toContain('remaining={progress.remainingStops}');
    expect(delivery).toContain('styles.gaugeCenterStats');
    expect(delivery).toContain('cockpitColors.canvas');
    expect(delivery).toContain('IKI ARTIMIAUSIOS');
    expect(delivery).toContain('NAVIGUOTI');
    expect(delivery).toContain('void navigate(nextStop)');
    expect(delivery).toContain('dashboard-stop-heading');
    expect(delivery).toContain('dashboard-stop-actions');
    expect(delivery).toContain('dashboard-delivered-button');
    expect(delivery).toContain('dashboard-failed-button');
    expect(delivery).toContain('ATLIKTA');
    expect(delivery).toContain('NEATLIKTA');
    expect(delivery).toContain('UŽBAIGTI MARŠRUTĄ');
    expect(delivery).toContain('dashboard-complete-route-button');
    expect(delivery).toContain('<RouteBottomTabs');
    expect(delivery).toContain('route-bottom-tabs');
    expect(delivery).toContain('maxWidth: layout.maxOperationalWidth');
    expect(delivery).toContain("dashboardGrid: { width: '100%', flexDirection: 'column-reverse'");
    expect(delivery).toContain("dashboardGridWide: { flexDirection: 'row-reverse'");
    expect(delivery).toContain('edgeToEdge');
    expect(delivery).toContain('showHeading={false}');
    expect(delivery).toContain('minHeight: 48');
    expect(delivery).toContain('routeMain: { flex: 1, minHeight: 0');
    expect(delivery).not.toContain('minHeight: 200');
    expect(delivery).toContain('gap: 14');
    const foundation = source('src/components/foundation-screen.tsx');
    expect(foundation).toContain('edgeScroll: { backgroundColor: colors.surface }');
    expect(delivery).toContain('Įtraukti sustojimą');
    expect(delivery).toContain('>Baigti maršrutą<');
  });

  it('uses the branded shell on the dashboard and route screens', () => {
    expect(source('src/app/index.tsx')).toContain('<BrandHeader onMenuPress={() => setAccountMenuOpen(true)} />');
    expect(source('src/app/_layout.tsx')).toContain('backgroundColor: colors.brandNavy');
    const header = source('src/components/brand-header.tsx');
    const brand = source('src/components/tsp-brand.tsx');
    expect(header).toContain('<TspBrand />');
    expect(brand).toContain("accessibilityLabel={descriptor ? `TSP – ${descriptor}` : 'TSP'}");
    expect(brand).toContain('react-native-svg');
    expect(brand).toContain('descriptor?: string');
    expect(header).not.toContain('brandName');
    expect(header).not.toContain('tsp-logo-mark.png');
    expect(header).not.toContain('TIKSLUS SIUNTŲ PRISTATYMAS<');
    expect(header).not.toContain('>TSP<');
  });
});
