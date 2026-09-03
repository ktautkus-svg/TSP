import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  AUGUST_2026_EXCEL_BACKFILL_ID,
  AUGUST_2026_EXCEL_DAY_FILES,
  AUGUST_2026_LEGACY_COMBINED_FILES,
  AUGUST_2026_STUB_PLACEHOLDER,
  EXISTING_UI_ROUTE_DATE,
  EXISTING_UI_ROUTE_ID,
  augustBackfillRouteId,
  buildAugustBackfillRouteSnapshot,
  createCachedGeocoder,
  decideAugustBackfillDayAction,
  excelAddressToGeocodeQuery,
  geocodeQueriesCached,
  historicalWorkdayTimestamps,
  inventStubStop,
  isAugust2026SkipDay,
  liteAssignmentFromSnapshot,
  loadAugust2026ExcelBackfillCatalog,
  matchDriverByName,
  matchVehicleByPlate,
  resolveAugustBackfillDirectory,
  stubOrderNumber,
  uniqueGeocodeQueries,
} from '../../src/domain/august-2026-excel-backfill';
import { applyAdminAssignmentComplete } from '../../src/domain/historical-assignment-complete';
import { lithuanianDateKey } from '../../src/domain/lithuanian-time';
import { FUEL_AUGUST_2026_MIGRATION_ID } from '../../src/domain/excel-fuel-log';
import { TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID } from '../../src/domain/trip-sheet-august-2026-vehicle-fix';
import {
  applyDayReading,
  buildServerTripSheet,
  tripSheetWorkDate,
  type RouteAssignment,
} from '../../server/employee-auth-store';

const NOW = '2026-09-03T07:15:00.000Z';
const storeSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
const apiSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
const productionServer = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');
const dockerfile = readFileSync(resolve(import.meta.dirname, '../../Dockerfile'), 'utf8');
const readme = readFileSync(resolve(import.meta.dirname, '../../scripts/august-2026-backfill/README.md'), 'utf8');

