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
