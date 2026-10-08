import { describe, expect, it } from 'vitest';

import { aggregateWageDays } from '../../src/application/finance/wage-report';
import { isFuelOnlyWorkSheet } from '../../src/domain/fuel-only-workday';
import type { ServerTripSheet } from '../../src/infrastructure/auth/employee-session';

function sheet(patch: Partial<ServerTripSheet> & Pick<ServerTripSheet, 'id' | 'date'>): ServerTripSheet {
  return {
    assignmentId: patch.assignmentId ?? patch.id,
    routeId: patch.routeId ?? patch.id,
    routeNumbers: [],
    status: 'completed',
    driverId: 'driver-1',
    driverName: 'Vairuotojas',
    vehicle: null,
    fuelNormLitersPer100Km: null,
    startOdometer: null,
    endOdometer: null,
    actualDistanceKm: null,
    plannedDistanceKm: null,
    startedAt: null,
    completedAt: null,
    durationMinutes: null,
    totalStops: 0,
    deliveredStops: 0,
    totalWeightKg: 0,
    deliveredWeightKg: 0,
    startAddress: '',
    endAddress: '',
    compensation: null,
    fuelEntries: [],
    ...patch,
  };
}

describe('fuel-only days are not paid work days', () => {
  it('recognises a fill without a route, kilometres, stops or weight', () => {
    expect(isFuelOnlyWorkSheet(sheet({
      id: 'fuel',
      date: '2026-09-08',
      assignmentId: 'vehicle-day:van:2026-09-08',
      startAddress: 'Kuro pylimas',
    }))).toBe(true);
    expect(isFuelOnlyWorkSheet(sheet({
      id: 'service',
      date: '2026-09-08',
      assignmentId: 'vehicle-day:van:2026-09-08',
      actualDistanceKm: 18,
      startOdometer: 100,
      endOdometer: 118,
    }))).toBe(false);
    expect(isFuelOnlyWorkSheet(sheet({
      id: 'route',
      date: '2026-09-08',
      assignmentId: 'assignment-1',
      routeNumbers: ['R1'],
      totalWeightKg: 0,
      totalStops: 4,
    }))).toBe(false);
  });

  it('does not pay the 23 euro base or count a fuel-only day as a route', () => {
    const fuelOnly = sheet({
      id: 'fuel-day',
      date: '2026-09-08',
      assignmentId: 'vehicle-day:van:2026-09-08',
      startAddress: 'Kuro pylimas',
      fuelEntries: [{ id: 'fill-1', tripSheetId: 'fuel-day', assignmentId: 'vehicle-day:van:2026-09-08', routeId: 'vehicle-day:van:2026-09-08', driverId: 'driver-1', driverName: 'Vairuotojas', vehicleId: 'van', registrationNumber: 'NLL182', filledAt: '2026-09-08T08:00:00.000Z', odometer: 0, liters: 40, pricePerLiter: 1.5, totalCost: 60, station: null, receiptNumber: '1', notes: null, createdAt: '2026-09-08T08:00:00.000Z', createdBy: 'driver-1' }],
      compensation: { rates: { type: 'variable', fixedDailyNetEur: 23, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65 }, distanceKm: 0, distanceSource: 'planned', weightKg: 0, stops: 0, fixedAmountEur: 23, distanceAmountEur: 0, weightAmountEur: 0, stopsAmountEur: 0, totalNetEur: 23, preliminary: true },
    });
    expect(aggregateWageDays([fuelOnly])).toEqual([]);
  });

  it('keeps one work day when a fill and a real route share a date', () => {
    const fuelOnly = sheet({
      id: 'fuel-day',
      date: '2026-09-09',
      assignmentId: 'vehicle-day:van:2026-09-09',
      startAddress: 'Kuro pylimas',
      fuelEntries: [{ id: 'fill-1', tripSheetId: 'fuel-day', assignmentId: 'vehicle-day:van:2026-09-09', routeId: 'vehicle-day:van:2026-09-09', driverId: 'driver-1', driverName: 'Vairuotojas', vehicleId: 'van', registrationNumber: 'NLL182', filledAt: '2026-09-09T07:00:00.000Z', odometer: 10, liters: 20, pricePerLiter: null, totalCost: null, station: null, receiptNumber: null, notes: null, createdAt: '2026-09-09T07:00:00.000Z', createdBy: 'driver-1' }],
    });
    const route = sheet({
      id: 'route-day',
      date: '2026-09-09',
      assignmentId: 'assignment-9',
      routeNumbers: ['R9'],
      totalStops: 3,
      totalWeightKg: 0,
      actualDistanceKm: 120,
      compensation: { rates: { type: 'variable', fixedDailyNetEur: 23, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65 }, distanceKm: 120, distanceSource: 'odometer', weightKg: 0, stops: 3, fixedAmountEur: 23, distanceAmountEur: 6, weightAmountEur: 0, stopsAmountEur: 1.95, totalNetEur: 30.95, preliminary: false },
    });
    const days = aggregateWageDays([fuelOnly, route]);
    expect(days).toHaveLength(1);
    expect(days[0]?.figures.routeCount).toBe(1);
    expect(days[0]?.figures.fixedAmountEur).toBe(23);
    expect(days[0]?.figures.fuelLiters).toBe(20);
    expect(days[0]?.figures.fuelCostEur).toBe(0);
  });
});
