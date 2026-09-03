import { describe, expect, it } from 'vitest';

import { dailyFuelEntries, dailyRouteNumbers, type DailyMergeSheet } from '@/application/trip-sheet/daily-route-merge';

function sheet(overrides: Partial<DailyMergeSheet> & { routeNumbers: string[] }): DailyMergeSheet {
  return {
    startOdometer: null,
    endOdometer: null,
    actualDistanceKm: null,
    plannedDistanceKm: null,
    extraDistanceKm: null,
    ...overrides,
  };
}

describe('dailyRouteNumbers', () => {
  it('reproduces the NLL182 2026-08-27 bug: a leftover 0 km R88;R86 sheet must not concatenate onto the driven R07;R22;R09 day', () => {
    const driven = sheet({ routeNumbers: ['R07', 'R22', 'R09'], startOdometer: 282510, endOdometer: 282914 });
    const leftover = sheet({ routeNumbers: ['R88', 'R86'], startOdometer: 0, endOdometer: 0, actualDistanceKm: 0, plannedDistanceKm: 0 });

    expect(dailyRouteNumbers([driven, leftover])).toEqual(['R07', 'R22', 'R09']);
    // Order of the merged sheets should not matter.
    expect(dailyRouteNumbers([leftover, driven])).toEqual(['R07', 'R22', 'R09']);
  });

  it('unions route numbers from every sheet when none of them show any movement', () => {
    const first = sheet({ routeNumbers: ['R01'] });
    const second = sheet({ routeNumbers: ['R02'] });

    expect(dailyRouteNumbers([first, second])).toEqual(['R01', 'R02']);
  });

  it('treats a sheet with only plannedDistanceKm/extraDistanceKm movement as driven', () => {
    const planned = sheet({ routeNumbers: ['R10'], plannedDistanceKm: 40 });
    const leftover = sheet({ routeNumbers: ['R99'] });

    expect(dailyRouteNumbers([planned, leftover])).toEqual(['R10']);

    const extraOnly = sheet({ routeNumbers: ['R20'], extraDistanceKm: 15 });
    expect(dailyRouteNumbers([extraOnly, leftover])).toEqual(['R20']);
  });
});

describe('dailyFuelEntries', () => {
  it('reproduces the NLL182 2026-08-27 bug: fuel filled on 08-26 attached to a leftover 08-27 sheet must not double count', () => {
    const aug27Fills = [
      { id: 'a', filledAt: '2026-08-27T05:47:00.000Z', liters: 14.47 }, // receipt 205/1218
      { id: 'b', filledAt: '2026-08-27T18:26:00.000Z', liters: 68.91 }, // receipt 6/1126
    ];
    const leakedAug26Fill = { id: 'c', filledAt: '2026-08-26T09:00:00.000Z', liters: 83.61 }; // receipt 405/789, belongs to 08-26

    const merged = dailyFuelEntries([...aug27Fills, leakedAug26Fill], '2026-08-27');

    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(merged.reduce((sum, entry) => sum + entry.liters, 0)).toBeCloseTo(83.38);
  });

  it('deduplicates the same fuel entry id if it were attached to more than one merged sheet', () => {
    const entry = { id: 'dup', filledAt: '2026-08-27T08:00:00.000Z', liters: 10 };
    const merged = dailyFuelEntries([entry, { ...entry }], '2026-08-27');

    expect(merged).toHaveLength(1);
  });

  it('sorts the surviving entries by filledAt', () => {
    const later = { id: 'later', filledAt: '2026-08-27T18:00:00.000Z', liters: 1 };
    const earlier = { id: 'earlier', filledAt: '2026-08-27T05:00:00.000Z', liters: 1 };

    expect(dailyFuelEntries([later, earlier], '2026-08-27').map((entry) => entry.id)).toEqual(['earlier', 'later']);
  });
});
