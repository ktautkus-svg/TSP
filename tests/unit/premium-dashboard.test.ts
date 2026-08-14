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
    expect(gauge).toContain('d={WEDGE_PATH} fill={cockpit.surfaceMuted}');
    expect(gauge).toContain('d={FACE_PATH}');
    // Needle climbs with what has been handed over; the digits count down.
    expect(gauge).toContain('const fraction = delivered / safeMaximum');
    expect(gauge).toContain('remaining ?? safeMaximum - delivered');
    expect(gauge).toContain('needleAngle');
    expect(gauge).toContain('const NEEDLE_TIP = 78');
    expect(gauge).toContain('id="needle"');
    expect(gauge).toContain('stopColor={cockpit.error}');
    expect(gauge).toContain('stroke={cockpit.errorSoft}');
    expect(gauge).toContain('id="redZone"');
    expect(gauge).toContain('stopColor={cockpit.routeBright}');
    expect(gauge).not.toContain('LIKO');
    expect(gauge).toContain('{unit}');
    expect(gauge).toContain('stroke="url(#bezel)"');
    expect(gauge).toContain('stroke="url(#progress)"');
    expect(gauge).toContain("import { stitchCockpitTheme } from '@/theme'");
    expect(gauge).toContain('useGrouping: false');
    expect(gauge).toContain('fontFamily={fonts.headingExtraBold}');
    expect(gauge).toContain('fontSize={readoutFontSize}');
    expect(gauge).toContain('<SvgText');
    expect(gauge).toContain('majors.slice(0, -1).map');
    expect(gauge).not.toContain('[FACE_START, FACE_END].map');
    expect(gauge).toContain('d={FACE_PATH} fill="url(#dial)" />');
    expect(gauge).not.toContain('READOUT_TOP');
    expect(gauge).not.toContain('isWeightGauge');
    expect(gauge).not.toContain('index !== 12');
    expect(gauge).not.toContain('styles.weightValue');
    expect(gauge).not.toContain('<Image');
    expect(gauge).not.toContain('formattedMaximum');
  });

  it('composes the realistic windshield and code-native steering progress arc', () => {
    const road = source('src/components/road-progress-bar.tsx');
    expect(road).toContain('route-scenes/clear-morning.png');
    expect(road).toContain('route-scenes/clear-midday.png');
    expect(road).toContain('route-scenes/clear-afternoon.png');
    expect(road).toContain('route-scenes/clear-evening.png');
    expect(road).toContain('route-scenes/clear-night.png');
    expect(road).toContain('route-scenes/rain.png');
    expect(road).toContain('route-scenes/snow.png');
    expect(road).toContain('route-scenes/fog.png');
    expect(road).toContain('route-scenes/storm.png');
    expect(road).toContain('resizeMode="cover"');
    expect(road).toContain('Math.round(clamped * 100)');
    expect(road).toContain('Animated.timing');
    expect(road).toContain('<Svg');
    expect(road).toContain('displayedProgress * ARC_LENGTH');
    expect(road).toContain('<Image');
    expect(road).not.toContain('<SvgImage');
    expect(road).not.toContain('PRISTATYMO EIGA');
    expect(road).toContain('stroke="url(#steeringProgress)"');
    expect(road).toContain('GERO POILSIO!');
    expect(road).toContain('setSceneClock(Date.now())');
    expect(road).toContain('if (hour >= 18 && hour < 21) return scenes.evening');
    expect(road).toContain('return scenes.night');
    expect(road).not.toContain('<WeatherOverlay');
    expect(road).not.toContain('<TimeOfDayOverlay');
    // Each state uses an exterior road image; no decorative celestial objects.
    expect(road).not.toContain('moonGlow');
  });

  it('matches the compact continuous dashboard while preserving route actions', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('<BrandHeader onMenuPress');
    expect(delivery).not.toContain('ŠIANDIENOS MARŠRUTAS');
    expect(delivery).toContain('<RoadProgressBar');
    expect(delivery.indexOf('<RoadProgressBar')).toBeLessThan(delivery.indexOf('<InstrumentGauge'));
    expect(delivery).toContain('<InstrumentGauge');
    // The instruments expose the two values agreed for the cockpit: remaining
    // cargo weight and remaining stops. Time and kilometres stay between them.
    expect(delivery).toContain('title="Svoris"');
    expect(delivery).toContain('maximum={progress.totalKnownWeightKg}');
    expect(delivery).toContain('remaining={progress.remainingKnownWeightKg}');
    expect(delivery).toContain('value={Math.max(0, progress.totalKnownWeightKg - progress.remainingKnownWeightKg)}');
    expect(delivery).toContain('title="Taškai"');
    expect(delivery).toContain('maximum={progress.totalStops}');
    expect(delivery).toContain('remaining={progress.remainingStops}');
    expect(delivery).toContain('LIKĘ KM');
    expect(delivery).toContain('formatMetric(progress.preliminaryRemainingDistanceKm)');
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
    expect(delivery).toContain('PRISTATYMAI UŽBAIGTI');
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
    expect(foundation).toContain('edgeScroll: { backgroundColor: colors.surface }');
    expect(delivery).toContain('Įtraukti sustojimą');
    expect(delivery).toContain('>Baigti maršrutą<');
  });

  it('uses the branded shell on the dashboard and route screens', () => {
    expect(source('src/app/index.tsx')).toContain('variant="driver"');
    expect(source('src/app/_layout.tsx')).toContain('backgroundColor: colors.surface');
    expect(source('src/app/_layout.tsx')).toContain('<StackBrandTitle title={children} />');
    const header = source('src/components/brand-header.tsx');
    const brand = source('src/components/tsp-brand.tsx');
    expect(header).toContain('<TspBrand inverse={false} />');
    expect(brand).toContain("accessibilityLabel={descriptor ? `TSP – ${descriptor}` : 'TSP'}");
    expect(brand).toContain('tsp-wordmark-red-blue.png');
    expect(brand).toContain('readonly descriptor?: string');
    expect(header).not.toContain('brandName');
    expect(header).not.toContain('tsp-logo-mark.png');
    expect(header).not.toContain('TIKSLUS SIUNTŲ PRISTATYMAS<');
    expect(header).not.toContain('>TSP<');
  });

  it('keeps sign-in focused and uses the transparent vector TSP wordmark', () => {
    const gate = source('src/components/local-access-gate.tsx');
    const brand = source('src/components/tsp-brand.tsx');
    expect(gate).toContain('<TspBrand hero inverse={bootstrap} />');
    expect(gate).toContain('PRISIJUNGIMO VARDAS');
    expect(gate).toContain('PIN KODAS');
    expect(gate).toContain("bootstrap ? 'Aktyvuoti ir tęsti' : 'PRISIJUNGTI →'");
    expect(gate).not.toContain('Darbuotojo prisijungimas');
    expect(gate).not.toContain('Darbo duomenys lieka SQLite');
    expect(brand).toContain('readonly hero?: boolean');
    expect(brand).toContain('<Image');
    expect(brand).toContain('tsp-wordmark-red-blue.png');
  });
});
