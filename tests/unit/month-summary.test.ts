import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readXlsxWorkbook } from '@/application/import/logistics-excel-v1';
import {
  buildMonthSummary,
  draftFromRow,
  emptyDraft,
  filterMonthSummaryRows,
  monthSummaryExportRows,
  MONTH_SUMMARY_EXPORT_HEADERS,
  reviewMonthSummaryCreate,
  reviewMonthSummaryEdit,
  type MonthSummaryAssignment,
  type MonthSummarySheet,
} from '@/application/reporting/month-summary';
import { buildTableWorkbook } from '@/application/trip-sheet/export-xlsx';

const names = {
  driverName: (id: string) => (id === 'driver-b' ? 'Ąžuolas' : 'Jonas'),
  vehicleName: (id: string) => (id === 'veh-2' ? 'Sprinter · ABC123' : 'Crafter · DEF456'),
};

function assignment(partial: Partial<MonthSummaryAssignment> & Pick<MonthSummaryAssignment, 'id' | 'driverId' | 'status'>): MonthSummaryAssignment {
  return {
    routeId: `route-${partial.id}`,
    driverName: partial.driverId === 'driver-b' ? 'Ąžuolas' : 'Jonas',
    assignedAt: '2026-10-02T06:00:00.000Z',
    vehicle: { id: 'veh-1', registrationNumber: 'DEF456', model: 'Crafter' },
    routeSnapshot: {
      route: {
        date: '2026-10-02',
        total_stops: 4,
        total_weight_kg: 120.5,
        actual_distance_km: 12.5,
        started_at: '2026-10-02T05:00:00.000Z',
        completed_at: '2026-10-02T14:00:00.000Z',
      },
      stops: [],
      shipmentLines: [{ route_code: 'R15' }],
    },
    ...partial,
  };
}

function sheet(partial: Partial<MonthSummarySheet> & Pick<MonthSummarySheet, 'assignmentId' | 'date'>): MonthSummarySheet {
  return {
    routeId: partial.assignmentId,
    routeNumbers: ['R15'],
    status: 'completed',
    driverId: 'driver-a',
    driverName: 'Jonas',
    vehicle: { id: 'veh-1', registrationNumber: 'DEF456', model: 'Crafter' },
    actualDistanceKm: 12.5,
    plannedDistanceKm: 40,
    startOdometer: 100,
    endOdometer: 112.5,
    startedAt: '2026-10-02T05:00:00.000Z',
    completedAt: '2026-10-02T14:00:00.000Z',
    totalStops: 4,
    totalWeightKg: 120.5,
    startAddress: 'Sandėlis',
    endAddress: 'Pabaiga',
    ...partial,
  };
}

