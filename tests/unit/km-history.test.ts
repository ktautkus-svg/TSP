import { describe, expect, it } from 'vitest';

import { buildKmHistory } from '../../src/application/statistics/km-history';
import type { StatsRouteRow } from '../../src/domain/statistics';

function row(overrides: Partial<StatsRouteRow>): StatsRouteRow {
  return {
    date: '2026-08-28', status: 'completed', estimatedDistanceKm: null, actualDistanceKm: 100,
    totalStops: 3, startedAt: null, completedAt: null, completionSummary: null, ...overrides,
  };
}

describe('kilometre history', () => {
  it('groups routes by day and keeps the route direction and source visible', () => {
    const history = buildKmHistory([
      row({ routeId: 'a', routeLabel: 'R11', startAddress: 'Sandėlis', endAddress: 'Panevėžys', actualDistanceKm: 120 }),
      row({ routeId: 'b', routeLabel: 'R54', startAddress: 'Sandėlis', endAddress: 'Vilnius', actualDistanceKm: null, estimatedDistanceKm: 80 }),
    ], { fromKey: '2026-08-01', toKey: '2026-08-31' });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ totalKm: 200, allActual: false });
    expect(history[0]?.routes.map((route) => route.direction)).toEqual(['Sandėlis → Panevėžys', 'Sandėlis → Vilnius']);
  });

  it('does not count the same route twice on one day', () => {
    const history = buildKmHistory([
      row({ date: '2026-09-02', routeId: 'r-11', routeLabel: 'R11', actualDistanceKm: 415 }),
      row({ date: '2026-09-02', routeId: 'r-11', routeLabel: 'R11', actualDistanceKm: 415 }),
    ], { fromKey: '2026-09-01', toKey: '2026-09-30' });
    expect(history).toHaveLength(1);
    expect(history[0]?.totalKm).toBe(415);
    expect(history[0]?.routes).toHaveLength(1);
  });

  it('collapses a synced draft copy that carries no routeId', () => {
    const history = buildKmHistory([
      row({ date: '2026-09-02', routeId: null, routeLabel: 'R19', actualDistanceKm: 200, totalStops: 6, vehicleRegistration: 'NLL182', driverName: 'K. Tautkus' }),
      row({ date: '2026-09-02', routeId: null, routeLabel: 'R19', actualDistanceKm: 200, totalStops: 6, vehicleRegistration: 'NLL182', driverName: 'K. Tautkus' }),
    ], { fromKey: '2026-09-01', toKey: '2026-09-30' });
    expect(history[0]?.routes).toHaveLength(1);
    expect(history[0]?.totalKm).toBe(200);
  });
});
