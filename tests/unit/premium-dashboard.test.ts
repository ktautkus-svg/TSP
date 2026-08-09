import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, '../../', path), 'utf8');

describe('premium route dashboard', () => {
  it('renders realistic code-native instrument gauges driven by live values', () => {
    const gauge = source('src/components/instrument-gauge.tsx');
    // Clock-face scale: zero at 8 o'clock, full scale at 4 o'clock, and the
    // 120° wedge between them cut out of the dial to carry the readout.
    expect(gauge).toContain('const DIAL_MIN_ANGLE = 240');
    expect(gauge).toContain('const DIAL_SWEEP = 240');
    expect(gauge).toContain('const WEDGE_PATH');
    expect(gauge).toContain('d={WEDGE_PATH} fill="#000000"');
    expect(gauge).toContain('d={FACE_PATH}');
    // Needle climbs with what has been handed over; the digits count down.
    expect(gauge).toContain('const fraction = delivered / safeMaximum');
    expect(gauge).toContain('remaining ?? safeMaximum - delivered');
    expect(gauge).toContain('needleAngle');
    expect(gauge).toContain('LIKO');
    expect(gauge).toContain('stroke="url(#bezel)"');
    expect(gauge).toContain('stroke="url(#progress)"');
    expect(gauge).toContain('useGrouping: false');
    expect(gauge).toContain('fontFamily={fonts.headingExtraBold}');
    expect(gauge).toContain('fontSize={readoutFontSize}');
    expect(gauge).toContain('<SvgText');
    expect(gauge).not.toContain('READOUT_TOP');
    expect(gauge).not.toContain('isWeightGauge');
    expect(gauge).not.toContain('index !== 12');
    expect(gauge).not.toContain('styles.weightValue');
    expect(gauge).not.toContain('<Image');
    expect(gauge).not.toContain('formattedMaximum');
  });

  it('composes the realistic windshield and code-native steering progress arc', () => {
    const road = source('src/components/road-progress-bar.tsx');
    expect(road).toContain('route-windshield-day-v1.png');
    expect(road).toContain('resizeMode="cover"');
    expect(road).toContain('Math.round(clamped * 100)');
    expect(road).toContain('Animated.timing');
    expect(road).toContain('<Svg');
    expect(road).toContain('displayedProgress * ARC_LENGTH');
    expect(road).toContain('<Image');
    expect(road).not.toContain('<SvgImage');
    expect(road).not.toContain('PRISTATYMO EIGA');
    expect(road).toContain('stroke="#83D13D"');
    expect(road).toContain('GERO POILSIO!');
    expect(road).toContain('<WeatherOverlay');
  });

  it('matches the compact continuous dashboard while preserving route actions', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('<BrandHeader onMenuPress');
    expect(delivery).not.toContain('ŠIANDIENOS MARŠRUTAS');
    expect(delivery).toContain('<RoadProgressBar');
    expect(delivery.indexOf('<RoadProgressBar')).toBeLessThan(delivery.indexOf('<InstrumentGauge'));
    expect(delivery).toContain('<InstrumentGauge');
    // Needles climb with delivered totals while the wedge digits show the load
    // still on board, so both gauges are fed the pair of values.
    expect(delivery).toContain('value={progress.totalKnownWeightKg - progress.remainingKnownWeightKg}');
    expect(delivery).toContain('remaining={progress.remainingKnownWeightKg}');
    expect(delivery).toContain('unit="kg"');
    expect(delivery).toContain('value={progress.totalStops - progress.remainingStops}');
    expect(delivery).toContain('remaining={progress.remainingStops}');
    expect(delivery).toContain('styles.gaugeCenterStats');
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
    expect(delivery).toContain('maxWidth: 430');
    expect(delivery).toContain('edgeToEdge');
    expect(delivery).toContain('showHeading={false}');
    expect(delivery).toContain('minHeight: 48');
    expect(delivery).toContain('routeMain: { flex: 1, minHeight: 0');
    expect(delivery).not.toContain('minHeight: 200');
    expect(delivery).toContain("gap: 14");
    const foundation = source('src/components/foundation-screen.tsx');
    expect(foundation).toContain("edgeScroll: { backgroundColor: '#FFFFFF' }");
    expect(delivery).toContain('Įtraukti sustojimą');
    expect(delivery).toContain('>Baigti maršrutą<');
  });

  it('uses the branded shell on the dashboard and route screens', () => {
    expect(source('src/app/index.tsx')).toContain('<BrandHeader />');
    expect(source('src/app/_layout.tsx')).toContain("backgroundColor: '#072D1B'");
    const header = source('src/components/brand-header.tsx');
    expect(header).toContain('<Text style={styles.brandName}>TSP</Text>');
    expect(header).toContain('logoContainer');
    expect(header).toContain('maxHeight: 34');
    // A raster lockup turns to mush at header size and duplicates the wordmark.
    expect(header).not.toContain('<Image');
  });
});