describe('month summary', () => {
  it('keeps the overview focused while retaining full fields in the editor', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/month-summary.tsx'), 'utf8');
    const table = source.slice(source.indexOf('function DesktopTable'), source.indexOf('function EditorModal'));
    expect(table).toContain("['Data', 'Vairuotojas', 'Numeris', 'Maršrutas', 'Taškai', 'Svoris', 'Km', 'Pastabos', '']");
    expect(table).not.toContain('<Fact label="Automobilis"');
    expect(table).not.toContain('<Fact label="Būsena"');
    expect(table).not.toContain('<Fact label="Išvykimas"');
    expect(table).not.toContain('<Fact label="Užbaigimas"');
    const editor = source.slice(source.indexOf('function EditorModal'));
    expect(editor).toContain('label="Automobilis"');
    expect(editor).toContain('label="Išvykimas"');
    expect(editor).toContain('label="Užbaigimas"');
  });

  it('keeps every day and does not merge two trips on the same day', () => {
    const summary = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [
        assignment({ id: 'a', driverId: 'driver-a', status: 'completed' }),
        assignment({
          id: 'b',
          driverId: 'driver-b',
          status: 'completed',
          vehicle: { id: 'veh-2', registrationNumber: 'ABC123', model: 'Sprinter' },
          routeSnapshot: {
            route: { date: '2026-10-02', total_stops: 2, total_weight_kg: 10, actual_distance_km: 8 },
            stops: [],
            shipmentLines: [{ route_code: 'M11' }],
          },
        }),
      ],
      tripSheets: [],
    });
    expect(summary.days).toHaveLength(31);
    expect(summary.rows.filter((row) => row.date === '2026-10-02')).toHaveLength(2);
    expect(summary.rows.filter((row) => row.source === 'empty')).toHaveLength(30);
    expect(summary.rows.map((row) => row.date)).toEqual([...summary.days.flatMap((day) => summary.rows.filter((row) => row.date === day).map(() => day))]);
  });

  it('hides placeholder clocks on an odometer day and flags a missing driver', () => {
    const summary = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [],
      tripSheets: [sheet({
        assignmentId: 'vehicle-day-veh-1-2026-10-03',
        date: '2026-10-03',
        driverId: 'unassigned',
        driverName: 'Nepriskirtas',
        routeNumbers: [],
        startAddress: 'GPS odometras',
        endAddress: 'GPS odometras',
        startedAt: '2026-10-03T00:00:00.000Z',
        completedAt: '2026-10-03T23:59:59.000Z',
        totalStops: 0,
        totalWeightKg: 0,
        plannedDistanceKm: null,
      })],
    });
    const row = summary.rows.find((item) => item.date === '2026-10-03' && item.source === 'odometer-day');
    expect(row?.startedAt).toBeNull();
    expect(row?.completedAt).toBeNull();
    expect(row?.routeLabel).toBe('—');
    expect(row?.issues).toContain('missing-driver');
    expect(row?.distanceKm).toBe(12.5);
  });

  it('filters by driver and hides empty days while a filter is on', () => {
    const summary = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [assignment({ id: 'a', driverId: 'driver-a', status: 'completed' })],
      tripSheets: [],
    });
    const filtered = filterMonthSummaryRows(summary.rows, {
      query: 'ąžuolas',
      driverId: 'all',
      vehicleId: 'all',
      plate: 'all',
      date: '',
      problemsOnly: false,
    });
    expect(filtered.every((row) => row.source !== 'empty')).toBe(true);
    expect(filtered).toHaveLength(0);
    const byDriver = filterMonthSummaryRows(summary.rows, {
      query: '',
      driverId: 'driver-a',
      vehicleId: 'all',
      plate: 'all',
      date: '2026-10-02',
      problemsOnly: false,
    });
    expect(byDriver.map((row) => row.assignmentId)).toEqual(['a']);
  });

  it('blocks an unfinished edit and routes a completed correction to the trip sheet', () => {
    const summary = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [assignment({ id: 'a', driverId: 'driver-a', status: 'completed' })],
      tripSheets: [sheet({ assignmentId: 'a', date: '2026-10-02' })],
    });
    const row = summary.rows.find((item) => item.assignmentId === 'a')!;
    const unchanged = reviewMonthSummaryEdit(row, draftFromRow(row), summary.rows, names);
    expect(unchanged.ok).toBe(false);

    const driverDraft = { ...draftFromRow(row), driverId: 'driver-b' };
    const driverReview = reviewMonthSummaryEdit(row, driverDraft, summary.rows, names);
    expect(driverReview.ok).toBe(true);
    expect(driverReview.requests.map((request) => request.kind)).toEqual(['trip-sheet']);
    expect(driverReview.effects.some((effect) => effect.includes('Atlygis'))).toBe(true);
    expect(JSON.stringify(driverReview.requests)).not.toContain('delivery_status');

    const dateReview = reviewMonthSummaryEdit(row, { ...draftFromRow(row), date: '2026-10-04' }, summary.rows, names);
    expect(dateReview.requests.map((request) => request.kind)).toEqual(['work-date']);

    const metricsReview = reviewMonthSummaryEdit(row, { ...draftFromRow(row), totalStops: '6', totalWeightKg: '80,5' }, summary.rows, names);
    expect(metricsReview.requests).toEqual([{
      kind: 'assignment',
      assignmentId: 'a',
      body: { totalStops: 6, totalWeightKg: 80.5 },
    }]);
  });

  it('refuses a duplicate accounting trip and keeps missing kilometres empty in Excel', () => {
    const summary = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [assignment({ id: 'a', driverId: 'driver-a', status: 'completed' })],
      tripSheets: [],
    });
    const duplicate = reviewMonthSummaryCreate({
      ...emptyDraft('2026-10-02'),
      driverId: 'driver-a',
      vehicleId: 'veh-1',
      routeLabel: 'R15',
      totalStops: '4',
      totalWeightKg: '10',
    }, summary.rows, names, '2026-10-03T08:00:00.000Z');
    expect(duplicate.ok).toBe(false);

    const missing = buildMonthSummary({
      year: 2026,
      month: 10,
      assignments: [assignment({
        id: 'bare',
        driverId: 'driver-a',
        status: 'completed',
        routeSnapshot: {
          route: { date: '2026-10-05', total_stops: 1, total_weight_kg: 1, status: 'completed' },
          stops: [],
          shipmentLines: [],
        },
      })],
      tripSheets: [],
    });
    const bare = missing.rows.find((row) => row.assignmentId === 'bare')!;
    expect(bare.distanceKm).toBeNull();
    expect(bare.issues).toContain('missing-km');
    const exported = monthSummaryExportRows([bare])[0]!;
    expect(exported[MONTH_SUMMARY_EXPORT_HEADERS.indexOf('Kilometrai')]).toBeNull();
    expect(exported[MONTH_SUMMARY_EXPORT_HEADERS.indexOf('Vairuotojas')]).toBe('Jonas');

    const bytes = buildTableWorkbook({
      sheetName: 'Mėnesio suvestinė',
      title: 'Mėnesio suvestinė',
      subtitle: '2026-10',
      headers: MONTH_SUMMARY_EXPORT_HEADERS,
      rows: [['2026-10-02', 'Ąžuolas', 'Crafter', 'DEF456', 'R15', 'Užbaigtas', 4, 120.5, 12.5, 'Odometras', '2026-10-02 08:00', '2026-10-02 17:00', '']],
      columnWidths: [14],
    });
    const workbook = readXlsxWorkbook(bytes);
    expect(workbook[0]?.name).toBe('Mėnesio suvestinė');
    const data = workbook[0]?.rows.find((row) => row.rowNumber === 5);
    expect(data?.cells.B).toBe('Ąžuolas');
    expect(data?.cells.I).toBe(12.5);
    expect(data?.cells.A).toBe('2026-10-02');
  });

  it('creates an accounting trip without route sync or a vehicle reassignment', () => {
    const store = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
    const created = store.slice(store.indexOf('async createAccountingTrip'), store.indexOf('async correctAssignmentWorkDate'));
    expect(created).toContain('stops: []');
    expect(created).not.toContain('seedAssignment');
    expect(created).not.toContain('assignVehicle');
    const workDate = store.slice(store.indexOf('async correctAssignmentWorkDate'), store.indexOf('async relocateVehicleDayReading'));
    expect(workDate).toContain('applyCompletedAssignmentRouteDateAlignment');
    expect(workDate).not.toContain('completeAssignment(');
    const api = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
    expect(api).toContain("pathname === '/api/admin/accounting-trips'");
    expect(api).toContain('/work-date');
  });
});
