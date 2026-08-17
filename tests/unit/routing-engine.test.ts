import { describe, expect, it } from 'vitest';

import { evaluateManualRoute } from '../../src/application/routing/manual-route-evaluator';
import { recalculateRemainingRoute } from '../../src/application/routing/recalculate-route';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { evaluateCandidate } from '../../src/domain/routing/evaluation/candidate-evaluator';
import { evaluateDirectionality } from '../../src/domain/routing/evaluation/directionality';
import { generateHeuristicSeeds } from '../../src/domain/routing/heuristics/generators';
import {
  createBaseRequest,
  routingScenarios,
} from '../../src/domain/routing/scenarios';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

describe('Routing Engine v0.1', () => {
  it('generates at least eight heuristic families, preserves stop invariants and is deterministic', async () => {
    const request = createBaseRequest(8);
    const provider = new SyntheticTravelCostProvider('linear');
    const matrix = await provider.getMatrix({
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: request.trafficMode,
      timeoutMs: 1_000,
    });
    const first = generateHeuristicSeeds(request, matrix);
    const second = generateHeuristicSeeds(request, matrix);
    expect(new Set(first.map((seed) => seed.generatedBy)).size).toBeGreaterThanOrEqual(8);
    expect(first.map((seed) => seed.generatedBy)).toEqual(
      expect.arrayContaining([
        'nearest_neighbor',
        'farthest_first',
        'heaviest_first',
        'earliest_required_window_first',
        'end_location_guided',
        'directional_sweep',
        'cluster_then_route',
        'random_seeded:7',
      ]),
    );
    expect(first).toEqual(second);
    const expected = request.stops.map((stop) => stop.id).sort();
    for (const seed of first) expect([...seed.sequence].sort()).toEqual(expected);
  });

  it('deduplicates equal sequences while preserving generatedBy provenance', async () => {
    const request = createBaseRequest(1);
    const result = await new RoutingEngine(
      new SyntheticTravelCostProvider('linear'),
    ).optimize(request);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].generatedBy.length).toBeGreaterThanOrEqual(8);
  });

  it('returns the same ranked sequences for the same request and seeds', async () => {
    const request = createBaseRequest(10);
    const engine = new RoutingEngine(new SyntheticTravelCostProvider('asymmetric'));
    const first = await engine.optimize(request);
    const second = await engine.optimize(request);
    const comparable = (result: typeof first) =>
      result.candidates.map((candidate) => ({
        sequence: candidate.stopSequence,
        generatedBy: candidate.generatedBy,
        raw: candidate.rawScoreComponents,
        feasible: candidate.feasible,
      }));
    expect(comparable(first)).toEqual(comparable(second));
  });

  it('honours locked positions and produces evidence-based explanations', async () => {
    const request = createBaseRequest(8);
    request.stops[2].lockedPosition = 3;
    request.stops[0].requiredTimeWindow = {
      from: '2026-06-15T07:00:00.000Z',
      to: '2026-06-15T12:00:00.000Z',
    };
    const result = await new RoutingEngine(
      new SyntheticTravelCostProvider('city_traffic'),
    ).optimize(request);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.stopSequence[2]).toBe(request.stops[2].id);
    expect(result.recommended!.explanations.every((item) => item.dataSource.length > 0)).toBe(true);
  });

  it('treats an unreachable required time window as a soft warning, not a hard block', async () => {
    const scenario = routingScenarios.find((item) => item.id === 'impossible-window')!;
    const result = await new RoutingEngine(
      new SyntheticTravelCostProvider('linear'),
    ).optimize(scenario.request);
    expect(result.feasibleRouteFound).toBe(true);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.violations.some(
      (violation) => violation.code === 'REQUIRED_TIME_WINDOW' && violation.type === 'soft',
    )).toBe(true);
  });

  it('evaluates manual changes and recalculates only remaining stops', async () => {
    const request = createBaseRequest(5);
    const provider = new SyntheticTravelCostProvider('linear');
    const engine = new RoutingEngine(provider);
    const initial = await engine.optimize(request);
    const baseline = initial.recommended!;
    const matrix = await provider.getMatrix({
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: request.trafficMode,
      timeoutMs: 1_000,
    });
    const manual = evaluateManualRoute({
      stopSequence: [...baseline.stopSequence].reverse(),
      baseline,
      request,
      matrix,
    });
    expect(manual.candidate.generatedBy).toContain('manual_edit');
    expect(Number.isFinite(manual.distanceDeltaKm)).toBe(true);

    const completedId = baseline.stopSequence[0];
    const recalculated = await recalculateRemainingRoute(engine, {
      originalRequest: request,
      completedStopIds: [completedId],
      currentLocation: request.stops.find((stop) => stop.id === completedId)!.location,
      currentTime: '2026-06-15T09:00:00.000Z',
      remainingLoadKg: request.stops
        .filter((stop) => stop.id !== completedId)
        .reduce((sum, stop) => sum + (stop.weightKg ?? 0), 0),
      previousRemainingCandidate: baseline,
    });
    expect(recalculated.preservedCompletedStopIds).toEqual([completedId]);
    expect(recalculated.optimization.recommended?.stopSequence).not.toContain(completedId);
  });

  it('marks unreachable matrix legs as hard violations', async () => {
    const request = createBaseRequest(2);
    const provider = new SyntheticTravelCostProvider('linear');
    const matrix = await provider.getMatrix({
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: request.trafficMode,
      timeoutMs: 1_000,
    });
    matrix.cells[0][1] = {
      distanceKm: null,
      durationMinutes: null,
      reachable: false,
      maneuverPenalty: 0,
      restrictionWarnings: ['closed'],
    };
    const candidate = evaluateCandidate({
      stopSequence: request.stops.map((stop) => stop.id),
      generatedBy: ['test'],
      request,
      matrix,
    });
    expect(candidate.feasible).toBe(false);
    expect(candidate.violations.some((violation) => violation.code === 'UNREACHABLE_LEG')).toBe(true);
  });

  it('treats required windows as informational when planning mode ignores them', async () => {
    const request = createBaseRequest(2);
    request.planningMode = 'ignore_time_windows';
    request.stops[0].requiredTimeWindow = {
      from: '2026-06-15T06:00:00.000Z',
      to: '2026-06-15T06:01:00.000Z',
    };
    const result = await new RoutingEngine(
      new SyntheticTravelCostProvider('linear'),
    ).optimize(request);
    expect(result.feasibleRouteFound).toBe(true);
  });

  it('penalizes a zigzag sequence more than a directional sequence', () => {
    const request = createBaseRequest(4);
    request.endLocation = {
      id: 'east',
      label: 'East',
      latitude: request.startLocation.latitude,
      longitude: request.startLocation.longitude + 0.2,
    };
    const coordinates = [
      [0.04, 0.03],
      [-0.04, 0.07],
      [-0.04, 0.03],
      [0.04, 0.07],
    ];
    request.stops.forEach((stop, index) => {
      stop.location.latitude = request.startLocation.latitude + coordinates[index][0];
      stop.location.longitude = request.startLocation.longitude + coordinates[index][1];
    });
    const zigzag = evaluateDirectionality(
      request.stops.map((stop) => stop.id),
      request,
    );
    const directional = evaluateDirectionality(
      [request.stops[2].id, request.stops[0].id, request.stops[3].id, request.stops[1].id],
      request,
    );
    expect(zigzag.penalty).toBeGreaterThan(directional.penalty);
  });
});

