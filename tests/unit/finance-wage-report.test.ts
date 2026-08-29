import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { aggregateWageDays } from '../../src/application/finance/wage-report';
import type { ServerTripSheet } from '../../src/infrastructure/auth/employee-session';

function sheet(overrides: Partial<ServerTripSheet> = {}): ServerTripSheet {
  return {
    id: 'sheet-1', assignmentId: 'assignment-1', routeId: 'route-1', routeNumbers: [], status: 'completed',
    date: '2026-08-24', driverId: 'driver-1', driverName: 'Karolis Tautkus', vehicle: null,
    fuelNormLitersPer100Km: null, startOdometer: null, endOdometer: null, actualDistanceKm: 363,
    plannedDistanceKm: null, startedAt: null, completedAt: null, durationMinutes: null, totalStops: 0,
    deliveredStops: 0, totalWeightKg: 0, deliveredWeightKg: 0, startAddress: '', endAddress: '',
    compensation: {
      rates: { type: 'variable', fixedDailyNetEur: 23, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65 },
      distanceKm: 1630, distanceSource: 'odometer', weightKg: 3900, stops: 23, fixedAmountEur: 23,
      distanceAmountEur: 81.5, weightAmountEur: 23.4, stopsAmountEur: 14.95, totalNetEur: 142.85,
      preliminary: false,
    },
    fuelEntries: [],
    ...overrides,
  };
}

describe('finance wage report', () => {
  it('shows one daily amount once even when that day contains several routes', () => {
    const rows = aggregateWageDays([
      sheet(),
      sheet({ id: 'sheet-2', routeId: 'route-2', actualDistanceKm: 813 }),
      sheet({ id: 'sheet-3', routeId: 'route-3', actualDistanceKm: 454 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-08-24', driverName: 'Karolis Tautkus', wageEur: 142.85 });
    expect(rows[0]!.sheets).toHaveLength(3);
  });

  it('keeps different drivers on the same date as separate rows', () => {
    const rows = aggregateWageDays([
      sheet(),
      sheet({ id: 'sheet-2', driverId: 'driver-2', driverName: 'Kitas Vairuotojas' }),
    ]);
    expect(rows.map((row) => row.driverName)).toEqual(['Karolis Tautkus', 'Kitas Vairuotojas']);
  });

  it('uses the compact date-and-amount list instead of the old route breakdown table', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(source).toContain('Atlygis pagal dieną');
    expect(source).toContain('formatDateKey(day.date)');
    expect(source).toContain('showDriverNames ?');
    expect(source).not.toContain('Bazė €');
    expect(source).not.toContain('Tšk €');
    expect(source).not.toContain('detailHeaderRow');
  });
});
