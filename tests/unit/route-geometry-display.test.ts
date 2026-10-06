import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('FIRO real road geometry display', () => {
  const alternatives = source('src/app/route/[id]/alternatives.tsx');
  const overview = source('src/app/route/[id]/overview.tsx');
  const driverNow = source('src/components/driver-now-dashboard.tsx');
  const mapNative = source('src/components/route-map.tsx');
  const mapWeb = source('src/components/route-map.web.tsx');
  const engine = source('src/application/routing/routing-engine.ts');

  it('auto-loads Google road geometry for the selected planning variant', () => {
    expect(alternatives).toContain('const [showPolyline, setShowPolyline] = useState(true)');
    expect(alternatives).toContain('new GatewayPolylineProvider()');
    expect(alternatives).toContain('.fetchPolyline({ ...locations, departureAt: request.plannedDepartureAt, trafficMode: \'live\' })');
    expect(alternatives).toContain('allowStraightLineFallback={false}');
    expect(alternatives).toContain('expectPolyline');
    expect(alternatives).toContain('encodedPolyline={polylineResult?.encodedPolyline}');
    expect(alternatives).toContain("setPolylineError('Gateway negrąžino maršruto linijos.')");
    // Manual sequencing must not keep the planning-map paid fetch alive.
    expect(alternatives).toContain('if (!showPolyline || manualMode || !selectedCandidate || !request) return () => undefined;');
  });

  it('invalidates and reloads geometry when stop order changes', () => {
    // Planning: candidate change clears then refetches via effect deps.
    expect(alternatives).toContain('setPolylineResult(null)');
    expect(alternatives).toContain('[manualMode, polylineAttempt, request, selectedCandidate, showPolyline]');
    // Retry bumps attempt counter instead of spawning an uncancellable loop.
    expect(alternatives).toContain('setPolylineAttempt((attempt) => attempt + 1)');

    // Manual edit: drop the previous road line immediately; never sketch straight joins.
    expect(alternatives).toContain('setManualPolyline(null)');
    expect(alternatives).toContain('but never join them with a misleading straight line');
    expect(alternatives).toContain('encodedPolyline={manualPolyline?.encodedPolyline}');
    expect(alternatives).toContain('fetchManualDrivingPolyline');
    expect(alternatives).toContain(
      'expectPolyline={manualRecalculating || Boolean(manualPolyline || manualPolylineError)}',
    );

    // Active-route reorder: debounce paid polyline so drag bursts do not loop requests.
    expect(overview).toContain('setOrderPolyline(null)');
    expect(overview).toContain('new GatewayPolylineProvider().fetchPolyline');
    expect(overview).toContain('}, 600)');
    expect(overview).toContain('clearTimeout(timer)');
    expect(overview).toContain('[editingOrder, orderMap, route?.plannedDepartureAt]');
    expect(overview).toContain('allowStraightLineFallback={false}');
    expect(overview).toContain('encodedPolyline={orderPolyline?.encodedPolyline}');
    expect(overview).toContain("setOrderPolylineError('Gateway negrąžino maršruto linijos.')");
  });

  it('does not present straight-line fallback as a driven route on planning, manual, or driver maps', () => {
    expect(mapNative).toContain('allowStraightLineFallback = false');
    expect(mapWeb).toContain('allowStraightLineFallback = false');
    // Without a real polyline and with fallback off, maps must draw zero route points
    // (pins only) — never a stop-to-stop straight sketch as if it were the road.
    expect(mapWeb).toContain('? [startLocation, ...orderedStops, endLocation]');
    expect(mapWeb).toMatch(/allowStraightLineFallback[\s\S]{0,80}\? \[startLocation, \.\.\.orderedStops, endLocation\][\s\S]{0,40}: \[\]/);
    expect(mapNative).toContain('? [startLocation, ...orderedStops, endLocation]');
    expect(mapNative).toContain('Sintetinė schema jungia taškus tiesiomis linijomis');
    expect(alternatives).toMatch(/allowStraightLineFallback=\{false\}/g);
    expect(overview).toContain('allowStraightLineFallback={false}');
    expect(driverNow).toContain('allowStraightLineFallback={false}');
    expect(driverNow).toContain('expectPolyline={false}');
    expect(driverNow).not.toContain('GatewayPolylineProvider');
    expect(driverNow).not.toMatch(/allowStraightLineFallback(?!\s*=\s*\{false\})/);
  });

  it('keeps optimization on the travel-cost matrix provider (unchanged road-matrix path)', () => {
    expect(engine).toContain('const matrix = matrixOverride ?? await this.travelCostProvider.getMatrix({');
    expect(engine).toContain('improveWithLocalSearch({');
    expect(engine).toContain('matrix,');
    expect(engine).not.toContain('haversineKm');
  });
});
