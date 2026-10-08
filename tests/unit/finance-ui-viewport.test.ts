import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assessTripSheetFit,
  assessWageTableFit,
  assertAmountsVisible,
  availableContentWidth,
  measureTripSheetFromSource,
  measureWageTableFromSource,
  parseContentMaxWidth,
  TRIP_SHEET_LAYOUT,
  VIEWPORTS,
  WAGE_TABLE_LAYOUT,
  wageTableRequiredWidth,
} from '../../src/application/finance/finance-layout-fit';
import { strFromU8, unzipSync } from 'fflate';

import { aggregateWageDays, summarizeWageDays, wageDayCell } from '../../src/application/finance/wage-report';
import { buildWageWorkbook } from '../../src/application/finance/wage-workbook';
import type { ServerTripSheet } from '../../src/infrastructure/auth/employee-session';
import {
  buildMonthSummary,
  filterMonthSummaryRows,
  type MonthSummaryAssignment,
} from '../../src/application/reporting/month-summary';

function sheet(overrides: Partial<ServerTripSheet> = {}): ServerTripSheet {
  return {
    id: 'sheet-1', assignmentId: 'assignment-1', routeId: 'route-1', routeNumbers: ['R1'], status: 'completed',
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

function accountingAssignment(partial: Partial<MonthSummaryAssignment> & Pick<MonthSummaryAssignment, 'id' | 'driverId' | 'status' | 'routeId'>): MonthSummaryAssignment {
  return {
    driverName: 'Jonas',
    assignedAt: '2026-10-02T06:00:00.000Z',
    vehicle: { id: 'veh-1', registrationNumber: 'DEF456', model: 'Crafter' },
    routeSnapshot: {
      route: {
        date: '2026-10-02',
        total_stops: 1,
        total_weight_kg: 10,
        actual_distance_km: 5,
        started_at: '2026-10-02T05:00:00.000Z',
        completed_at: '2026-10-02T14:00:00.000Z',
      },
      stops: [],
      shipmentLines: [{ route_code: 'Servisas' }],
    },
    ...partial,
  };
}

describe('finance UI viewport fit with synthetic data', () => {
  it('keeps wage and trip-sheet amounts reachable at 1366/1920/360/390/768 without clipping primary controls', () => {
    const wagesSource = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    const tripSource = readFileSync(resolve(import.meta.dirname, '../../src/app/trip-sheet.tsx'), 'utf8');
    expect(parseContentMaxWidth(wagesSource)).toBe(WAGE_TABLE_LAYOUT.contentMaxWidth);
    expect(parseContentMaxWidth(tripSource)).toBe(TRIP_SHEET_LAYOUT.contentMaxWidth);
    expect(wagesSource).toContain('finance-quick-edit-adjustment-');
    // A horizontal ScrollView lets unwrapped detail text stretch the desktop
    // table past the screen; the wage table must stay a plain flex row.
    expect(wagesSource).not.toContain('ScrollView horizontal');
    expect(wagesSource).not.toMatch(/import \{[^}]*\bScrollView\b[^}]*\} from 'react-native'/);
    expect(tripSource).toContain('reportTableScroll');

    // Required widths come from the live style declarations, not mirrored constants alone.
    const measuredWage = measureWageTableFromSource(wagesSource, { showDriver: true, canEdit: true });
    const measuredTrip = measureTripSheetFromSource(tripSource);
    expect(measuredWage).toBe(wageTableRequiredWidth({ showDriver: true, canEdit: true }));
    expect(measuredTrip.required).toBe(measuredTrip.declaredMinWidth);
    expect(measuredTrip.required).toBe(1052);

    for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) {
      const wageFit = assessWageTableFit(viewport, { showDriver: true, canEdit: true });
      const tripFit = assessTripSheetFit(viewport);
      expect(wageFit.clipped, `wages clipped at ${viewport}`).toBe(false);
      expect(tripFit.clipped, `trip-sheet clipped at ${viewport}`).toBe(false);
      expect(wageFit.required).toBe(measuredWage);
      expect(tripFit.required).toBe(measuredTrip.required);
      const wageAvailable = availableContentWidth(
        VIEWPORTS[viewport].width,
        WAGE_TABLE_LAYOUT.contentMaxWidth,
        WAGE_TABLE_LAYOUT.foundationPaddingX,
      );
      const tripAvailable = availableContentWidth(
        VIEWPORTS[viewport].width,
        TRIP_SHEET_LAYOUT.contentMaxWidth,
        TRIP_SHEET_LAYOUT.foundationPaddingX + TRIP_SHEET_LAYOUT.sheetPaddingX,
      );
      if (VIEWPORTS[viewport].width >= 1366) {
        expect(measuredWage, `wages exceed shell at ${viewport}`).toBeLessThanOrEqual(wageAvailable);
        expect(measuredTrip.required, `trip-sheet exceeds shell at ${viewport}`).toBeLessThanOrEqual(tripAvailable);
        expect(wageFit.fitsWithoutHorizontalScroll, `wages should fit ${viewport}`).toBe(true);
        expect(tripFit.fitsWithoutHorizontalScroll, `trip-sheet should fit ${viewport}`).toBe(true);
      } else {
        // Phones/tablets show wrapping day cards for wages; trip sheet may scroll.
        expect(wageFit.tableShown).toBe(false);
        expect(wageFit.allowsHorizontalScroll).toBe(true);
        expect(tripFit.allowsHorizontalScroll).toBe(true);
        expect(wageTableRequiredWidth({ showDriver: true, canEdit: true })).toBeGreaterThan(wageTableRequiredWidth({ showDriver: false, canEdit: false }));
      }
    }
  });

  it('fits every wage table column without horizontal scroll from the first desktop width (1280 px) up', () => {
    const wagesSource = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(wagesSource).toContain(`const DESKTOP_WIDTH = ${WAGE_TABLE_LAYOUT.desktopMinWidth};`);
    for (const width of [WAGE_TABLE_LAYOUT.desktopMinWidth, 1366, 1440, 1920]) {
      for (const options of [{ showDriver: true, canEdit: true }, { showDriver: false, canEdit: false }]) {
        const fit = assessWageTableFit(width, options);
        expect(fit.tableShown, `table at ${width}`).toBe(true);
        expect(fit.clipped, `clipped at ${width}`).toBe(false);
        expect(fit.required).toBe(measureWageTableFromSource(wagesSource, options));
      }
    }
    // Amount and comment columns flex; only identity/action columns are fixed.
    expect(wagesSource).toMatch(/wageTableNumber: \{[^}]*flex: 1, minWidth: \d+/);
    expect(wagesSource).toMatch(/wageTableComment: \{[^}]*flex: [\d.]+, minWidth: \d+/);
  });

  it('separates manual adjustment from trip wage and keeps export totals identical to UI sums', () => {
    const legacyTrip = sheet(); // trip wage 142.85, no manual doc yet
    const withManual = aggregateWageDays([legacyTrip], [
      { driverId: 'driver-1', driverName: 'Karolis Tautkus', date: '2026-08-24', amountEur: 30, comment: 'Priedas' },
    ]);
    expect(withManual[0]!.manualAdjustment).toEqual({
      driverId: 'driver-1',
      driverName: 'Karolis Tautkus',
      date: '2026-08-24',
      amountEur: 30,
      comment: 'Priedas',
    });
    expect(withManual[0]!.figures.wageEur).toBe(142.85);
    expect(withManual[0]!.figures.extraEur).toBe(30);
    expect(withManual[0]!.figures.payEur).toBe(172.85);
    // Editor must use manualAdjustment, never payEur (would double the trip wage into wage-adjustments).
    expect(withManual[0]!.manualAdjustment!.amountEur).not.toBe(withManual[0]!.figures.payEur);
    expect(withManual[0]!.manualAdjustment!.amountEur).not.toBe(withManual[0]!.figures.wageEur);

    const commentOnly = aggregateWageDays([sheet()], [
      { driverId: 'driver-1', driverName: 'Karolis Tautkus', date: '2026-08-24', amountEur: 0, comment: 'Sirgau' },
    ]);
    expect(commentOnly[0]!.manualAdjustment).not.toBeNull();
    expect(commentOnly[0]!.manualAdjustment!.amountEur).toBe(0);
    expect(commentOnly[0]!.figures.extraEur).toBe(0);

    const zeroTrip = aggregateWageDays([sheet({ compensation: { ...sheet().compensation!, totalNetEur: 0, fixedAmountEur: 0, distanceAmountEur: 0, weightAmountEur: 0, stopsAmountEur: 0 } })], []);
    expect(zeroTrip[0]!.manualAdjustment).toBeNull();
    expect(zeroTrip[0]!.figures.extraEur).toBe(0);

    const negative = aggregateWageDays([sheet()], [
      { driverId: 'driver-1', driverName: 'Karolis Tautkus', date: '2026-08-24', amountEur: -12.5, comment: 'Korekcija' },
    ]);
    expect(negative[0]!.manualAdjustment!.amountEur).toBe(-12.5);

    const noTrip = aggregateWageDays([], [
      { driverId: 'driver-1', driverName: 'Karolis Tautkus', date: '2026-09-12', amountEur: 100, comment: 'Šeštadienis' },
    ]);
    expect(noTrip[0]!.sheets).toHaveLength(0);
    expect(noTrip[0]!.manualAdjustment!.amountEur).toBe(100);

    const twoTrips = aggregateWageDays([
      sheet({ id: 'a', routeId: 'r1' }),
      sheet({ id: 'b', routeId: 'r2', actualDistanceKm: 10 }),
    ], [
      { driverId: 'driver-1', driverName: 'Karolis Tautkus', date: '2026-08-24', amountEur: 5, comment: 'Mažas priedas' },
    ]);
    expect(twoTrips).toHaveLength(1);
    expect(twoTrips[0]!.sheets).toHaveLength(2);
    expect(twoTrips[0]!.manualAdjustment!.amountEur).toBe(5);

    const isolation = aggregateWageDays([
      sheet(),
      sheet({ id: 'other', driverId: 'driver-2', driverName: 'Kitas', date: '2026-08-25' }),
    ], [
      { driverId: 'driver-1', driverName: 'Karolis Tautkus', date: '2026-08-24', amountEur: 30, comment: 'A' },
      { driverId: 'driver-2', driverName: 'Kitas', date: '2026-08-25', amountEur: 7, comment: 'B' },
    ]);
    expect(isolation.find((day) => day.driverId === 'driver-1')!.manualAdjustment!.amountEur).toBe(30);
    expect(isolation.find((day) => day.driverId === 'driver-2')!.manualAdjustment!.amountEur).toBe(7);
    expect(isolation.find((day) => day.driverId === 'driver-1' && day.date === '2026-08-24')!.manualAdjustment!.comment).toBe('A');

    const days = [...withManual, ...noTrip];
    const uiTotals = summarizeWageDays(days);
    const labels = assertAmountsVisible([
      uiTotals.extraEur,
      uiTotals.payEur,
      uiTotals.wageEur,
      withManual[0]!.manualAdjustment!.amountEur,
      noTrip[0]!.manualAdjustment!.amountEur,
    ]);
    expect(labels.every((label) => label.length > 0 && !label.includes('undefined'))).toBe(true);

    const bytes = buildWageWorkbook({
      companyName: 'FiRo',
      employeeName: 'Karolis Tautkus',
      periodLabel: '2026-08',
      days,
    });
    const sheetXml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
    // Export embeds the same numeric totals the UI summarizeWageDays returns
    // (Papildomai + Dienos suma columns / footer notes).
    expect(sheetXml).toContain(`<v>${uiTotals.extraEur}</v>`);
    expect(sheetXml).toContain(`<v>${uiTotals.payEur}</v>`);
    expect(sheetXml).toContain(`<v>${uiTotals.totalEur}</v>`);
    expect(uiTotals.payEur).toBeCloseTo(uiTotals.wageEur + uiTotals.extraEur);
    expect(uiTotals.totalEur).toBeCloseTo(uiTotals.fuelCostEur + uiTotals.payEur);
    expect(wageDayCell(withManual[0]!, 'extraEur')).toBe(30);
  });

  it('wires wages editor to manualAdjustment and month-summary delete to accounting-trips only', () => {
    const wages = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(wages).toContain('day.manualAdjustment');
    expect(wages).toContain('hasManualAdjustment');
    expect(wages).toContain('manualAmount');
    expect(wages).not.toMatch(/hasAdjustment = figures\.extraEur/);
    expect(wages).not.toMatch(/setAmount\(figures\.extraEur/);
    expect(wages).not.toMatch(/setAmount\(figures\.payEur/);
    expect(wages).toContain('finance-quick-edit-adjustment-');
    expect(wages).toContain('Pašalinti papildomą sumą?');
    expect(wages).toContain('FinanceConfirmDialog');
    expect(wages).toContain('finance-remove-confirm-');
    // Legacy trip wage alone must not render a removable manual adjustment control.
    const tripOnly = aggregateWageDays([sheet()], []);
    expect(tripOnly[0]!.manualAdjustment).toBeNull();
    expect(tripOnly[0]!.figures.extraEur).toBe(0);
    expect(wages).toContain('{hasManualAdjustment ? <Pressable');
    expect(wages).toContain('finance-remove-adjustment-');

    const month = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/month-summary.tsx'), 'utf8');
    expect(month).toContain('/api/admin/accounting-trips/');
    expect(month).toContain("method: 'DELETE'");
    expect(month).toContain('row.canDelete');
    expect(month).toContain('month-summary-empty-days');
    expect(month).toContain('showEmptyDays');
    expect(month).toContain('Pašalinti apskaitos įrašą?');
    expect(month).toContain('FinanceConfirmDialog');
    expect(month).toContain('month-summary-delete-confirm');
    expect(month).not.toMatch(/\/api\/admin\/assignments\/\$\{.*\}.*DELETE/);

    const summary = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [
        accountingAssignment({ id: 'live', driverId: 'driver-a', status: 'completed', routeId: 'route-live' }),
        accountingAssignment({ id: 'manual', driverId: 'driver-b', status: 'completed', routeId: 'accounting-manual' }),
      ],
      tripSheets: [],
    });
    const live = summary.rows.find((row) => row.assignmentId === 'live')!;
    const manual = summary.rows.find((row) => row.assignmentId === 'manual')!;
    const empty = summary.rows.find((row) => row.source === 'empty')!;
    expect(live.canDelete).toBe(false);
    expect(manual.canDelete).toBe(true);
    expect(empty.canDelete).toBe(false);
    expect(empty.source).toBe('empty');
    expect(filterMonthSummaryRows(summary.rows, {
      query: '', driverId: 'all', vehicleId: 'all', plate: 'all', date: '', problemsOnly: false, showEmptyDays: false,
    }).every((row) => row.source !== 'empty')).toBe(true);

    const api = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
    expect(api).toContain("accountingTripMatch && request.method === 'DELETE'");
    expect(api).toContain('store.deleteAccountingTrip');
    expect(api).toContain("requireManagementPermission(profile, 'canManageFinancials')");

    const store = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
    const deleteMethodStart = store.indexOf('async deleteAccountingTrip(');
    expect(deleteMethodStart).toBeGreaterThanOrEqual(0);
    const returnAt = store.indexOf('return assignment;', deleteMethodStart);
    expect(returnAt).toBeGreaterThan(deleteMethodStart);
    const deleteMethod = store.slice(deleteMethodStart, returnAt + 'return assignment;'.length);
    expect(deleteMethod).toContain("routeId.startsWith('accounting-')");
    expect(deleteMethod).toContain('NOT_ACCOUNTING_TRIP');
    expect(deleteMethod).toContain('await reference.delete()');
    expect(deleteMethod).not.toContain('fuelEntries');
    expect(deleteMethod).not.toContain('vehicleDay');
    expect(deleteMethod.match(/\.delete\(/g) ?? []).toEqual(['.delete(']);
    expect(deleteMethod).toContain('reference.delete()');
  });
});