function assignmentFromDay(
  snapshot: ReturnType<typeof buildAugustBackfillRouteSnapshot>,
  result: ReturnType<typeof applyAdminAssignmentComplete>,
  extras: Partial<RouteAssignment> = {},
): RouteAssignment {
  return {
    id: extras.id ?? 'assignment-aug-backfill',
    routeId: String(result.route.id),
    driverId: extras.driverId ?? 'driver-karolis',
    driverName: extras.driverName ?? 'Karolis Tautkus',
    status: 'completed',
    progress: result.progress,
    createdBy: AUGUST_2026_EXCEL_BACKFILL_ID,
    assignedAt: result.startedAt ?? NOW,
    updatedAt: result.updatedAt,
    vehicle: extras.vehicle ?? { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
    routeSnapshot: {
      route: result.route,
      stops: result.stops,
      shipmentLines: snapshot.shipmentLines,
    },
  };
}

describe('August 2026 Excel trip-sheet backfill catalog', () => {
  it('uses a distinct one-shot flag and the documented UI route id', () => {
    expect(AUGUST_2026_EXCEL_BACKFILL_ID).toBe('august-2026-excel-backfill-v1');
    expect(AUGUST_2026_EXCEL_BACKFILL_ID).not.toBe(FUEL_AUGUST_2026_MIGRATION_ID);
    expect(AUGUST_2026_EXCEL_BACKFILL_ID).not.toBe(TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID);
    expect(EXISTING_UI_ROUTE_ID).toBe('route-1788407220642-xh5w5ldr');
    expect(EXISTING_UI_ROUTE_DATE).toBe('2026-08-03');
  });

  it('loads per-day Excel files and ignores legacy combined dumps', () => {
    const directory = resolveAugustBackfillDirectory();
    expect(directory).toContain('scripts/august-2026-backfill');
    const catalog = loadAugust2026ExcelBackfillCatalog(directory);
    expect(catalog.days.filter((day) => day.kind === 'excel')).toHaveLength(AUGUST_2026_EXCEL_DAY_FILES.length);
    expect(catalog.days.filter((day) => day.kind === 'stub')).toHaveLength(3);
    expect(catalog.existingUiRoute.routeId).toBe(EXISTING_UI_ROUTE_ID);

    const byFile = Object.fromEntries(catalog.days.filter((day) => day.kind === 'excel').map((day) => [day.sourceFile, day]));
    expect(byFile['karolis-03.json']?.stops).toHaveLength(37);
    expect(byFile['karolis-04.json']?.stops).toHaveLength(10);
    expect(byFile['karolis-05.json']?.stops).toHaveLength(25);
    expect(byFile['karolis-10.json']?.stops).toHaveLength(28);
    expect(byFile['karolis-11.json']?.stops).toHaveLength(25);
    expect(byFile['karolis-12.json']?.stops).toHaveLength(11);
    expect(byFile['aleksandras-11.json']).toMatchObject({ date: '2026-08-11', vehicle: 'LRI741' });
    expect(byFile['aleksandras-11.json']?.stops).toHaveLength(4);
    expect(byFile['aleksandras-14.json']?.vehicle).toBe('NLL182');
    expect(byFile['aleksandras-19.json']).toMatchObject({ date: '2026-08-19', vehicle: 'MET630' });
    expect(byFile['aleksandras-19.json']?.stops).toHaveLength(14);

    expect(AUGUST_2026_LEGACY_COMBINED_FILES).toEqual(['karolis.json', 'aleksandras.json']);
    expect(catalog.days.some((day) => day.sourceFile === 'karolis.json')).toBe(false);
    expect(catalog.days.some((day) => day.sourceFile === 'aleksandras.json')).toBe(false);
  });

  it('invents a single R56 Šiauliai placeholder for stub days and skips the listed Karolis days', () => {
    expect(AUGUST_2026_STUB_PLACEHOLDER.geocodeQuery).toBe('Vilniaus g. 125, Šiauliai, Lietuva');
    expect(AUGUST_2026_STUB_PLACEHOLDER.reason).toContain('R56');
    expect(readme).toContain('Vilniaus g. 125, Šiauliai');
    expect(readme).not.toContain('Tiekėjų g. 7');

    const stub = inventStubStop({ date: '2026-08-09', routes: 'R56', weightKg: 1500 });
    expect(stub).toMatchObject({
      orderNo: stubOrderNumber('2026-08-09'),
      weightKg: 1500,
      routeCode: 'R56',
      name: AUGUST_2026_STUB_PLACEHOLDER.name,
    });
    expect(excelAddressToGeocodeQuery(stub.address)).toBe(AUGUST_2026_STUB_PLACEHOLDER.geocodeQuery);

    const catalog = loadAugust2026ExcelBackfillCatalog();
    expect(isAugust2026SkipDay(catalog.skips, '2026-08-13', 'Karolis Tautkus')).toBe(true);
    expect(isAugust2026SkipDay(catalog.skips, '2026-08-16', 'Karolis Tautkus')).toBe(true);
    expect(isAugust2026SkipDay(catalog.skips, '2026-08-25', 'Karolis Tautkus')).toBe(true);
    expect(isAugust2026SkipDay(catalog.skips, '2026-08-13', 'Aleksandras Arsenij')).toBe(false);
    expect(catalog.days.some((day) => day.date === '2026-08-25' && day.driver === 'Karolis Tautkus')).toBe(false);
  });

  it('resolves live drivers and plates by name without inventing missing fleet', () => {
    const users = [
      { id: 'k1', displayName: 'Karolis Tautkus', role: 'driver', disabled: false },
      { id: 'a1', displayName: 'Aleksandras Arsenij', role: 'driver', disabled: false },
      { id: 'admin', displayName: 'Karolis Admin', role: 'admin', disabled: false },
    ];
    expect(matchDriverByName(users, 'Karolis Tautkus')?.id).toBe('k1');
    expect(matchDriverByName(users, 'Aleksandras Arsenij')?.id).toBe('a1');
    expect(matchDriverByName(users, 'Erikas Aškelovičius')).toBeNull();
    expect(matchVehicleByPlate([
      { id: 'MET630', registrationNumber: 'MET630' },
      { id: 'NLL182', registrationNumber: 'NLL 182' },
    ], 'nll182')?.id).toBe('NLL182');
    expect(matchVehicleByPlate([{ id: 'MET630', registrationNumber: 'MET630' }], 'LRI740')).toBeNull();
  });
});

describe('August 2026 Excel backfill decisions and snapshots', () => {
  const catalog = loadAugust2026ExcelBackfillCatalog();
  const karolis03 = catalog.days.find((day) => day.sourceFile === 'karolis-03.json')!;
  const karolis04 = catalog.days.find((day) => day.sourceFile === 'karolis-04.json')!;
  const stub09 = catalog.days.find((day) => day.date === '2026-08-09')!;

  it('historically completes the existing UI route instead of duplicating 08-03', () => {
    const assigned = liteAssignmentFromSnapshot({
      id: 'ui-assignment-1',
      routeId: EXISTING_UI_ROUTE_ID,
      driverId: 'k1',
      driverName: 'Karolis Tautkus',
      status: 'assigned',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: EXISTING_UI_ROUTE_ID, date: '2026-08-03' },
      stops: Array.from({ length: 22 }, (_, index) => ({ order_number: `UI${index}` })),
    });
    expect(decideAugustBackfillDayAction({
      day: karolis03,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'MET630',
      assignments: [assigned],
    })).toMatchObject({ action: 'complete_existing_ui', assignmentId: 'ui-assignment-1' });

    const completedOnDay = {
      ...assigned,
      status: 'completed',
      workDate: '2026-08-03',
    };
    expect(decideAugustBackfillDayAction({
      day: karolis03,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'MET630',
      assignments: [completedOnDay],
    })).toMatchObject({ action: 'skip', reason: 'existing_ui_already_historically_completed' });

    const completedWrongDay = {
      ...assigned,
      status: 'completed',
      workDate: '2026-09-03',
      routeDate: '2026-08-03',
    };
    expect(decideAugustBackfillDayAction({
      day: karolis03,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'MET630',
      assignments: [completedWrongDay],
    })).toMatchObject({ action: 'rewrite_existing_ui', assignmentId: 'ui-assignment-1' });

    expect(decideAugustBackfillDayAction({
      day: karolis03,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'MET630',
      assignments: [],
    })).toMatchObject({ action: 'create', reason: 'existing_ui_missing_create_from_excel' });
  });

  it('skips an existing completed same-driver sheet and a wrong-driver sheet with the same stops', () => {
    const existing = liteAssignmentFromSnapshot({
      id: 'already-there',
      routeId: 'route-other',
      driverId: 'k1',
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: 'route-other', date: '2026-08-04', started_at: '2026-08-04T06:00:00.000+03:00' },
      stops: karolis04.stops.map((stop) => ({ order_number: stop.orderNo })),
    });
    expect(decideAugustBackfillDayAction({
      day: karolis04,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'MET630',
      assignments: [existing],
    })).toMatchObject({ action: 'skip', reason: 'already_exists_same_driver_vehicle_date' });

    const wrongDriver = liteAssignmentFromSnapshot({
      id: 'wrong-driver-sheet',
      routeId: 'route-wrong',
      driverId: 'someone-else',
      driverName: 'Kitas',
      status: 'completed',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: 'route-wrong', date: '2026-08-04', started_at: '2026-08-04T06:00:00.000+03:00' },
      stops: [{ order_number: karolis04.stops[0]!.orderNo }],
    });
    expect(decideAugustBackfillDayAction({
      day: karolis04,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'MET630',
      assignments: [wrongDriver],
    })).toMatchObject({ action: 'skip', reason: 'wrong_driver_completed_sheet:wrong-driver-sheet' });

    expect(decideAugustBackfillDayAction({
      day: stub09,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: null,
      assignments: [],
    })).toMatchObject({ action: 'skip', reason: 'vehicle_missing' });
  });

  it('builds a planned snapshot in Excel order with null planned distance and historically completes it on that LT day', () => {
    const timestamps = historicalWorkdayTimestamps('2026-08-04');
    expect(lithuanianDateKey(timestamps.startedAt)).toBe('2026-08-04');
    expect(lithuanianDateKey(timestamps.completedAt)).toBe('2026-08-04');

    const query = excelAddressToGeocodeQuery(karolis04.stops[0]!.address);
    expect(query).toMatch(/Gedimino g\.9/i);
    const geocodes = new Map([
      [query, { normalizedAddress: 'Gedimino g. 9, Radviliškis, Lietuva', latitude: 55.8, longitude: 23.5 }],
    ]);
    const routeId = augustBackfillRouteId(karolis04);
    const snapshot = buildAugustBackfillRouteSnapshot(karolis04, geocodes, routeId, NOW);
    expect(snapshot.route).toMatchObject({
      id: routeId,
      date: '2026-08-04',
      status: 'planned',
      estimated_distance_km: null,
      actual_distance_km: null,
      total_stops: 10,
    });
    expect(snapshot.stops.map((stop) => stop.order_number)).toEqual(karolis04.stops.map((stop) => stop.orderNo));
    expect(snapshot.stops[0]).toMatchObject({
      latitude: 55.8,
      longitude: 23.5,
      delivery_time_from: '08:00',
      delivery_time_to: '14:00',
    });
    expect(snapshot.shipmentLines[0]).toMatchObject({ route_code: 'R36', order_number: karolis04.stops[0]!.orderNo });

    const completed = applyAdminAssignmentComplete(snapshot, {
      startedAt: timestamps.startedAt,
      completedAt: timestamps.completedAt,
      markAllDelivered: true,
    }, NOW);
    expect(completed.stops.every((stop) => stop.delivery_status === 'delivered')).toBe(true);
    expect(completed.summary).toMatchObject({ deliveredStops: 10, plannedDistanceKm: null });

    const sheet = buildServerTripSheet(assignmentFromDay(snapshot, completed), {
      id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500,
    });
    expect(sheet.date).toBe('2026-08-04');
    expect(sheet.deliveredStops).toBe(10);
    expect(tripSheetWorkDate(assignmentFromDay(snapshot, completed))).toBe('2026-08-04');

    const overlay = applyDayReading(sheet, [{
      id: 'MET630:2026-08-04',
      vehicleId: 'MET630',
      registrationNumber: 'MET630',
      date: '2026-08-04',
      startOdometer: 1000,
      endOdometer: 1617,
      distanceKm: 617,
      extraDistanceKm: 0,
      driverId: 'k1',
      driverName: 'Karolis Tautkus',
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'test',
    }]);
    expect(overlay.actualDistanceKm).toBe(617);
    expect(overlay.plannedDistanceKm).toBeNull();
  });

  it('geocodes unique addresses once and never builds an n² matrix', () => {
    const lookup = vi.fn(async (query: string) => ({
      normalizedAddress: query,
      latitude: 55.9,
      longitude: 23.3,
    }));
    const cached = createCachedGeocoder(lookup);
    const queries = uniqueGeocodeQueries([karolis04, stub09]);
    expect(queries).toContain(AUGUST_2026_STUB_PLACEHOLDER.geocodeQuery);
    expect(new Set(queries).size).toBe(queries.length);

    return geocodeQueriesCached(queries, cached, 3).then(async (results) => {
      expect(lookup.mock.calls.length).toBe(queries.length);
      await cached(queries[0]!);
      await cached(queries[0]!);
      expect(lookup.mock.calls.length).toBe(queries.length);
      expect(results.get(queries[0]!)?.latitude).toBe(55.9);
      const backfillBlock = storeSource.slice(
        storeSource.indexOf('async applyAugust2026ExcelBackfill'),
        storeSource.indexOf('/** Retained for tests/catalog helpers; not called from listTripSheets. */'),
      );
      expect(backfillBlock).not.toMatch(/distancematrix|\/v1\/matrix|computeRouteMatrix/i);
      expect(backfillBlock).not.toContain('this.assignVehicle');
      expect(backfillBlock).not.toContain('await this.assignVehicle');
    });
  });
});

