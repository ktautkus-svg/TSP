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
});
