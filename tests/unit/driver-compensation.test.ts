import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPENSATION_RATES,
  attachDailyCompensation,
  normalizeCompensation,
  type DriverCompensationRates,
  type ServerTripSheet,
} from '../../server/employee-auth-store';

function sheet(overrides: Partial<ServerTripSheet> = {}): ServerTripSheet {
  return {
    driverId: 'driver-1',
    date: '2026-01-05',
    status: 'completed',
    actualDistanceKm: 100,
    plannedDistanceKm: 90,
    totalWeightKg: 1_000,
    totalStops: 10,
    ...overrides,
  } as ServerTripSheet;
}

describe('dienos atlygis netto', () => {
  it('skaičiuoja pagal numatytuosius tarifus, kai vairuotojui nieko nenustatyta', () => {
    const [result] = attachDailyCompensation([sheet()]);
    const pay = result.compensation!;
    // 23 + 100x0,05 + 1000x0,006 + 10x0,65 = 23 + 5 + 6 + 6,5
    expect(pay.fixedAmountEur).toBe(DEFAULT_COMPENSATION_RATES.fixedDailyNetEur);
    expect(pay.distanceAmountEur).toBe(5);
    expect(pay.weightAmountEur).toBe(6);
    expect(pay.stopsAmountEur).toBe(6.5);
    expect(pay.totalNetEur).toBe(40.5);
  });

  it('naudoja vairuotojo susitartus kintamus tarifus', () => {
    const rates: DriverCompensationRates = {
      type: 'variable', fixedDailyNetEur: 25, perKmEur: 0.05, perKgEur: 0.005, perStopEur: 0.6,
    };
    const [result] = attachDailyCompensation([sheet()], new Map([['driver-1', rates]]));
    // 25 + 5 + 5 + 6 = 41
    expect(result.compensation!.totalNetEur).toBe(41);
  });

  it('fiksuotam atlygiui neprideda įkainių už km, kg ir taškus', () => {
    const rates: DriverCompensationRates = {
      type: 'fixed', fixedDailyNetEur: 60, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65,
    };
    const [result] = attachDailyCompensation([sheet()], new Map([['driver-1', rates]]));
    const pay = result.compensation!;
    expect(pay.totalNetEur).toBe(60);
    expect(pay.distanceAmountEur).toBe(0);
    expect(pay.weightAmountEur).toBe(0);
    expect(pay.stopsAmountEur).toBe(0);
  });

  it('iki reiso pabaigos km preliminarūs, po jo - iš odometro', () => {
    const before = attachDailyCompensation([sheet({ actualDistanceKm: null })])[0].compensation!;
    expect(before.distanceSource).toBe('planned');
    expect(before.distanceKm).toBe(90);
    expect(before.preliminary).toBe(true);

    const after = attachDailyCompensation([sheet()])[0].compensation!;
    expect(after.distanceSource).toBe('odometer');
    expect(after.distanceKm).toBe(100);
    expect(after.preliminary).toBe(false);
  });

  it('sudeda tos pačios dienos kelis reisus į vieną atlygį', () => {
    const [result] = attachDailyCompensation([
      sheet({ actualDistanceKm: 60, totalStops: 4, totalWeightKg: 500 }),
      sheet({ actualDistanceKm: 40, totalStops: 6, totalWeightKg: 500 }),
    ]);
    const pay = result.compensation!;
    expect(pay.distanceKm).toBe(100);
    expect(pay.stops).toBe(10);
    expect(pay.totalNetEur).toBe(40.5);
  });

  it('seni vairuotojai be tarifų lauko grąžina null, o ne šiukšles', () => {
    expect(normalizeCompensation(undefined)).toBeNull();
    expect(normalizeCompensation({ type: 'variable' })).toEqual({
      type: 'variable',
      ...DEFAULT_COMPENSATION_RATES,
    });
  });
});
