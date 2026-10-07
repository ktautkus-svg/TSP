import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { createFinanceUiHarnessApi } from '../../src/application/finance/finance-ui-harness-api';
import { aggregateWageDays, summarizeWageDays, type WageAdjustment } from '../../src/application/finance/wage-report';
import { buildWageWorkbook } from '../../src/application/finance/wage-workbook';
import { buildMonthSummary } from '../../src/application/reporting/month-summary';
import {
  employeeApi,
  setEmployeeApiTestTransport,
  type ServerRouteAssignment,
  type ServerTripSheet,
} from '../../src/infrastructure/auth/employee-session';

async function viaApi<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  try {
    const body = await employeeApi<T>(path, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    return { status: method === 'DELETE' ? 204 : 200, body };
  } catch (reason) {
    const error = reason as { status?: number; code?: string; message?: string };
    return {
      status: error.status ?? 500,
      body: { error: { code: error.code, message: error.message } } as T,
    };
  }
}

describe('finance UI harness synthetic API', () => {
  afterEach(() => {
    setEmployeeApiTestTransport(null);
  });

  it('serves wages scenarios and persists edit/save without doubling the manual adjustment', async () => {
    const api = createFinanceUiHarnessApi();
    setEmployeeApiTestTransport(api.handle);

    const sheets = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
    const extras = await employeeApi<{ adjustments: WageAdjustment[] }>('/api/admin/wage-adjustments?from=2026-10-01&to=2026-10-31');
    const days = aggregateWageDays(sheets.tripSheets, extras.adjustments);

    expect(days.find((day) => day.key === 'driver-1:2026-10-02')?.sheets).toHaveLength(2);
    expect(days.find((day) => day.key === 'driver-1:2026-10-02')?.manualAdjustment).toMatchObject({ amountEur: 30, comment: 'Priedas' });
    expect(days.find((day) => day.key === 'driver-1:2026-10-04')?.manualAdjustment).toBeNull();
    expect(days.find((day) => day.key === 'driver-1:2026-10-04')?.sheets.some((sheet) => sheet.assignmentId === 'acct-jonas-1004')).toBe(true);
    expect(days.find((day) => day.key === 'driver-1:2026-10-05')?.manualAdjustment).toMatchObject({ amountEur: 0, comment: 'Sirgau' });
    expect(days.find((day) => day.key === 'driver-1:2026-10-06')?.manualAdjustment).toMatchObject({ amountEur: -12.5 });
    expect(days.find((day) => day.key === 'driver-1:2026-10-07')?.sheets).toHaveLength(0);
    expect(days.find((day) => day.key === 'driver-1:2026-10-07')?.manualAdjustment?.comment).toMatch(/komentaras/i);

    const beforeExtra = summarizeWageDays(days).extraEur;
    await employeeApi('/api/admin/wage-adjustments', {
      method: 'PUT',
      body: JSON.stringify({ driverId: 'driver-1', date: '2026-10-02', amountEur: 30, comment: 'Priedas' }),
    });
    const again = await employeeApi<{ adjustments: WageAdjustment[] }>('/api/admin/wage-adjustments?from=2026-10-01&to=2026-10-31');
    const afterDays = aggregateWageDays(sheets.tripSheets, again.adjustments);
    expect(summarizeWageDays(afterDays).extraEur).toBe(beforeExtra);
    expect(again.adjustments.filter((item) => item.driverId === 'driver-1' && item.date === '2026-10-02')).toHaveLength(1);
  });

  it('deletes only the selected accounting row and keeps fuel, other drivers, live routes and wage adjustments', async () => {
    const api = createFinanceUiHarnessApi();
    setEmployeeApiTestTransport(api.handle);

    const before = api.snapshot();
    expect(before.fuelEntryIds).toContain('fuel-acct-1004');
    expect(before.assignments.some((row) => row.id === 'acct-jonas-1004')).toBe(true);

    const monthBefore = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: before.assignments.map((item) => ({ ...item, vehicle: item.vehicle ?? null })),
      tripSheets: before.tripSheets,
    });
    expect(monthBefore.rows.find((row) => row.assignmentId === 'acct-jonas-1004')?.canDelete).toBe(true);
    expect(monthBefore.rows.find((row) => row.assignmentId === 'live-jonas-1003')?.canDelete).toBe(false);

    const forbiddenLive = await viaApi<{ error: { code: string } }>('/api/admin/accounting-trips/live-jonas-1003', { method: 'DELETE' });
    expect(forbiddenLive.status).toBe(400);
    expect(forbiddenLive.body && 'error' in (forbiddenLive.body as object) ? (forbiddenLive.body as { error: { code: string } }).error.code : null).toBe('NOT_ACCOUNTING_TRIP');

    const missing = await viaApi<{ error: { code: string } }>('/api/admin/accounting-trips/aaaaaaaa-0000-0000-0000-000000000000', { method: 'DELETE' });
    expect(missing.status).toBe(404);

    const badId = await viaApi<{ error: { code: string } }>('/api/admin/accounting-trips/short', { method: 'DELETE' });
    expect(badId.status).toBe(400);

    await employeeApi('/api/admin/accounting-trips/acct-jonas-1004', { method: 'DELETE' });
    const after = api.snapshot();

    expect(after.assignments.some((row) => row.id === 'acct-jonas-1004')).toBe(false);
    expect(after.assignments.some((row) => row.id === 'live-jonas-1003')).toBe(true);
    expect(after.assignments.some((row) => row.id === 'live-petras-1003')).toBe(true);
    expect(after.fuelEntryIds).toContain('fuel-acct-1004');
    expect(after.adjustments.some((item) => item.date === '2026-10-02' && item.amountEur === 30)).toBe(true);

    const monthAfter = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: after.assignments.map((item) => ({ ...item, vehicle: item.vehicle ?? null })),
      tripSheets: after.tripSheets,
    });
    expect(monthAfter.rows.some((row) => row.assignmentId === 'acct-jonas-1004')).toBe(false);

    const wageBefore = aggregateWageDays(before.tripSheets, before.adjustments);
    const wageAfter = aggregateWageDays(after.tripSheets, after.adjustments);
    const dayBefore = wageBefore.find((day) => day.key === 'driver-1:2026-10-04')!;
    const dayAfter = wageAfter.find((day) => day.key === 'driver-1:2026-10-04');
    expect(dayBefore.sheets.some((sheet) => sheet.assignmentId === 'acct-jonas-1004')).toBe(true);
    expect(dayAfter?.sheets.every((sheet) => sheet.assignmentId !== 'acct-jonas-1004') ?? true).toBe(true);
    expect((dayBefore.figures.wageEur ?? 0) > (dayAfter?.figures.wageEur ?? 0)).toBe(true);
    // Unrelated two-trip day and its manual adjustment stay intact.
    expect(wageAfter.find((day) => day.key === 'driver-1:2026-10-02')).toMatchObject({
      manualAdjustment: { amountEur: 30 },
    });
    expect(wageAfter.find((day) => day.key === 'driver-1:2026-10-02')?.sheets).toHaveLength(2);
  });

  it('surfaces a synthetic failure once so product screens can show error + retry', async () => {
    const api = createFinanceUiHarnessApi();
    setEmployeeApiTestTransport(api.handle);
    api.armNextFailure();

    const first = await viaApi('/api/admin/wage-adjustments', {
      method: 'PUT',
      body: JSON.stringify({ driverId: 'driver-1', date: '2026-10-06', amountEur: -12.5, comment: 'Korekcija' }),
    });
    expect(first.status).toBe(500);

    const second = await viaApi<{ adjustment: WageAdjustment }>('/api/admin/wage-adjustments', {
      method: 'PUT',
      body: JSON.stringify({ driverId: 'driver-1', date: '2026-10-06', amountEur: -12.5, comment: 'Korekcija' }),
    });
    expect(second.status).toBe(200);
    expect(api.snapshot().adjustments.find((item) => item.date === '2026-10-06')?.amountEur).toBe(-12.5);
  });

  it('lists assignments and trip sheets for the real month-summary and trip-sheet screens', async () => {
    const api = createFinanceUiHarnessApi();
    setEmployeeApiTestTransport(api.handle);
    const [assignments, sheets, users, vehicles] = await Promise.all([
      employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments'),
      employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets'),
      employeeApi<{ users: { id: string }[] }>('/api/admin/users'),
      employeeApi<{ vehicles: { id: string }[] }>('/api/admin/vehicles'),
    ]);
    expect(assignments.assignments.length).toBeGreaterThanOrEqual(4);
    expect(sheets.tripSheets.length).toBeGreaterThanOrEqual(4);
    expect(users.users.some((user) => user.id === 'driver-1')).toBe(true);
    expect(vehicles.vehicles.some((vehicle) => vehicle.id === 'veh-1')).toBe(true);
  });

  it('keeps Excel export payload totals identical to UI wage sums after adjustment and accounting delete', async () => {
    const api = createFinanceUiHarnessApi();
    setEmployeeApiTestTransport(api.handle);

    await employeeApi('/api/admin/wage-adjustments', {
      method: 'PUT',
      body: JSON.stringify({ driverId: 'driver-1', date: '2026-10-03', amountEur: 5, comment: 'Quick edit proof' }),
    });

    const afterEdit = api.snapshot();
    const daysAfterEdit = aggregateWageDays(afterEdit.tripSheets, afterEdit.adjustments);
    const uiTotalsAfterEdit = summarizeWageDays(daysAfterEdit);
    const dayEdit = daysAfterEdit.find((day) => day.key === 'driver-1:2026-10-03');
    expect(dayEdit?.manualAdjustment).toMatchObject({ amountEur: 5, comment: 'Quick edit proof' });
    expect(dayEdit?.figures.payEur).toBeCloseTo((dayEdit?.figures.wageEur ?? 0) + 5);

    const workbookAfterEdit = buildWageWorkbook({
      companyName: 'FiRo',
      employeeName: 'Visi darbuotojai',
      periodLabel: '2026-10-01 – 2026-10-31',
      days: daysAfterEdit,
    });
    const sheetXmlAfterEdit = strFromU8(unzipSync(workbookAfterEdit)['xl/worksheets/sheet1.xml']!);
    expect(sheetXmlAfterEdit).toContain(`<v>${uiTotalsAfterEdit.extraEur}</v>`);
    expect(sheetXmlAfterEdit).toContain(`<v>${uiTotalsAfterEdit.payEur}</v>`);
    expect(sheetXmlAfterEdit).toContain(`<v>${uiTotalsAfterEdit.totalEur}</v>`);
    expect(sheetXmlAfterEdit).toContain('<v>5</v>');

    await employeeApi('/api/admin/accounting-trips/acct-jonas-1004', { method: 'DELETE' });
    const afterDelete = api.snapshot();
    expect(afterDelete.assignments.some((row) => row.id === 'acct-jonas-1004')).toBe(false);
    expect(afterDelete.fuelEntryIds).toContain('fuel-acct-1004');
    expect(afterDelete.adjustments.some((item) => item.date === '2026-10-03' && item.amountEur === 5)).toBe(true);

    const daysAfterDelete = aggregateWageDays(afterDelete.tripSheets, afterDelete.adjustments);
    const uiTotalsAfterDelete = summarizeWageDays(daysAfterDelete);
    expect(daysAfterDelete.some((day) => day.sheets.some((sheet) => sheet.assignmentId === 'acct-jonas-1004'))).toBe(false);
    expect(uiTotalsAfterDelete.payEur).toBeLessThan(uiTotalsAfterEdit.payEur);

    const workbookAfterDelete = buildWageWorkbook({
      companyName: 'FiRo',
      employeeName: 'Visi darbuotojai',
      periodLabel: '2026-10-01 – 2026-10-31',
      days: daysAfterDelete,
    });
    const sheetXmlAfterDelete = strFromU8(unzipSync(workbookAfterDelete)['xl/worksheets/sheet1.xml']!);
    expect(sheetXmlAfterDelete).toContain(`<v>${uiTotalsAfterDelete.extraEur}</v>`);
    expect(sheetXmlAfterDelete).toContain(`<v>${uiTotalsAfterDelete.payEur}</v>`);
    expect(sheetXmlAfterDelete).toContain(`<v>${uiTotalsAfterDelete.totalEur}</v>`);
    expect(sheetXmlAfterDelete).toContain(`<v>${uiTotalsAfterDelete.fuelCostEur}</v>`);
  });
});
