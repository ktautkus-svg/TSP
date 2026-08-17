import { describe, expect, it } from 'vitest';

import { evaluateCandidate } from '../evaluation/candidate-evaluator';
import { generateHeuristicSeeds } from '../heuristics/generators';
import { improveWithLocalSearch } from '../heuristics/local-search';
import type {
  MatrixCell,
  OptimizationStop,
  RouteCandidate,
  RouteOptimizationRequest,
  RoutingLocation,
  StopTimeWindow,
  TravelMatrix,
} from '../models';
import { cappedObjective, compareCandidates, normalizeAndScoreCandidates } from '../scoring/scoring';
import { createBaseRequest } from '../scenarios';

// Diagnostic regression suite: exercises the real domain pipeline
// (generateHeuristicSeeds -> improveWithLocalSearch -> scoring) against
// hand-built scenarios and prints what the algorithm actually decides.
// Some assertions encode what a driver would intuitively expect rather
// than a guaranteed property of the current objective function, so a
// failure here is a genuine finding about current behaviour, not a bug
// in the test.

function iso(hour: number, minute: number): string {
  return `2026-06-15T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

function windowAt(fromHour: number, fromMinute: number, toHour: number, toMinute: number): StopTimeWindow {
  return { from: iso(fromHour, fromMinute), to: iso(toHour, toMinute) };
}

function makeStop(
  id: string,
  location: RoutingLocation,
  requiredTimeWindow: StopTimeWindow | undefined,
  overrides: Partial<OptimizationStop> = {},
): OptimizationStop {
  return {
    id,
    location,
    weightKg: 0,
    serviceDurationMinutes: 5,
    requiredTimeWindow,
    priority: 0,
    lockedPosition: undefined,
    deliverBeforeStopIds: [],
    deliverAfterStopIds: [],
    preferEarly: false,
    preferLate: false,
    mustBeFirst: false,
    mustBeLast: false,
    ...overrides,
  };
}

// Places every node on one real east-west line so evaluateDirectionality's
// axis-projection backtracking check (which reads real lat/lon, not the
// matrix) reacts the same way a human looking at a map would.
const LINE_LATITUDE = 54.68;
const LINE_BASE_LONGITUDE = 25.28;
const KM_PER_DEGREE_LON = 111.32 * Math.cos((LINE_LATITUDE * Math.PI) / 180);

function lineLocation(id: string, label: string, eastKm: number): RoutingLocation {
  return {
    id,
    label,
    latitude: LINE_LATITUDE,
    longitude: LINE_BASE_LONGITUDE + eastKm / KM_PER_DEGREE_LON,
  };
}

function cell(distanceKm: number, durationMinutes: number): MatrixCell {
  return { distanceKm, durationMinutes, reachable: true, maneuverPenalty: 0, restrictionWarnings: [] };
}

// A flat 1 km == 1 min matrix (60 km/h everywhere) built from straight-line
// offsets, so every printed number stays exact and easy to check by hand.
function buildLineMatrix(nodeOffsetsKm: Record<string, number>): TravelMatrix {
  const nodeIds = Object.keys(nodeOffsetsKm);
  const cells = nodeIds.map((from) =>
    nodeIds.map((to) => {
      const distanceKm = Math.abs(nodeOffsetsKm[from] - nodeOffsetsKm[to]);
      return cell(distanceKm, distanceKm);
    }),
  );
  return {
    provider: 'test-line-matrix',
    executionMode: 'synthetic',
    nodeIds,
    cells,
    fetchedAt: new Date().toISOString(),
    trafficMode: 'none',
    departureAt: iso(6, 0),
    warnings: [],
    version: 'test-v1',
  };
}

function buildBaseRequest(
  stops: OptimizationStop[],
  startLocation: RoutingLocation,
  endLocation: RoutingLocation,
): RouteOptimizationRequest {
  const request = createBaseRequest(1);
  request.stops = stops;
  request.startLocation = startLocation;
  request.endLocation = endLocation;
  request.vehicle.startLocation = startLocation;
  request.vehicle.defaultEndLocation = endLocation;
  request.plannedDepartureAt = iso(6, 0);
  request.workdayEndAt = iso(23, 0);
  // Tiny (3-4 stop) instances: give local search room to actually converge
  // instead of stopping early on the default production budget.
  request.maxIterations = 25;
  request.maxCalculationMs = 3_000;
  return request;
}

// Mirrors RoutingEngine.optimize's core (seed -> local search -> score ->
// rank) without the application-layer explanation/alternative-selection
// logic, which is out of scope for a domain-level regression test.
function findBestCandidate(request: RouteOptimizationRequest, matrix: TravelMatrix): RouteCandidate {
  const seeds = generateHeuristicSeeds(request, matrix);
  const improved = seeds.map((seed) =>
    improveWithLocalSearch({ sequence: seed.sequence, generatedBy: seed.generatedBy, request, matrix }),
  );
  const scored = normalizeAndScoreCandidates(improved, request.scoring).sort((a, b) =>
    compareCandidates(a, b, request.scoring),
  );
  return scored.find((candidate) => candidate.feasible) ?? scored[0];
}

function printCandidate(label: string, candidate: RouteCandidate, request: RouteOptimizationRequest): void {
  const objective = cappedObjective(candidate.rawScoreComponents, request.scoring);
  // eslint-disable-next-line no-console
  console.log(
    [
      `\n[${label}]`,
      `  Tvarka: ${candidate.stopSequence.join(' -> ')}`,
      `  Bendras darbo laikas: ${candidate.totalWorkMinutes.toFixed(1)} min`,
      `  Laukimo laikas: ${candidate.waitingMinutes.toFixed(1)} min`,
      `  Vėlavimas: ${candidate.totalLateMinutes.toFixed(1)} min`,
      `  Atstumas: ${candidate.totalDistanceKm.toFixed(2)} km`,
      `  cappedObjective: ${objective.toFixed(4)}`,
    ].join('\n'),
  );
}

describe('Maršruto optimizavimo scenarijų regresija', () => {
  it('1. Trys taškai vienoje tiesėje su skirtingais laiko langais renkasi geografinę, ne EDD tvarką', () => {
    const start = lineLocation('start', 'Sandėlis', 0);
    const stopA = lineLocation('stop-a', 'Taškas A', 10);
    const stopB = lineLocation('stop-b', 'Taškas B', 20);
    const stopC = lineLocation('stop-c', 'Taškas C', 30);
    const end = lineLocation('end', 'Galutinis taškas', 40);

    const stops = [
      makeStop('stop-a', stopA, windowAt(6, 0, 8, 0)),
      makeStop('stop-b', stopB, windowAt(6, 0, 11, 0)),
      makeStop('stop-c', stopC, windowAt(6, 0, 7, 0)),
    ];
    const request = buildBaseRequest(stops, start, end);
    const matrix = buildLineMatrix({ start: 0, 'stop-a': 10, 'stop-b': 20, 'stop-c': 30, end: 40 });

    const best = findBestCandidate(request, matrix);
    printCandidate('Scenarijus 1: A(6-8) B(6-11) C(6-7) tiesėje', best, request);

    expect(best.stopSequence).toEqual(['stop-a', 'stop-b', 'stop-c']);
  });

  // Originally this asserted the priority stop must NOT come first, on the
  // intuition that the driver should use the wait to deliver something else.
  // Measured on this geometry that intuition is wrong, and expensively so —
  // every stop sits on one line running away from the depot, so serving the
  // others first means driving back:
  //
  //   stop-p first            50 km   120 min   (50 min waiting)
  //   ordinary stops first   110 km   165 min   (35 min waiting)
  //   stop-p third            90 km   170 min   (60 min waiting)
  //
  // Avoiding 50 minutes of waiting costs 60 extra kilometres and finishes the
  // day 45 minutes later. That is precisely the backtracking the weights exist
  // to prevent, so the assertion now checks what actually matters: the late
  // window must not drag the route backwards, and the plan must own up to both
  // the later departure and the waiting that is left.
  it('2. Prioritetinis taškas su vėlyvu langu nesuka maršruto atgal ir laukimas lieka apskaitytas', () => {
    const start = lineLocation('start', 'Sandėlis', 0);
    const priority = lineLocation('stop-p', 'Prioritetinis taškas', 10);
    const ordinary1 = lineLocation('stop-o1', 'Paprastas taškas 1', 20);
    const ordinary2 = lineLocation('stop-o2', 'Paprastas taškas 2', 30);
    const ordinary3 = lineLocation('stop-o3', 'Paprastas taškas 3', 40);
    const end = lineLocation('end', 'Galutinis taškas', 50);

    const stops = [
      makeStop('stop-p', priority, windowAt(8, 0, 12, 0)),
      makeStop('stop-o1', ordinary1, windowAt(6, 0, 10, 0)),
      makeStop('stop-o2', ordinary2, windowAt(6, 0, 10, 0)),
      makeStop('stop-o3', ordinary3, windowAt(6, 0, 10, 0)),
    ];
    const request = buildBaseRequest(stops, start, end);
    const matrix = buildLineMatrix({
      start: 0,
      'stop-p': 10,
      'stop-o1': 20,
      'stop-o2': 30,
      'stop-o3': 40,
      end: 50,
    });

    const best = findBestCandidate(request, matrix);
    printCandidate('Scenarijus 2: prioritetinis taškas (8-12) + 3 paprasti (6-10)', best, request);

    // Geography wins: the run stays a straight line out from the depot.
    expect(best.stopSequence).toEqual(['stop-p', 'stop-o1', 'stop-o2', 'stop-o3']);
    expect(best.totalDistanceKm).toBe(50);
    expect(best.directionalityPenalty).toBe(0);

    // The wait is absorbed by leaving later, up to the tolerance, and the rest
    // stays visible instead of being quietly deleted from the objective.
    const tolerance = request.scoring.tolerances.maxDepartureShiftMinutes;
    expect(best.departureShiftMinutes).toBe(tolerance);
    expect(best.effectiveDepartureAt).toBe(iso(7, 0));
    expect(best.waitingMinutes).toBe(50);
    expect(best.totalWorkMinutes).toBe(120);
  });

  it('3. Šiek tiek pavėluoti pigiau nei 45 km papildomo kelio', () => {
    const start = lineLocation('start', 'Sandėlis', 0);
    const stopD = lineLocation('stop-d', 'Taškas D', 20);
    const end = lineLocation('end', 'Galutinis taškas', 40);

    const stops = [makeStop('stop-d', stopD, windowAt(6, 0, 8, 0))];
    const request = buildBaseRequest(stops, start, end);

    const nodeIds = [start.id, stopD.id, end.id];
    // Variantas (a): tiesus, greitesnis kelias, bet pavėluojama 8 min
    // (atvyksta 08:08, langas užsidaro 08:00).
    const toStopLateArrival = cell(90, 128);
    // Variantas (b): 45 km ilgesnis kelias tam pačiam taškui, bet spėjama
    // laiku (atvyksta 07:58).
    const toStopOnTime = cell(90 + 45, 118);
    const fromStop = cell(10, 10);

    const matrixA: TravelMatrix = {
      provider: 'test-two-leg-matrix',
      executionMode: 'synthetic',
      nodeIds,
      cells: [
        [cell(0, 0), toStopLateArrival, cell(100, 138)],
        [toStopLateArrival, cell(0, 0), fromStop],
        [cell(100, 138), fromStop, cell(0, 0)],
      ],
      fetchedAt: new Date().toISOString(),
      trafficMode: 'none',
      departureAt: iso(6, 0),
      warnings: [],
      version: 'test-v1',
    };
    const matrixB: TravelMatrix = {
      ...matrixA,
      cells: [
        [cell(0, 0), toStopOnTime, cell(145, 128)],
        [toStopOnTime, cell(0, 0), fromStop],
        [cell(145, 128), fromStop, cell(0, 0)],
      ],
    };

    const candidateA = evaluateCandidate({
      stopSequence: ['stop-d'],
      generatedBy: ['variant-a-8min-late'],
      request,
      matrix: matrixA,
    });
    const candidateB = evaluateCandidate({
      stopSequence: ['stop-d'],
      generatedBy: ['variant-b-45km-detour'],
      request,
      matrix: matrixB,
    });

    printCandidate('Variantas (a): 8 min vėlavimas, be aplinkkelio', candidateA, request);
    printCandidate('Variantas (b): 45 km ilgesnis kelias, be vėlavimo', candidateB, request);
    // eslint-disable-next-line no-console
    console.log(
      `\n  criticalRank (a): ${JSON.stringify(candidateA.criticalRank)}` +
        `\n  criticalRank (b): ${JSON.stringify(candidateB.criticalRank)}`,
    );

    // compareCandidates is what the real optimizer uses to pick a winner:
    // negative means A ranks ahead of (is chosen over) B.
    expect(compareCandidates(candidateA, candidateB, request.scoring)).toBeLessThan(0);
  });
});