describe('August 2026 Excel backfill Cloud Run wiring', () => {
  it('runs after fuel v2/v3/v4 and the vehicle-fix on boot, and never from listTripSheets', () => {
    expect(storeSource).toContain('async applyAugust2026ExcelBackfill');
    expect(storeSource).toContain('AUGUST_2026_EXCEL_BACKFILL_ID');
    expect(storeSource).toContain("from '../src/domain/august-2026-excel-backfill.js'");
    expect(storeSource).toContain('do not call assignVehicle');
    expect(storeSource).toContain('markAllDelivered: true');
    expect(apiSource).toContain('export function ensureAugust2026ExcelBackfillMigrated');
    expect(apiSource).toContain('await ensureAugust2026ExcelBackfillMigrated()');
    expect(productionServer).toContain('await ensureAugust2026ExcelBackfillMigrated()');
    expect(productionServer.indexOf('await ensureFuelAugust2026Migrated()'))
      .toBeLessThan(productionServer.indexOf('await ensureTripSheetAugust2026VehicleFixMigrated()'));
    expect(productionServer.indexOf('await ensureTripSheetAugust2026VehicleFixMigrated()'))
      .toBeLessThan(productionServer.indexOf('await ensureAugust2026ExcelBackfillMigrated()'));
    expect(dockerfile).toContain('scripts/august-2026-backfill');

    const listTripSheetsBlock = storeSource.slice(
      storeSource.indexOf('async listTripSheets'),
      storeSource.indexOf('async upsertVehicleDayReading'),
    );
    expect(listTripSheetsBlock).not.toContain('applyAugust2026ExcelBackfill');
    expect(listTripSheetsBlock).not.toContain('applyFuelAugust2026V2Migration');
    expect(listTripSheetsBlock).not.toContain('applyTripSheetAugust2026VehicleFix');
  });
});
