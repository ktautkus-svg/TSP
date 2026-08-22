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

describe('route alternatives', () => {
  it('leads with the balanced pick, then a fastest/shortest x with/without-windows 2x2', () => {
    expect(ROUTE_ALTERNATIVE_MODES).toEqual([
      'balanced',
      'free_fastest',
      'free_shortest',
      'timed_fastest',
      'timed_shortest',
    ]);
    expect(ROUTE_ALTERNATIVE_LABELS.balanced.title).toBe('Subalansuotas');
    expect(ROUTE_ALTERNATIVE_LABELS.balanced.group).toBe('Rekomenduojama');
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

  it('selects one candidate per objective mode with mode-stamped ids', async () => {
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

    expect(four.labeled).toHaveLength(5);
    expect(four.labeled.map((item) => item.mode)).toEqual([...ROUTE_ALTERNATIVE_MODES]);
    expect(four.labeled[0].title).toBe('Subalansuotas');
    expect(four.labeled[1].title).toBe('Greičiausias');
    expect(['Trumpiausias', 'Kitas trumpiausias', 'Trumpiausias = greičiausias']).toContain(four.labeled[2].title);
    expect(four.labeled[3].title).toBe('Greičiausias');
    expect(['Trumpiausias', 'Kitas trumpiausias', 'Trumpiausias = greičiausias']).toContain(four.labeled[4].title);
    expect(four.labeled.map((item) => item.group)).toEqual([
      'Rekomenduojama',
      'Nepaisant pristatymo laikų',
      'Nepaisant pristatymo laikų',
      'Pagal pristatymo laikus',
      'Pagal pristatymo laikus',
    ]);
    for (const item of four.labeled) {
      expect(item.candidate.id.endsWith(`:${item.mode}`)).toBe(true);
      expect(item.candidate.generatedBy.some((tag) => tag === `objective:${item.mode}`)).toBe(true);
      expect(item.comment.length).toBeGreaterThan(20);
    }

    const fastest = four.labeled.find((item) => item.mode === 'free_fastest')!;
    const shortest = four.labeled.find((item) => item.mode === 'free_shortest')!;
    const geo = await engine.optimize(requestForPlanningMode(request, 'ignore_time_windows'));
    const geoPool = geo.candidates.filter((candidate) => candidate.feasible);
    const pool = geoPool.length > 0 ? geoPool : geo.candidates;
    // "Fastest" means finishing first, so it is the minimum total work time —
    // driving plus service plus any waiting at a closed door.
    expect(fastest.candidate.totalWorkMinutes).toBe(
      Math.min(...pool.map((candidate) => candidate.totalWorkMinutes)),
    );
    if (shortest.title === 'Trumpiausias') {
      expect(shortest.candidate.totalDistanceKm).toBe(
        Math.min(...pool.map((candidate) => candidate.totalDistanceKm)),
      );
    } else if (shortest.title === 'Kitas trumpiausias') {
      expect(shortest.candidate.stopSequence).not.toEqual(fastest.candidate.stopSequence);
      expect(shortest.comment).toContain('Absoliučiai trumpiausias sutampa su greičiausiu');
    } else {
      expect(shortest.title).toBe('Trumpiausias = greičiausias');
      expect(shortest.candidate.stopSequence).toEqual(fastest.candidate.stopSequence);
    }
    expect(four.result.candidates).toHaveLength(5);
    // The balanced pick is preselected; the four extremes are there to compare against.
    expect(four.result.recommended?.id).toContain(':balanced');
  });

  it('keeps fastest as min finish time and shortest as min km from the geo pool', async () => {
    const request = createBaseRequest(6);
    const engine = new RoutingEngine(new SyntheticTravelCostProvider('city_traffic'));
    const timed = await engine.optimize(requestForPlanningMode(request, 'with_time_windows'));
    const geo = await engine.optimize(requestForPlanningMode(request, 'ignore_time_windows'));
    const labeled = selectRouteAlternatives(timed, geo, request.planningMode);
    const fastest = labeled.find((item) => item.mode === 'free_fastest')!;
    const shortest = labeled.find((item) => item.mode === 'free_shortest')!;
    const geoFeasible = geo.candidates.filter((candidate) => candidate.feasible);
    const pool = geoFeasible.length > 0 ? geoFeasible : geo.candidates;
    expect(fastest.candidate.totalWorkMinutes).toBeLessThanOrEqual(
      Math.max(...pool.map((candidate) => candidate.totalWorkMinutes)),
    );
    expect(shortest.candidate.totalDistanceKm).toBeLessThanOrEqual(
      Math.max(...pool.map((candidate) => candidate.totalDistanceKm)),
    );
    expect(fastest.candidate.totalWorkMinutes).toBe(Math.min(...pool.map((c) => c.totalWorkMinutes)));
    if (shortest.title === 'Trumpiausias') {
      expect(shortest.candidate.totalDistanceKm).toBe(Math.min(...pool.map((c) => c.totalDistanceKm)));
    } else if (shortest.title === 'Kitas trumpiausias') {
      expect(shortest.candidate.stopSequence).not.toEqual(fastest.candidate.stopSequence);
    } else {
      expect(shortest.title).toBe('Trumpiausias = greičiausias');
      expect(shortest.candidate.stopSequence).toEqual(fastest.candidate.stopSequence);
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
