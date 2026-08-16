import { describe, expect, it } from 'vitest';

import {
  ROUTE_ALTERNATIVE_LABELS,
  ROUTE_ALTERNATIVE_MODES,
  buildFourObjectiveAlternatives,
  requestForPlanningMode,
  selectFourObjectiveAlternatives,
} from '../../src/application/routing/route-alternative-modes';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { createBaseRequest } from '../../src/domain/routing/scenarios';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('four objective route alternatives', () => {
  it('exposes a fastest/shortest x with/without-windows 2x2', () => {
    expect(ROUTE_ALTERNATIVE_MODES).toEqual([
      'free_fastest',
      'free_shortest',
      'timed_fastest',
      'timed_shortest',
    ]);
    expect(ROUTE_ALTERNATIVE_LABELS.free_fastest.title).toBe('Greičiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.free_shortest.title).toBe('Trumpiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.timed_fastest.title).toBe('Greičiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.timed_shortest.title).toBe('Trumpiausias');
    expect(ROUTE_ALTERNATIVE_LABELS.free_fastest.group).toBe('Nepaisant laiko langų');
    expect(ROUTE_ALTERNATIVE_LABELS.timed_fastest.group).toBe('Pagal laiko langus');
    for (const mode of ROUTE_ALTERNATIVE_MODES) {
      expect(ROUTE_ALTERNATIVE_LABELS[mode].comment.length).toBeGreaterThan(20);
    }
  });

  it('toggles required windows when switching planning mode', () => {
    const request = createBaseRequest(3);
    request.stops[0].informationalTimeWindow = {
      from: '2026-06-15T08:00:00.000Z',
      to: '2026-06-15T12:00:00.000Z',
    };
    request.stops[0].requiredTimeWindow = undefined;
    const timed = requestForPlanningMode(request, 'with_time_windows');
    const geo = requestForPlanningMode(request, 'ignore_time_windows');
    expect(timed.planningMode).toBe('with_time_windows');
    expect(timed.stops[0].requiredTimeWindow).toEqual(request.stops[0].informationalTimeWindow);
    expect(geo.planningMode).toBe('ignore_time_windows');
    expect(geo.stops[0].requiredTimeWindow).toBeUndefined();
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
    const four = await buildFourObjectiveAlternatives(engine, request);

    expect(four.labeled).toHaveLength(4);
    expect(four.labeled.map((item) => item.mode)).toEqual([...ROUTE_ALTERNATIVE_MODES]);
    expect(four.labeled[0].title).toBe('Greičiausias');
    expect(['Trumpiausias', 'Kitas trumpiausias', 'Trumpiausias = greičiausias']).toContain(four.labeled[1].title);
    expect(four.labeled[2].title).toBe('Greičiausias');
    expect(['Trumpiausias', 'Kitas trumpiausias', 'Trumpiausias = greičiausias']).toContain(four.labeled[3].title);
    expect(four.labeled.map((item) => item.group)).toEqual([
      'Nepaisant laiko langų',
      'Nepaisant laiko langų',
      'Pagal laiko langus',
      'Pagal laiko langus',
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
    expect(fastest.candidate.drivingMinutes).toBe(
      Math.min(...pool.map((candidate) => candidate.drivingMinutes)),
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
    expect(four.result.candidates).toHaveLength(4);
    expect(four.result.recommended?.id).toContain(':timed_fastest');
  });

  it('keeps fastest as min driving and shortest as min km from the geo pool', async () => {
    const request = createBaseRequest(6);
    const engine = new RoutingEngine(new SyntheticTravelCostProvider('city_traffic'));
    const timed = await engine.optimize(requestForPlanningMode(request, 'with_time_windows'));
    const geo = await engine.optimize(requestForPlanningMode(request, 'ignore_time_windows'));
    const labeled = selectFourObjectiveAlternatives(timed, geo);
    const fastest = labeled.find((item) => item.mode === 'free_fastest')!;
    const shortest = labeled.find((item) => item.mode === 'free_shortest')!;
    const geoFeasible = geo.candidates.filter((candidate) => candidate.feasible);
    const pool = geoFeasible.length > 0 ? geoFeasible : geo.candidates;
    expect(fastest.candidate.drivingMinutes).toBeLessThanOrEqual(
      Math.max(...pool.map((candidate) => candidate.drivingMinutes)),
    );
    expect(shortest.candidate.totalDistanceKm).toBeLessThanOrEqual(
      Math.max(...pool.map((candidate) => candidate.totalDistanceKm)),
    );
    expect(fastest.candidate.drivingMinutes).toBe(Math.min(...pool.map((c) => c.drivingMinutes)));
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
    expect(screen).toContain('buildFourObjectiveAlternatives');
    expect(screen).toContain('item.title');
    expect(screen).toContain('item.comment');
    expect(screen).toContain('durationLabel(props.candidate.totalWorkMinutes)');
    expect(screen).toContain('totalDistanceKm');
    expect(screen).toContain('selectedCandidate?.totalDistanceKm');
    expect(screen).toContain('selectedCandidate?.totalWorkMinutes');
  });
});
