import { describe, expect, it } from 'vitest';

import {
  ROUTE_ALTERNATIVE_LABELS,
  ROUTE_ALTERNATIVE_MODES,
  buildRouteAlternatives,
  requestForPlanningMode,
  selectRouteAlternatives,
} from '../../src/application/routing/route-alternative-modes';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { createBaseRequest } from '../../src/domain/routing/scenarios';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MatrixRequest, MatrixCell, TravelCostProvider, TravelMatrix } from '../../src/domain/routing/models';

describe('route alternatives', () => {
  it('optimizes fastest and shortest independently when travel time and distance conflict', async () => {
    class TradeoffProvider implements TravelCostProvider {
      readonly name = 'synthetic:time-distance-tradeoff';
      matrixRequests = 0;

      async getMatrix(input: MatrixRequest): Promise<TravelMatrix> {
        this.matrixRequests += 1;
        const routes = new Map([
          ['warehouse>stop-1', [1, 60]],
          ['stop-1>stop-2', [1, 5]],
          ['stop-2>home', [1, 5]],
          ['warehouse>stop-2', [10, 5]],
          ['stop-2>stop-1', [10, 5]],
          ['stop-1>home', [10, 5]],
        ]);
        const cells = input.locations.map((from) => input.locations.map((to): MatrixCell => {
          if (from.id === to.id) {
            return { distanceKm: 0, durationMinutes: 0, reachable: true, maneuverPenalty: 0, restrictionWarnings: [] };
          }
          const cost = routes.get(`${from.id}>${to.id}`) ?? [20, 15];
          return { distanceKm: cost[0]!, durationMinutes: cost[1]!, reachable: true, maneuverPenalty: 0, restrictionWarnings: [] };
        }));
        return {
          provider: this.name,
          executionMode: 'synthetic',
          nodeIds: input.locations.map((location) => location.id),
          cells,
          fetchedAt: '2026-06-15T07:00:00.000Z',
          trafficMode: input.trafficMode,
          departureAt: input.departureAt,
          warnings: [],
          version: 'tradeoff-v1',
        };
      }
    }

    const request = createBaseRequest(2);
    request.maxIterations = 8;
    request.maxCalculationMs = 600;
    request.maxTotalCalculationMs = 600;
    request.scoring.weights = Object.fromEntries(
      Object.keys(request.scoring.weights).map((key) => [key, 0]),
    ) as typeof request.scoring.weights;
    const provider = new TradeoffProvider();
    const alternatives = await buildRouteAlternatives(new RoutingEngine(provider), request);
    const fastest = alternatives.labeled.find((item) => item.title.includes('Greičiausias'))!.candidate;
    const shortest = alternatives.labeled.find((item) => item.title.includes('Trumpiausias'))!.candidate;

    expect(fastest.stopSequence).toEqual(['stop-2', 'stop-1']);
    expect(shortest.stopSequence).toEqual(['stop-1', 'stop-2']);
    expect(fastest.drivingMinutes).toBeLessThan(shortest.drivingMinutes);
    expect(shortest.totalDistanceKm).toBeLessThan(fastest.totalDistanceKm);
    expect(provider.matrixRequests).toBe(2);
  });

  it('leads with the balanced pick, then a fastest/shortest x with/without-windows 2x2', () => {
    expect(ROUTE_ALTERNATIVE_MODES).toEqual([
      'balanced',
      'reversed_balanced',
      'free_fastest',
      'free_shortest',
      'timed_fastest',
      'timed_shortest',
    ]);
    expect(ROUTE_ALTERNATIVE_LABELS.balanced.title).toBe('Subalansuotas');
    expect(ROUTE_ALTERNATIVE_LABELS.balanced.group).toBe('Rekomenduojama');
    expect(ROUTE_ALTERNATIVE_LABELS.reversed_balanced.title).toBe('Apverstas');
    expect(ROUTE_ALTERNATIVE_LABELS.free_fastest.title).toBe('Greičiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.free_shortest.title).toBe('Trumpiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.timed_fastest.title).toBe('Greičiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.timed_shortest.title).toBe('Trumpiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.free_fastest.group).toBe('Nepaisant pristatymo laikų');
    expect(ROUTE_ALTERNATIVE_LABELS.timed_fastest.group).toBe('Pagal pristatymo laikus');
    for (const mode of ROUTE_ALTERNATIVE_MODES) {
      expect(ROUTE_ALTERNATIVE_LABELS[mode].comment.length).toBeGreaterThan(20);
    }
  });

  it('keeps genuinely required windows binding without promoting informational ones', () => {
    const request = createBaseRequest(3);
    const window = { from: '2026-06-15T08:00:00.000Z', to: '2026-06-15T12:00:00.000Z' };
    // Stop 0: a delivery time the driver typed, never marked required.
    request.stops[0].informationalTimeWindow = window;
    request.stops[0].requiredTimeWindow = undefined;
    // Stop 1: imported with both ends, so it really is binding.
    request.stops[1].informationalTimeWindow = window;
    request.stops[1].requiredTimeWindow = window;

    const timed = requestForPlanningMode(request, 'with_time_windows');
    const geo = requestForPlanningMode(request, 'ignore_time_windows');

    expect(timed.planningMode).toBe('with_time_windows');
    // The whole point of the middle ground: an informational window shapes the
    // plan (waiting + mismatch penalty) but never becomes a rule.
    expect(timed.stops[0].requiredTimeWindow).toBeUndefined();
    expect(timed.stops[0].informationalTimeWindow).toEqual(window);
    expect(timed.stops[1].requiredTimeWindow).toEqual(window);

    expect(geo.planningMode).toBe('ignore_time_windows');
    expect(geo.stops[0].requiredTimeWindow).toBeUndefined();
    expect(geo.stops[1].requiredTimeWindow).toBeUndefined();
  });

  it('keeps unique labeled objectives and evaluates the reverse route', async () => {
    const request = createBaseRequest(8);
    request.planningMode = 'with_time_windows';
    request.startLocation = { id: 'start', label: 'Bazė', latitude: 55.9333, longitude: 23.3167 };
    request.endLocation = { id: 'end', label: 'Namai', latitude: 55.9333, longitude: 23.3167 };
    request.vehicle.startLocation = request.startLocation;
    request.vehicle.defaultEndLocation = request.endLocation;
    const north = { latitude: 55.98, longitude: 23.34 };
    const south = { latitude: 55.88, longitude: 23.22 };
    request.stops.forEach((stop, index) => {
      const anchor = index % 2 === 0 ? north : south;
      stop.location = {
        ...stop.location,
        latitude: anchor.latitude + index * 0.002,
        longitude: anchor.longitude + index * 0.002,
      };
      stop.informationalTimeWindow = {
        from: index === 0 ? '2026-06-15T06:00:00.000Z' : '2026-06-15T08:00:00.000Z',
        to: index === 0 ? '2026-06-15T09:00:00.000Z' : '2026-06-15T16:00:00.000Z',
      };
      stop.requiredTimeWindow = stop.informationalTimeWindow;
    });

    const engine = new RoutingEngine(new SyntheticTravelCostProvider('asymmetric'));
    const four = await buildRouteAlternatives(engine, request);

    expect(four.labeled.length).toBeGreaterThanOrEqual(2);
    expect(four.labeled.length).toBeLessThanOrEqual(ROUTE_ALTERNATIVE_MODES.length);
    expect(new Set(
      four.labeled.map((item) => item.candidate.stopSequence.join('|')),
    ).size).toBe(four.labeled.length);
    expect(four.labeled.map((item) => item.mode)).toContain('balanced');
    expect(four.labeled[0].title).toContain('Subalansuotas');
    const reversed = four.labeled.find((item) => item.mode === 'reversed_balanced');
    expect(four.labeled.some((item) => item.title.includes('Apverstas'))).toBe(true);
    if (reversed) {
      expect(reversed.candidate.stopSequence).toEqual(
        [...four.labeled[0].candidate.stopSequence].reverse(),
      );
      expect(reversed.candidate.totalDistanceKm).toBeGreaterThan(0);
      expect(reversed.candidate.totalWorkMinutes).toBeGreaterThan(0);
    }
    for (const item of four.labeled) {
      expect(item.candidate.id.endsWith(`:${item.mode}`)).toBe(true);
      expect(item.candidate.generatedBy.some((tag) => tag === `objective:${item.mode}`)).toBe(true);
      expect(item.comment.length).toBeGreaterThan(20);
    }

    const fastest = four.labeled.find((item) => item.title.includes('Greičiausias'))!;
    const shortest = four.labeled.find((item) => item.title.includes('Trumpiausias'));
    expect(fastest.candidate.drivingMinutes).toBeGreaterThan(0);
    if (shortest) {
      expect(shortest.candidate.totalDistanceKm).toBeGreaterThan(0);
      if (shortest.candidate.id !== fastest.candidate.id) {
        expect(shortest.candidate.stopSequence).not.toEqual(fastest.candidate.stopSequence);
      }
    } else {
      expect(fastest.title).toContain('Trumpiausias');
    }
    expect(four.result.candidates).toHaveLength(four.labeled.length);
    // The balanced pick is preselected; the four extremes are there to compare against.
    expect(four.result.recommended?.id).toContain(':balanced');
  }, 15000);

  it('keeps fastest as min finish time and shortest as min km from the geo pool', async () => {
    const request = createBaseRequest(6);
    const engine = new RoutingEngine(new SyntheticTravelCostProvider('city_traffic'));
    const timed = await engine.optimize(requestForPlanningMode(request, 'with_time_windows'));
    const geo = await engine.optimize(requestForPlanningMode(request, 'ignore_time_windows'));
    const labeled = selectRouteAlternatives(timed, geo, request);
    const fastest = labeled.find((item) => item.mode === 'free_fastest')!;
    const shortest = labeled.find((item) => item.mode === 'free_shortest')
      ?? labeled.find((item) => item.title.includes('Trumpiausias'))!;
    const geoFeasible = geo.candidates.filter((candidate) => candidate.feasible);
    const pool = geoFeasible.length > 0 ? geoFeasible : geo.candidates;
    expect(fastest.candidate.drivingMinutes).toBeLessThanOrEqual(
      Math.max(...pool.map((candidate) => candidate.drivingMinutes)),
    );
    expect(shortest.candidate.totalDistanceKm).toBeLessThanOrEqual(
      Math.max(...pool.map((candidate) => candidate.totalDistanceKm)),
    );
    expect(fastest.candidate.drivingMinutes).toBe(
      Math.min(...pool.map((candidate) => candidate.drivingMinutes)),
    );
    if (shortest.candidate.id === fastest.candidate.id) {
      expect(shortest.title).toContain('Trumpiausias');
      expect(shortest.title).toContain('Greičiausias');
    } else {
      expect(shortest.candidate.totalDistanceKm).toBe(Math.min(...pool.map((c) => c.totalDistanceKm)));
    }
  });

  it('alternatives screen renders the four Lithuanian mode titles', () => {
    const screen = readFileSync(resolve(__dirname, '../../src/app/route/[id]/alternatives.tsx'), 'utf8');
    expect(screen).toContain('buildRouteAlternatives');
    expect(screen).toContain('item.title');
    expect(screen).toContain('item.comment');
    expect(screen).toContain('durationLabel(props.candidate.totalWorkMinutes)');
    expect(screen).toContain('totalDistanceKm');
    expect(screen).toContain('selectedCandidate?.totalDistanceKm');
    expect(screen).toContain('selectedCandidate?.totalWorkMinutes');
  });
});