// Reproduces the real complaint: a town's worth of stops that all share one
// broad delivery window used to be sequenced by clock alone, so the driver was
// sent bouncing between opposite ends of the city.
describe('time-window planning stays geographically sane', () => {
  const WINDOW = { from: '2026-06-15T05:00:00.000Z', to: '2026-06-15T13:00:00.000Z' };
  const NORTH = { latitude: 55.98, longitude: 23.34 };
  const SOUTH_WEST = { latitude: 55.88, longitude: 23.22 };

  function twoClusterRequest(stopCount = 10) {
    const request = createBaseRequest(stopCount);
    request.planningMode = 'with_time_windows';
    request.startLocation = { id: 'start', label: 'Bazė', latitude: 55.9333, longitude: 23.3167 };
    request.endLocation = { id: 'end', label: 'Namai', latitude: 55.9333, longitude: 23.3167 };
    request.vehicle.startLocation = request.startLocation;
    request.vehicle.defaultEndLocation = request.endLocation;
    // Clusters are interleaved by index so the untouched order is a worst-case
    // zigzag: any sane result has to actively regroup them.
    request.stops.forEach((stop, index) => {
      const anchor = index % 2 === 0 ? NORTH : SOUTH_WEST;
      stop.location = {
        ...stop.location,
        latitude: anchor.latitude + index * 0.002,
        longitude: anchor.longitude + index * 0.002,
      };
      stop.requiredTimeWindow = { ...WINDOW };
    });
    return request;
  }

  const clusterOf = (id: string, request: ReturnType<typeof twoClusterRequest>) => {
    const stop = request.stops.find((item) => item.id === id)!;
    return stop.location.longitude > 23.28 ? 'north' : 'south_west';
  };

  const clusterSwitches = (sequence: string[], request: ReturnType<typeof twoClusterRequest>) =>
    sequence.reduce((count, id, index) => (
      index > 0 && clusterOf(id, request) !== clusterOf(sequence[index - 1], request) ? count + 1 : count
    ), 0);

  it('groups equally-timed stops by area instead of sorting them by the clock', async () => {
    const request = twoClusterRequest();
    const matrix = await new SyntheticTravelCostProvider('linear').getMatrix({
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: request.trafficMode,
      timeoutMs: 1_000,
    });
    const seeds = generateHeuristicSeeds(request, matrix);
    const windowSeed = seeds.find((seed) => seed.generatedBy === 'earliest_required_window_first')!;
    expect(clusterSwitches(windowSeed.sequence, request)).toBeLessThanOrEqual(1);
    expect(seeds.map((seed) => seed.generatedBy)).toContain('window_aware_nearest_neighbor');
  });

  it('recommends a route that finishes one area before driving to the other', async () => {
    const request = twoClusterRequest();
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    expect(result.recommended).not.toBeNull();
    expect(clusterSwitches(result.recommended!.stopSequence, request)).toBeLessThanOrEqual(2);
  });

  it('still starts with the stop whose window opens first', async () => {
    const request = twoClusterRequest(6);
    const early = request.stops[3]!;
    early.requiredTimeWindow = { from: '2026-06-15T05:00:00.000Z', to: '2026-06-15T06:30:00.000Z' };
    for (const stop of request.stops) {
      if (stop.id !== early.id) {
        stop.requiredTimeWindow = { from: '2026-06-15T09:00:00.000Z', to: '2026-06-15T15:00:00.000Z' };
      }
    }
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    expect(result.recommended!.stopSequence[0]).toBe(early.id);
  });

  it('waits for a late-opening door instead of buying kilometres to burn the clock', async () => {
    // Leaving well before the windows open used to make waiting look more
    // expensive per minute than driving, so the engine drove laps around town.
    const request = twoClusterRequest();
    request.plannedDepartureAt = '2026-06-15T03:00:00.000Z';
    for (const stop of request.stops) {
      stop.requiredTimeWindow = { from: '2026-06-15T07:00:00.000Z', to: '2026-06-15T15:00:00.000Z' };
    }
    const engine = new RoutingEngine(new SyntheticTravelCostProvider('linear'));
    const timed = await engine.optimize(request);
    const untimed = await engine.optimize({ ...request, planningMode: 'ignore_time_windows' });
    const timedKm = timed.recommended!.totalDistanceKm;
    const untimedKm = untimed.recommended!.totalDistanceKm;
    expect(timedKm).toBeLessThanOrEqual(untimedKm * 1.05);
    // Idle time before the first door opens is absorbed by leaving the depot
    // later, but only up to maxDepartureShiftMinutes. Departing 4 hours before
    // the windows open is past that, so the rest stays on the books as real
    // kerbside waiting rather than silently vanishing from the objective.
    const shift = timed.recommended!.departureShiftMinutes;
    expect(shift).toBe(request.scoring.tolerances.maxDepartureShiftMinutes);
    expect(Date.parse(timed.recommended!.effectiveDepartureAt)).toBe(
      Date.parse(request.plannedDepartureAt) + shift * 60_000,
    );
    // The recorded departure and the first leg agree, so the driver is told the
    // hour he actually has to leave.
    expect(timed.recommended!.legs[0]!.departureAt).toBe(
      timed.recommended!.effectiveDepartureAt,
    );
    expect(timed.recommended!.schedules[0]!.waitingMinutes).toBeGreaterThan(0);
  });

  it('does not charge an early arrival twice as waiting and as a window mismatch', async () => {
    const request = twoClusterRequest(4);
    request.plannedDepartureAt = '2026-06-15T03:00:00.000Z';
    for (const stop of request.stops) {
      stop.requiredTimeWindow = { from: '2026-06-15T07:00:00.000Z', to: '2026-06-15T15:00:00.000Z' };
      stop.informationalTimeWindow = stop.requiredTimeWindow;
    }
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    expect(result.recommended!.rawScoreComponents.informationalTimeMismatch).toBe(0);
  });

  it('still waits mid-route when a later stop opens after the truck arrives', async () => {
    const request = twoClusterRequest(2);
    request.plannedDepartureAt = '2026-06-15T07:00:00.000Z';
    const [first, second] = request.stops;
    first!.requiredTimeWindow = { from: '2026-06-15T07:00:00.000Z', to: '2026-06-15T09:00:00.000Z' };
    second!.requiredTimeWindow = { from: '2026-06-15T12:00:00.000Z', to: '2026-06-15T16:00:00.000Z' };
    const matrix = await new SyntheticTravelCostProvider('linear').getMatrix({
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: 'live',
      timeoutMs: 1_000,
    });
    const { evaluateCandidate } = await import('../../src/domain/routing/evaluation/candidate-evaluator');
    const candidate = evaluateCandidate({
      stopSequence: [first!.id, second!.id],
      generatedBy: ['fixture'],
      request,
      matrix,
    });
    expect(candidate.schedules[0]!.waitingMinutes).toBe(0);
    expect(candidate.schedules[1]!.waitingMinutes).toBeGreaterThan(60);
  });

  it('never blocks a route just because a window cannot be met', async () => {
    const request = twoClusterRequest(6);
    request.stops[2]!.requiredTimeWindow = {
      from: '2026-06-15T05:00:00.000Z',
      to: '2026-06-15T05:01:00.000Z',
    };
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    expect(result.feasibleRouteFound).toBe(true);
    expect(result.recommended!.stopSequence).toHaveLength(6);
  });
});
