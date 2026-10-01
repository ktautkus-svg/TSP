import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { aggregateWageDays, summarizeWageDays, wageTableColumns } from '../../src/application/finance/wage-report';
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

  it('orders days from the oldest ISO date and keeps the first of the month on top', () => {
    const rows = aggregateWageDays([
      sheet({ id: 'late', date: '2026-08-31' }),
      sheet({ id: 'tenth', date: '2026-08-10' }),
      sheet({ id: 'first', date: '2026-08-01' }),
      sheet({ id: 'next-month', date: '2026-09-02' }),
    ]);
    expect(rows.map((row) => row.date)).toEqual(['2026-08-01', '2026-08-10', '2026-08-31', '2026-09-02']);
  });

  it('sums one day from its stored parts and does not repeat the daily base for each route', () => {
    const rows = aggregateWageDays([
      sheet({ id: 'a', routeId: 'r1', routeNumbers: ['R2'] }),
      sheet({ id: 'a', routeId: 'r1', routeNumbers: ['R2'] }),
      sheet({ id: 'b', routeId: 'r2', routeNumbers: ['R1'], actualDistanceKm: 10 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sheets.map((item) => item.id)).toEqual(['b', 'a']);
    expect(rows[0]!.figures.fixedAmountEur).toBe(23);
    expect(rows[0]!.figures.wageEur).toBe(142.85);
    const parts = (rows[0]!.figures.fixedAmountEur ?? 0)
      + (rows[0]!.figures.distanceAmountEur ?? 0)
      + (rows[0]!.figures.weightAmountEur ?? 0)
      + (rows[0]!.figures.stopsAmountEur ?? 0);
    expect(parts).toBe(rows[0]!.figures.wageEur);
    expect(rows[0]!.figures.routeCount).toBe(2);
  });

  it('sums the period from the same day rows the screen lists', () => {
    const rows = aggregateWageDays([
      sheet({ id: 'day-1', date: '2026-08-02' }),
      sheet({ id: 'day-2', date: '2026-08-03', compensation: { ...sheet().compensation!, totalNetEur: 10, fixedAmountEur: 10, distanceAmountEur: 0, weightAmountEur: 0, stopsAmountEur: 0, distanceKm: 4, weightKg: 8, stops: 1 } }),
    ]);
    const totals = summarizeWageDays(rows);
    expect(totals.wageEur).toBeCloseTo(rows.reduce((sum, day) => sum + (day.figures.wageEur ?? 0), 0));
    expect(totals.km).toBeCloseTo(rows.reduce((sum, day) => sum + day.figures.distanceKm, 0));
    expect(totals.routes).toBe(rows.reduce((sum, day) => sum + day.figures.routeCount, 0));
    expect(totals.totalEur).toBeCloseTo(totals.fuelCostEur + totals.wageEur);
  });

  it('shows zero euro parts when compensation exists and a dash value when it does not', () => {
    const [present] = aggregateWageDays([sheet({
      compensation: { ...sheet().compensation!, fixedAmountEur: 0, distanceAmountEur: 0, weightAmountEur: 0, stopsAmountEur: 0, totalNetEur: 0 },
    })]);
    expect(present!.figures.fixedAmountEur).toBe(0);
    expect(present!.figures.wageEur).toBe(0);
    const [missing] = aggregateWageDays([sheet({ id: 'none', compensation: null, actualDistanceKm: 12, totalStops: 3, totalWeightKg: 40 })]);
    expect(missing!.figures.wageEur).toBeNull();
    expect(missing!.figures.fixedAmountEur).toBeNull();
    expect(missing!.figures.distanceKm).toBe(12);
    expect(missing!.figures.stops).toBe(3);
    expect(missing!.figures.weightKg).toBe(40);
  });

  it('lists the real wage parts and no bonus column', () => {
    expect(wageTableColumns(false).map((column) => column.header)).toEqual([
      'Data', 'Km', 'Km €', 'Svoris, kg', 'Svoris €', 'Taškai', 'Taškai €', 'Bazė €', 'Dienos suma €',
    ]);
    expect(wageTableColumns(true).map((column) => column.header)).toContain('Vairuotojas');
    expect(wageTableColumns(true).some((column) => /pried|bonus/i.test(column.header))).toBe(false);
  });

  it('shows each day with its wage parts, oldest first, on a shared table', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(source).toContain('Atlygis pagal dieną');
    expect(source).toContain('formatDateKey(day.date)');
    expect(source).toContain('showDriverNames ?');
    expect(source).toContain('wageTableColumns');
    expect(source).toContain('summarizeWageDays(wageDays)');
    expect(source).toContain('finance-wage-table');
    expect(source).toContain('DESKTOP_WIDTH = 1280');
    expect(source).not.toContain('detailHeaderRow');
    expect(source).not.toContain('right.date.localeCompare(left.date)');
  });

  it('offers a per-driver dropdown that falls back to "all" when the driver is absent from the period', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(source).toContain('finance-driver-filter');
    expect(source).toContain('finance-driver-trigger');
    expect(source).toContain('drivers.length > 1');
    expect(source).toContain('drivers.some((driver) => driver.driverId === driverFilter)');
    expect(source).toContain('activeDriver === ALL_DRIVERS || sheet.driverId === activeDriver');
    // A real open/close list, not a chip strip.
    expect(source).toContain('driverPickerOpen');
    expect(source).toContain('styles.driverOptions');
  });

  it('expands a day into its route, wage-composition and fuel breakdown', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(source).toContain('finance-wage-day-toggle-');
    expect(source).toContain('finance-wage-day-detail-');
    expect(source).toContain('WageDayDetail');
    expect(source).toContain('figures.distanceAmountEur');
    expect(source).toContain('figures.stopsAmountEur');
    expect(source).toContain("day.sheets.flatMap((sheet) => sheet.fuelEntries)");
  });

  it('lets an admin correct a route stop count and cargo weight from the day detail', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(source).toContain('canEdit={profile.role === \'admin\'}');
    expect(source).toContain('finance-edit-metrics-');
    expect(source).toContain('finance-metrics-stops-');
    expect(source).toContain('finance-metrics-weight-');
    expect(source).toContain("JSON.stringify({ totalStops: nextStops, totalWeightKg: nextWeight })");

    const store = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
    expect(store).toContain('async updateAssignmentManualMetrics(');
    expect(store).toContain('total_stops: totalStops, total_weight_kg: totalWeightKg');
    const api = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
    expect(api).toContain('store.updateAssignmentManualMetrics(assignmentId');
  });
});
