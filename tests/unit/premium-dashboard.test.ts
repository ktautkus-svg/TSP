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
    // Still the approved cockpit palette from '@/theme', but resolved per colour
    // scheme so the gauge is readable in dark mode instead of being locked light.
    expect(gauge).toContain("import { cockpitColorsFor } from '@/theme'");
    expect(gauge).toContain('const cockpit = cockpitColorsFor(scheme)');
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

  it('composes the changing front-windshield scene and code-native steering progress arc', () => {
    const road = source('src/components/road-progress-bar.tsx');
    expect(road).toContain('Math.round(clamped * 100)');
    expect(road).toContain('Animated.timing');
    expect(road).toContain('<Svg');
    expect(road).toContain('displayedProgress * ARC_LENGTH');
    expect(road).toContain('stitch-windshield-01.png');
    expect(road).toContain('stitch-windshield-11.png');
    expect(road).toContain('resizeMode="cover"');
    expect(road).not.toContain('PRISTATYMO EIGA');
    expect(road).toContain('stroke="url(#steeringProgress)"');
    expect(road).toContain('GERO POILSIO!');
    expect(road).toContain('setSceneClock(Date.now())');
    expect(road).toContain('testID="route-front-windshield"');
    expect(road).toContain('styles.windshieldShell');
    expect(road).toContain('styles.windshieldPillarLeft');
    expect(road).toContain('styles.windshieldPillarRight');
    expect(road).toContain('styles.cockpitCowl');
    expect(road).toContain('M 0 96 Q 215 30 430 96');
    expect(road).not.toContain('<G transform="translate(215 98)">');
    expect(road).toContain('styles.progressReadout');
    expect(road).not.toContain('styles.instrumentBridge');
    expect(road).toContain('28_000');
    expect(road).toContain('setDisplayedSceneKey(selectedSceneKey)');
    expect(road).toContain("if (scene?.condition === 'storm') return ['storm', 'rain']");
    expect(road).not.toContain("scene?.condition === 'storm' || scene?.condition === 'cloudy'");
    expect(road).toContain("if (hour >= 18 && hour < 21) return ['sunset', 'nightTown', 'nightCity']");
    expect(road).toContain("return ['nightHighway', 'nightTown', 'nightCity']");
    expect(road).not.toContain('<WeatherOverlay');
    expect(road).not.toContain('<TimeOfDayOverlay');
    // Each state uses a forward windshield image; no decorative celestial objects.
    expect(road).not.toContain('moonGlow');
  });

  it('matches the compact continuous dashboard while preserving route actions', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('onMenuPress={() => setMenuOpen(true)}');
    expect(delivery).not.toContain('ŠIANDIENOS MARŠRUTAS');
    expect(delivery).toContain('<RoadProgressBar');
    expect(delivery).toContain('calculateCompositeRouteProgress');
    expect(delivery).toContain('breakdown={compositeProgress ?? undefined}');
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
    expect(delivery).toContain('RIDA');
    expect(delivery).toContain('formatMetric(progress.completedPlannedDistanceKm)');
    expect(delivery).toContain('elapsedLabel(route?.startedAt ?? null, route?.returnArrivedAt ?? null)');
    expect(delivery).toContain('completed={Boolean(route?.returnArrivedAt)}');
    expect(delivery).toContain('Visi pristatymai užbaigti');
    expect(delivery).toContain('styles.gaugeCenterStats');
    expect(delivery).toContain('IKI KM');
    expect(delivery).toContain('IKI MIN');
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
    expect(header).toContain('showNotifications = false');
    expect(source('src/components/driver-now-dashboard.tsx')).toContain('maxWidth: 900');
    expect(source('src/app/history/[id].tsx')).toContain('maxWidth: 900');
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
