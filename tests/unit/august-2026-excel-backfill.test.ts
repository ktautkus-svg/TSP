import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  AUGUST_2026_ALEKSANDRAS_0819_ASSIGNMENT_ID,
  AUGUST_2026_ALEKSANDRAS_0819_ROUTES,
  AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
  AUGUST_2026_ALEKSANDRAS_NAME_CANDIDATES,
  AUGUST_2026_DUAL_SHEET_DATE,
  AUGUST_2026_ERIKAS_0831_DATE,
  AUGUST_2026_ERIKAS_0831_ROUTES,
  AUGUST_2026_ENSURE_FLEET_PLATES,
  AUGUST_2026_LRI740_FUEL_NORM_L_PER_100KM,
  AUGUST_2026_LRI740_OPENING_DATE,
  AUGUST_2026_LRI740_OPENING_LITERS,
  AUGUST_2026_LRI740_OPENING_REPORT_ID,
  AUGUST_2026_LRI740_TANK_LITERS,
  AUGUST_2026_LRI741_FUEL_NORM_L_PER_100KM,
  AUGUST_2026_LRI741_TANK_LITERS,
  assignmentNeedsStubStopRewrite,
  august2026EnsureFleetPlateSpecs,
  august2026EnsureFleetVehicleCreateInput,
  AUGUST_2026_EXCEL_BACKFILL_ID,
  AUGUST_2026_EXCEL_BACKFILL_V2_ID,
  AUGUST_2026_EXCEL_BACKFILL_V3_ID,
  AUGUST_2026_EXCEL_BACKFILL_V4_ID,
  AUGUST_2026_EXCEL_DAY_FILES,
  AUGUST_2026_KAROLIS_0819_ROUTES,
  AUGUST_2026_LEGACY_COMBINED_FILES,
  AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
  AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
  AUGUST_2026_STUB_PLACEHOLDER,
  EXISTING_UI_ROUTE_DATE,
  EXISTING_UI_ROUTE_ID,
  augustBackfillRouteId,
  buildAugustBackfillRouteSnapshot,
  createCachedGeocoder,
  decideAugustBackfillDayAction,
  decideAugustBackfillV2GapAction,
  decideAugustBackfillV3GapAction,
  decideAugustBackfillV4DriverSync,
  excelAddressToGeocodeQuery,
  geocodeQueriesCached,
  historicalWorkdayTimestamps,
  inventStubStop,
  isAleksandras0819Met630RouteSet,
  isAleksandras0819Met630Target,
  isAugust2026ExcelBackfillV2GapDay,
  isAugust2026ExcelBackfillV3GapDay,
  isAugust2026ProtectedR56StubAssignment,
  isAugust2026SkipDay,
  isErikas0831Nll182Assignment,
  isKarolis0809Lri740Assignment,
  isKarolis0819R54R11Assignment,
  karolis0819NeedsNll182Move,
  karolisAugust19Nll182VehicleFix,
  liteAssignmentFromSnapshot,
  loadAugust2026ExcelBackfillCatalog,
  matchAleksandrasDriver,
  matchDriverByName,
  matchErikasDriver,
  needsTripSheetListedDriverSync,
  matchVehicleByPlate,
  needsAleksandras0819DriverPatch,
  resolveAugustBackfillDirectory,
  resolveAugustBackfillVehicle,
  snapshotFleetVehicleFromPlate,
  stubOrderNumber,
  uniqueGeocodeQueries,
  visibleBackfillStopCount,
} from '../../src/domain/august-2026-excel-backfill';
import {
  applyDayReading,
  applyTripSheetDriverCorrectionToDayReading,
  applyTripSheetVehicleDriverCorrection,
  buildServerTripSheet,
  listedTripSheetDriver,
  tripSheetWorkDate,
  type RouteAssignment,
  type VehicleDayReading,
} from '../../server/employee-auth-store';
import { applyAdminAssignmentComplete } from '../../src/domain/historical-assignment-complete';
import { lithuanianDateKey } from '../../src/domain/lithuanian-time';
import { FUEL_AUGUST_2026_MIGRATION_ID } from '../../src/domain/excel-fuel-log';
import {
  ERIKAS_ASKELOVICIUS_DISPLAY_NAME,
  ERIKAS_ASKELOVICIUS_DRIVER_ID,
  KAROLIS_TAUTKUS_DRIVER_ID,
  TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID,
} from '../../src/domain/trip-sheet-august-2026-vehicle-fix';

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
    expect(AUGUST_2026_EXCEL_BACKFILL_V2_ID).toBe('august-2026-excel-backfill-v2');
    expect(AUGUST_2026_EXCEL_BACKFILL_V3_ID).toBe('august-2026-excel-backfill-v3');
    expect(AUGUST_2026_EXCEL_BACKFILL_V2_ID).not.toBe(AUGUST_2026_EXCEL_BACKFILL_ID);
    expect(AUGUST_2026_EXCEL_BACKFILL_V3_ID).not.toBe(AUGUST_2026_EXCEL_BACKFILL_V2_ID);
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

  it('resolves live drivers and plates by name, and snapshots missing LRI plates', () => {
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
    expect(matchVehicleByPlate([{ id: 'MET630', registrationNumber: 'MET630' }], 'LRI741')).toBeNull();

    const missingLri741 = resolveAugustBackfillVehicle([{ id: 'MET630', registrationNumber: 'MET630' }], 'LRI741');
    expect(missingLri741).toMatchObject({
      source: 'snapshot',
      vehicle: {
        id: 'LRI741',
        registrationNumber: 'LRI741',
        model: AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
        maximumPayloadKg: AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
        palletCapacity: 8,
        hasSideDoor: false,
      },
    });
    const missingLri740 = snapshotFleetVehicleFromPlate('LRI740');
    expect(missingLri740).toMatchObject({
      id: 'LRI740',
      registrationNumber: 'LRI740',
      palletCapacity: 8,
      hasSideDoor: true,
      fuelTankCapacityLiters: AUGUST_2026_LRI740_TANK_LITERS,
      fuelNormLPer100Km: AUGUST_2026_LRI740_FUEL_NORM_L_PER_100KM,
    });
    expect(august2026EnsureFleetPlateSpecs('LRI740')).toEqual({
      fuelNormLPer100Km: 15,
      fuelTankCapacityLiters: 100,
    });
    expect(august2026EnsureFleetPlateSpecs('LRI741')).toEqual({
      fuelNormLPer100Km: AUGUST_2026_LRI741_FUEL_NORM_L_PER_100KM,
      fuelTankCapacityLiters: AUGUST_2026_LRI741_TANK_LITERS,
    });
    expect(august2026EnsureFleetVehicleCreateInput('LRI741')).toMatchObject({
      registrationNumber: 'LRI741',
      model: AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
      maximumPayloadKg: AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
      palletCapacity: 8,
      hasSideDoor: false,
      cargoBodyKind: 'van_8pll',
      fuelNormLPer100Km: 15,
      fuelTankCapacityLiters: 100,
    });
    expect(AUGUST_2026_LRI740_OPENING_LITERS).toBe(13);
    expect(AUGUST_2026_LRI740_OPENING_DATE).toBe('2026-08-08');
    expect(AUGUST_2026_LRI740_OPENING_REPORT_ID).toBe('open-LRI740-20260808');
    expect(AUGUST_2026_ENSURE_FLEET_PLATES).toEqual(['LRI740', 'LRI741']);
    expect(resolveAugustBackfillVehicle([
      { id: 'NLL182', registrationNumber: 'NLL 182' },
    ], 'nll182')).toMatchObject({ source: 'fleet', vehicle: { id: 'NLL182' } });
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

    expect(decideAugustBackfillDayAction({
      day: stub09,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'LRI740',
      assignments: [],
    })).toMatchObject({ action: 'create', routeId: augustBackfillRouteId(stub09) });
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
      expect(backfillBlock).toContain('async applyAugust2026ExcelBackfillV2');
      expect(backfillBlock).toContain('async applyAugust2026ExcelBackfillV3');
      expect(backfillBlock).toContain('async applyAugust2026ExcelBackfillV4');
      expect(backfillBlock).not.toMatch(/distancematrix|\/v1\/matrix|computeRouteMatrix/i);
      expect(backfillBlock).not.toContain('this.assignVehicle');
      expect(backfillBlock).not.toContain('await this.assignVehicle');
    });
  });
});

describe('August 2026 Excel backfill Cloud Run wiring', () => {
  it('runs after fuel v2/v3/v4 and the vehicle-fix on boot, and never from listTripSheets', () => {
    expect(storeSource).toContain('async applyAugust2026ExcelBackfill');
    expect(storeSource).toContain('async applyAugust2026ExcelBackfillV2');
    expect(storeSource).toContain('async applyAugust2026ExcelBackfillV3');
    expect(storeSource).toContain('async applyAugust2026ExcelBackfillV4');
    expect(storeSource).toContain('AUGUST_2026_EXCEL_BACKFILL_ID');
    expect(storeSource).toContain('AUGUST_2026_EXCEL_BACKFILL_V2_ID');
    expect(storeSource).toContain('AUGUST_2026_EXCEL_BACKFILL_V3_ID');
    expect(storeSource).toContain('AUGUST_2026_EXCEL_BACKFILL_V4_ID');
    expect(storeSource).toContain("from '../src/domain/august-2026-excel-backfill.js'");
    expect(storeSource).toContain('do not call assignVehicle');
    expect(storeSource).toContain('markAllDelivered: true');
    expect(storeSource).toContain('await this.updateTripSheet(karolis0819.id, { vehicleId: nll.id })');
    expect(storeSource).toContain("await this.updateTripSheet(assignment.id, { driverId: aleksandras.id })");
    expect(storeSource).toContain('ensureLri740AugustOpeningFuel');
    expect(storeSource).toContain('ensureAugustBackfillFleetPlatesStrict');
    expect(storeSource).toContain('AUGUST_2026_LRI740_OPENING_REPORT_ID');
    expect(storeSource).toContain('august2026EnsureFleetPlateSpecs(plate)');
    expect(storeSource).toContain('august2026EnsureFleetVehicleCreateInput(plate)');
    expect(apiSource).toContain('export function ensureAugust2026ExcelBackfillMigrated');
    expect(apiSource).toContain('await store.applyAugust2026ExcelBackfill()');
    expect(apiSource).toContain('await store.applyAugust2026ExcelBackfillV2()');
    expect(apiSource).toContain('await store.applyAugust2026ExcelBackfillV3()');
    expect(apiSource).toContain('await store.applyAugust2026ExcelBackfillV4()');
    expect(apiSource.indexOf('await store.applyAugust2026ExcelBackfill()'))
      .toBeLessThan(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV2()'));
    expect(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV2()'))
      .toBeLessThan(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV3()'));
    expect(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV3()'))
      .toBeLessThan(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV4()'));
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
    expect(listTripSheetsBlock).not.toContain('applyAugust2026ExcelBackfillV2');
    expect(listTripSheetsBlock).not.toContain('applyAugust2026ExcelBackfillV3');
    expect(listTripSheetsBlock).not.toContain('applyAugust2026ExcelBackfillV4');
    expect(listTripSheetsBlock).not.toContain('ensureLri740AugustOpeningFuel');
    expect(listTripSheetsBlock).not.toContain('applyFuelAugust2026V2Migration');
    expect(listTripSheetsBlock).not.toContain('applyTripSheetAugust2026VehicleFix');
  });
});

describe('August 2026 Excel backfill v2 gap fill', () => {
  const catalog = loadAugust2026ExcelBackfillCatalog();
  const aleks11 = catalog.days.find((day) => day.sourceFile === 'aleksandras-11.json')!;
  const aleks19 = catalog.days.find((day) => day.sourceFile === 'aleksandras-19.json')!;
  const stub09 = catalog.days.find((day) => day.date === '2026-08-09')!;

  it('targets the three verification gaps and the dual 08-19 fact', () => {
    expect(aleks11).toMatchObject({ date: '2026-08-11', driver: 'Aleksandras Arsenij', vehicle: 'LRI741' });
    expect(aleks11.stops.map((stop) => stop.orderNo)).toEqual(['S607679', 'S608420', 'S608152š', 'S607647']);
    expect(aleks19).toMatchObject({
      date: AUGUST_2026_DUAL_SHEET_DATE,
      driver: 'Aleksandras Arsenij',
      vehicle: 'MET630',
      metaRoutes: 'R14;R27;R28;R51',
    });
    expect([...new Set(aleks19.stops.map((stop) => stop.routeCode))].sort()).toEqual(
      [...AUGUST_2026_ALEKSANDRAS_0819_ROUTES],
    );
    expect(stub09).toMatchObject({ date: '2026-08-09', driver: 'Karolis Tautkus', vehicle: 'LRI740', kind: 'stub' });
    expect(stub09.stops).toHaveLength(1);
    expect(stub09.stops[0]).toMatchObject({ routeCode: 'R56', weightKg: 1500 });

    expect(catalog.days.filter((day) => isAugust2026ExcelBackfillV2GapDay(day))).toHaveLength(3);
    expect(isAugust2026ExcelBackfillV2GapDay(catalog.days.find((day) => day.sourceFile === 'karolis-04.json')!)).toBe(false);
    expect(readme).toContain('august-2026-excel-backfill-v2');
    expect(readme).toContain('LRI741');
    expect(readme).toContain('R54;R11');
  });

  it('creates Aleksandras 08-11 / 08-19 and the Karolis 08-09 stub once the plate is snapshot or in fleet', () => {
    expect(decideAugustBackfillV2GapAction({
      day: aleks11,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'LRI741',
      assignments: [],
    })).toMatchObject({ action: 'create', routeId: augustBackfillRouteId(aleks11) });

    expect(decideAugustBackfillV2GapAction({
      day: stub09,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'LRI740',
      assignments: [],
    })).toMatchObject({ action: 'create', routeId: augustBackfillRouteId(stub09) });

    const already = liteAssignmentFromSnapshot({
      id: 'aleks-11-done',
      routeId: augustBackfillRouteId(aleks11),
      driverId: 'a1',
      driverName: 'Aleksandras Arsenij',
      status: 'completed',
      vehicle: { id: 'LRI741', registrationNumber: 'LRI741' },
      route: { id: augustBackfillRouteId(aleks11), date: '2026-08-11', started_at: '2026-08-11T06:00:00.000+03:00' },
      stops: aleks11.stops.map((stop) => ({ order_number: stop.orderNo, notes: stop.routeCode })),
    });
    expect(decideAugustBackfillV2GapAction({
      day: aleks11,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'LRI741',
      assignments: [already],
    })).toMatchObject({ action: 'skip', reason: 'already_exists_same_driver_vehicle_date' });
  });

  it('keeps both 08-19 sheets and PATCHes Karolis R54;R11 off MET630 without rewriting stops', () => {
    const fix = karolisAugust19Nll182VehicleFix();
    expect(fix).toMatchObject({
      assignmentId: '1ed83dca-de72-413f-8d70-dc2845ee76df',
      factDate: '2026-08-19',
      registrationNumber: 'NLL182',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      factRouteNumbers: [...AUGUST_2026_KAROLIS_0819_ROUTES],
    });

    const karolisOnMet = liteAssignmentFromSnapshot({
      id: fix.assignmentId,
      routeId: 'route-karolis-0819',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: 'route-karolis-0819', date: '2026-08-19', started_at: '2026-08-19T06:00:00.000+03:00' },
      stops: [
        { order_number: 'R54-1', notes: 'R54' },
        { order_number: 'R11-1', notes: 'R11' },
      ],
      shipmentLines: [
        { route_code: 'R54', order_number: 'R54-1' },
        { route_code: 'R11', order_number: 'R11-1' },
      ],
    });
    expect(isKarolis0819R54R11Assignment(karolisOnMet)).toBe(true);
    expect(karolis0819NeedsNll182Move(karolisOnMet)).toBe(true);
    expect(karolis0819NeedsNll182Move({ ...karolisOnMet, vehiclePlate: 'NLL182', vehicleId: 'NLL182' })).toBe(false);

    expect(decideAugustBackfillV2GapAction({
      day: aleks19,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'MET630',
      assignments: [karolisOnMet],
    })).toMatchObject({ action: 'create', reason: 'create_from_excel', routeId: augustBackfillRouteId(aleks19) });

    expect(decideAugustBackfillDayAction({
      day: aleks19,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'MET630',
      assignments: [karolisOnMet],
    })).toMatchObject({ action: 'create', reason: 'create_from_excel' });

    const overlappingKarolis = {
      ...karolisOnMet,
      orderNumbers: [aleks19.stops[0]!.orderNo],
    };
    expect(decideAugustBackfillDayAction({
      day: aleks19,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'MET630',
      assignments: [overlappingKarolis],
    })).toMatchObject({ action: 'skip' });
    expect(decideAugustBackfillV2GapAction({
      day: aleks19,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'MET630',
      assignments: [overlappingKarolis],
    })).toMatchObject({ action: 'create', reason: 'create_dual_sheet_2026_08_19' });

    const stops = [
      {
        order_number: 'R54-1',
        delivery_status: 'delivered',
        delivered_at: '2026-08-19T08:12:00.000Z',
        delivery_time_from: '08:00',
        delivery_time_to: '14:00',
        notes: 'R54',
      },
      {
        order_number: 'R11-1',
        delivery_status: 'delivered',
        delivered_at: '2026-08-19T11:40:00.000Z',
        delivery_time_from: '08:00',
        delivery_time_to: '14:00',
        notes: 'R11',
      },
    ];
    const shipmentLines = [
      { route_code: 'R54', order_number: 'R54-1' },
      { route_code: 'R11', order_number: 'R11-1' },
    ];
    const patched = applyTripSheetVehicleDriverCorrection({
      id: fix.assignmentId,
      routeId: 'route-karolis-0819',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      progress: { totalStops: 2, completedStops: 2, remainingStops: 0, percent: 100 },
      createdBy: 'ui',
      assignedAt: '2026-08-19T03:00:00.000Z',
      updatedAt: '2026-08-19T13:30:00.000Z',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-karolis-0819',
          date: '2026-08-19',
          status: 'completed',
          started_at: '2026-08-19T03:00:00.000Z',
          completed_at: '2026-08-19T13:30:00.000Z',
        },
        stops,
        shipmentLines,
      },
    }, {
      startOdometer: null,
      endOdometer: null,
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      vehicle: { id: 'NLL182', registrationNumber: 'NLL182', model: 'Renault Master', maximumPayloadKg: 1500 },
      updatedAt: NOW,
    });
    expect(patched.vehicle).toMatchObject({ id: 'NLL182', registrationNumber: 'NLL182' });
    expect(patched.routeSnapshot.stops).toBe(stops);
    expect(patched.routeSnapshot.shipmentLines).toBe(shipmentLines);
    expect(patched.routeSnapshot.stops[0]).toMatchObject({
      delivered_at: '2026-08-19T08:12:00.000Z',
      delivery_status: 'delivered',
    });
  });
});

describe('August 2026 Excel backfill v3 gap fill', () => {
  const catalog = loadAugust2026ExcelBackfillCatalog();
  const aleks11 = catalog.days.find((day) => day.sourceFile === 'aleksandras-11.json')!;
  const aleks19 = catalog.days.find((day) => day.sourceFile === 'aleksandras-19.json')!;
  const stub09 = catalog.days.find((day) => day.date === '2026-08-09')!;

  it('keeps a distinct v3 flag and the same three verification gaps', () => {
    expect(AUGUST_2026_EXCEL_BACKFILL_V3_ID).toBe('august-2026-excel-backfill-v3');
    expect(catalog.days.filter((day) => isAugust2026ExcelBackfillV3GapDay(day))).toHaveLength(3);
    expect(isAugust2026ExcelBackfillV3GapDay(aleks11)).toBe(true);
    expect(isAugust2026ExcelBackfillV3GapDay(aleks19)).toBe(true);
    expect(isAugust2026ExcelBackfillV3GapDay(stub09)).toBe(true);
    expect(AUGUST_2026_LRI741_TANK_LITERS).toBe(100);
    expect(AUGUST_2026_LRI741_FUEL_NORM_L_PER_100KM).toBe(15);
    expect(AUGUST_2026_ALEKSANDRAS_NAME_CANDIDATES).toContain('Aleksandras Arsenij');
    expect(readme).toContain('august-2026-excel-backfill-v3');
    expect(readme).toContain('driverId');
  });

  it('matches Aleksandras by first name when the surname spelling differs', () => {
    expect(matchAleksandrasDriver([
      { id: 'a1', displayName: 'Aleksandras Arsenijus', role: 'driver', disabled: false },
      { id: 'k1', displayName: 'Karolis Tautkus', role: 'driver', disabled: false },
    ])?.id).toBe('a1');
    expect(matchAleksandrasDriver([
      { id: 'k1', displayName: 'Karolis Tautkus', role: 'driver', disabled: false },
    ])).toBeNull();
  });

  it('PATCHes MET630 08-19 R14;R27;R28;R51 from Karolis to Aleksandras and does not create a second sheet', () => {
    const met630WrongDriver = liteAssignmentFromSnapshot({
      id: 'met630-0819-wrong-driver',
      routeId: 'route-met630-0819',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: 'route-met630-0819', date: '2026-08-19', started_at: '2026-08-19T06:00:00.000+03:00' },
      stops: aleks19.stops.map((stop) => ({
        order_number: stop.orderNo,
        notes: stop.routeCode,
        address: stop.address,
        recipient: stop.name,
        delivered_at: '2026-08-19T08:00:00.000Z',
        delivery_time_from: '06:00',
        delivery_time_to: '15:00',
      })),
      shipmentLines: aleks19.stops.map((stop) => ({ route_code: stop.routeCode, order_number: stop.orderNo })),
    });
    expect(isAleksandras0819Met630RouteSet(met630WrongDriver)).toBe(true);
    expect(needsAleksandras0819DriverPatch(met630WrongDriver, 'a1')).toBe(true);
    expect(needsAleksandras0819DriverPatch({ ...met630WrongDriver, driverId: 'a1', driverName: 'Aleksandras Arsenij' }, 'a1')).toBe(false);

    const karolisNll = liteAssignmentFromSnapshot({
      id: karolisAugust19Nll182VehicleFix().assignmentId,
      routeId: 'route-karolis-0819-nll',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'NLL182', registrationNumber: 'NLL182' },
      route: { id: 'route-karolis-0819-nll', date: '2026-08-19', started_at: '2026-08-19T06:00:00.000+03:00' },
      stops: [
        { order_number: 'R54-1', notes: 'R54' },
        { order_number: 'R11-1', notes: 'R11' },
      ],
      shipmentLines: [
        { route_code: 'R54', order_number: 'R54-1' },
        { route_code: 'R11', order_number: 'R11-1' },
      ],
    });
    expect(isKarolis0819R54R11Assignment(karolisNll)).toBe(true);
    expect(karolis0819NeedsNll182Move(karolisNll)).toBe(false);
    expect(needsAleksandras0819DriverPatch(karolisNll, 'a1')).toBe(false);

    expect(decideAugustBackfillV3GapAction({
      day: aleks19,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'MET630',
      assignments: [met630WrongDriver, karolisNll],
    })).toMatchObject({ action: 'skip', reason: 'met630_0819_will_patch_driver' });

    const patched = applyTripSheetVehicleDriverCorrection({
      id: met630WrongDriver.id,
      routeId: 'route-met630-0819',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      progress: { totalStops: 14, completedStops: 14, remainingStops: 0, percent: 100 },
      createdBy: 'ui',
      assignedAt: '2026-08-19T03:00:00.000Z',
      updatedAt: '2026-08-19T13:30:00.000Z',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-met630-0819',
          date: '2026-08-19',
          status: 'completed',
          started_at: '2026-08-19T03:00:00.000Z',
          completed_at: '2026-08-19T13:30:00.000Z',
        },
        stops: met630WrongDriver.orderNumbers.map((orderNo, index) => ({
          order_number: orderNo,
          delivery_status: 'delivered',
          delivered_at: '2026-08-19T08:12:00.000Z',
          delivery_time_from: aleks19.stops[index]?.timeWindow.split('-')[0] ?? '06:00',
          delivery_time_to: '15:00',
          notes: aleks19.stops[index]?.routeCode,
        })),
        shipmentLines: aleks19.stops.map((stop) => ({ route_code: stop.routeCode, order_number: stop.orderNo })),
      },
    }, {
      startOdometer: null,
      endOdometer: null,
      driverId: 'a1',
      driverName: 'Aleksandras Arsenij',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      updatedAt: NOW,
    });
    expect(patched.driverId).toBe('a1');
    expect(patched.driverName).toBe('Aleksandras Arsenij');
    expect(patched.vehicle).toMatchObject({ id: 'MET630', registrationNumber: 'MET630' });
    expect(patched.routeSnapshot.stops[0]).toMatchObject({
      delivered_at: '2026-08-19T08:12:00.000Z',
      delivery_status: 'delivered',
    });
    expect(patched.routeSnapshot.shipmentLines).toHaveLength(14);
  });

  it('rewrites the 08-09 LRI740 stub when the row exists without visible stops', () => {
    expect(visibleBackfillStopCount([])).toBe(0);
    expect(visibleBackfillStopCount([{}])).toBe(0);
    expect(assignmentNeedsStubStopRewrite([])).toBe(true);
    expect(assignmentNeedsStubStopRewrite([{ order_number: stubOrderNumber('2026-08-09'), address: AUGUST_2026_STUB_PLACEHOLDER.address }])).toBe(false);

    const emptyStub = liteAssignmentFromSnapshot({
      id: 'empty-lri740-0809',
      routeId: augustBackfillRouteId(stub09),
      driverId: 'k1',
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'LRI740', registrationNumber: 'LRI740' },
      route: { id: augustBackfillRouteId(stub09), date: '2026-08-09', started_at: '2026-08-09T06:00:00.000+03:00' },
      stops: [],
    });
    expect(emptyStub.visibleStopCount).toBe(0);
    expect(decideAugustBackfillV3GapAction({
      day: stub09,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'LRI740',
      assignments: [emptyStub],
    })).toMatchObject({
      action: 'rewrite_empty_stub',
      assignmentId: 'empty-lri740-0809',
      reason: 'lri740_0809_stub_missing_stops',
    });

    const filled = liteAssignmentFromSnapshot({
      id: 'filled-lri740-0809',
      routeId: augustBackfillRouteId(stub09),
      driverId: 'k1',
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'LRI740', registrationNumber: 'LRI740' },
      route: { id: augustBackfillRouteId(stub09), date: '2026-08-09', started_at: '2026-08-09T06:00:00.000+03:00' },
      stops: [{
        order_number: stubOrderNumber('2026-08-09'),
        address: AUGUST_2026_STUB_PLACEHOLDER.address,
        recipient: AUGUST_2026_STUB_PLACEHOLDER.name,
        notes: 'R56',
        weight_kg: 1500,
      }],
    });
    expect(decideAugustBackfillV3GapAction({
      day: stub09,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'k1',
      vehicleId: 'LRI740',
      assignments: [filled],
    })).toMatchObject({ action: 'skip', reason: 'already_exists_same_driver_vehicle_date' });
  });

  it('creates Aleksandras 08-11 once LRI741 is a real fleet row', () => {
    expect(decideAugustBackfillV3GapAction({
      day: aleks11,
      skips: catalog.skips,
      existingUiRoute: catalog.existingUiRoute,
      driverId: 'a1',
      vehicleId: 'LRI741',
      assignments: [],
    })).toMatchObject({ action: 'create', routeId: augustBackfillRouteId(aleks11) });
  });

  it('does not swallow fleet-create failures and awaits v3 after v2 on boot', () => {
    const v3Fleet = storeSource.slice(
      storeSource.indexOf('ensureAugustBackfillFleetPlatesStrict'),
      storeSource.indexOf('private async rewriteAugustBackfillEmptyStub'),
    );
    expect(v3Fleet).toContain('august_2026_excel_backfill_v3_fleet_failed');
    expect(v3Fleet).toContain('throw error');
    expect(v3Fleet).not.toContain('august_2026_excel_backfill_v2_fleet_skip');
    expect(v3Fleet).toContain('created.assignedDriverId !== null');
    expect(storeSource).toContain('refusing to no-op');
    expect(storeSource).toContain('LRI741 is still missing from the fleet after create');
    expect(storeSource).toContain('Aleksandras 2026-08-11 LRI741 sheet is still missing');
    expect(storeSource).toContain('2026-08-09 LRI740 stub still has no visible stops');
    expect(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV2()'))
      .toBeLessThan(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV3()'));
    expect(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV3()'))
      .toBeLessThan(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV4()'));
    expect(productionServer).toContain('v3 does not swallow fleet-create');
  });
});

describe('August 2026 Excel backfill v4 listed-driver sync', () => {
  const catalog = loadAugust2026ExcelBackfillCatalog();
  const aleks19 = catalog.days.find((day) => day.sourceFile === 'aleksandras-19.json')!;
  const stub09 = catalog.days.find((day) => day.date === '2026-08-09')!;
  const stub13 = catalog.days.find((day) => day.date === '2026-08-13')!;
  const stub16 = catalog.days.find((day) => day.date === '2026-08-16')!;

  function met630Assignment(driverId: string, driverName: string): RouteAssignment {
    const stops = aleks19.stops.map((stop) => ({
      order_number: stop.orderNo,
      notes: stop.routeCode,
      address: stop.address,
      recipient: stop.name,
      delivery_status: 'delivered',
      delivered_at: '2026-08-19T08:12:00.000Z',
      delivery_time_from: stop.timeWindow.split('-')[0] ?? '06:00',
      delivery_time_to: '15:00',
      weight_kg: stop.weightKg,
    }));
    return {
      id: AUGUST_2026_ALEKSANDRAS_0819_ASSIGNMENT_ID,
      routeId: 'route-aug2026-aleks-0819-xlsx',
      driverId,
      driverName,
      status: 'completed',
      progress: { totalStops: 14, completedStops: 14, remainingStops: 0, percent: 100 },
      createdBy: 'august-2026-excel-backfill-v3',
      assignedAt: '2026-08-19T03:00:00.000Z',
      updatedAt: '2026-08-19T13:30:00.000Z',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-aug2026-aleks-0819-xlsx',
          date: '2026-08-19',
          status: 'completed',
          start_odometer: 279000,
          end_odometer: 279400,
          actual_distance_km: 400,
          started_at: '2026-08-19T06:00:00.000+03:00',
          completed_at: '2026-08-19T16:30:00.000+03:00',
        },
        stops,
        shipmentLines: aleks19.stops.map((stop) => ({ route_code: stop.routeCode, order_number: stop.orderNo })),
      },
    };
  }

  function met630Reading(driverId: string, driverName: string): VehicleDayReading {
    return {
      id: 'MET630:2026-08-19',
      vehicleId: 'MET630',
      registrationNumber: 'MET630',
      date: '2026-08-19',
      startOdometer: 278900,
      endOdometer: 279348,
      distanceKm: 448,
      driverId,
      driverName,
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'gps-import',
    };
  }

  it('keeps a distinct v4 flag after v3', () => {
    expect(AUGUST_2026_EXCEL_BACKFILL_V4_ID).toBe('august-2026-excel-backfill-v4');
    expect(AUGUST_2026_EXCEL_BACKFILL_V4_ID).not.toBe(AUGUST_2026_EXCEL_BACKFILL_ID);
    expect(AUGUST_2026_EXCEL_BACKFILL_V4_ID).not.toBe(AUGUST_2026_EXCEL_BACKFILL_V2_ID);
    expect(AUGUST_2026_EXCEL_BACKFILL_V4_ID).not.toBe(AUGUST_2026_EXCEL_BACKFILL_V3_ID);
    expect(AUGUST_2026_ALEKSANDRAS_0819_ASSIGNMENT_ID).toBe('eafe0680-649b-44d6-87ee-3cca734ae9ce');
    expect(AUGUST_2026_ALEKSANDRAS_DRIVER_ID).toBe('3ad054df-6d40-4279-9037-6b0e5c7abb9f');
    expect(AUGUST_2026_ERIKAS_0831_DATE).toBe('2026-08-31');
    expect(AUGUST_2026_ERIKAS_0831_ROUTES).toEqual(['R88', 'R86']);
    expect(readme).toContain('august-2026-excel-backfill-v4');
    expect(readme).toContain('applyDayReading');
  });

  it('syncs the GET /api/trip-sheets driver overlay without rewriting odometer or stops', () => {
    const assignment = met630Assignment(AUGUST_2026_ALEKSANDRAS_DRIVER_ID, 'Aleksandras Arsenij');
    const reading = met630Reading(KAROLIS_TAUTKUS_DRIVER_ID, 'Karolis Tautkus');
    const stops = assignment.routeSnapshot.stops;
    const shipmentLines = assignment.routeSnapshot.shipmentLines;

    expect(needsAleksandras0819DriverPatch(
      liteAssignmentFromSnapshot({
        id: assignment.id,
        routeId: assignment.routeId,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        status: assignment.status,
        vehicle: assignment.vehicle,
        route: assignment.routeSnapshot.route,
        stops,
        shipmentLines,
      }),
      AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
    )).toBe(false);

    const listed = listedTripSheetDriver(assignment, [reading]);
    expect(listed).toEqual({ driverId: KAROLIS_TAUTKUS_DRIVER_ID, driverName: 'Karolis Tautkus' });
    expect(applyDayReading(buildServerTripSheet(assignment, assignment.vehicle), [reading])).toMatchObject({
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      startOdometer: 278900,
      endOdometer: 279348,
      actualDistanceKm: 448,
    });
    expect(needsTripSheetListedDriverSync(
      assignment,
      listed,
      AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      'aleksandras',
    )).toBe(true);

    const syncedReading = applyTripSheetDriverCorrectionToDayReading(reading, {
      driverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      driverName: 'Aleksandras Arsenij',
      updatedAt: NOW,
    });
    expect(syncedReading).toMatchObject({
      driverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      driverName: 'Aleksandras Arsenij',
      startOdometer: 278900,
      endOdometer: 279348,
      distanceKm: 448,
    });
    const listedAfter = listedTripSheetDriver(assignment, [syncedReading]);
    expect(listedAfter).toEqual({
      driverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      driverName: 'Aleksandras Arsenij',
    });
    expect(applyDayReading(buildServerTripSheet(assignment, assignment.vehicle), [syncedReading])).toMatchObject({
      startOdometer: 278900,
      endOdometer: 279348,
      actualDistanceKm: 448,
    });

    const patchedAssignment = applyTripSheetVehicleDriverCorrection(assignment, {
      startOdometer: 279000,
      endOdometer: 279400,
      driverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      driverName: 'Aleksandras Arsenij',
      vehicle: assignment.vehicle,
      updatedAt: NOW,
    });
    expect(patchedAssignment.routeSnapshot.stops).toBe(stops);
    expect(patchedAssignment.routeSnapshot.shipmentLines).toBe(shipmentLines);
    expect(patchedAssignment.routeSnapshot.stops[0]).toMatchObject({
      delivered_at: '2026-08-19T08:12:00.000Z',
      delivery_status: 'delivered',
    });
    expect(patchedAssignment.vehicle).toMatchObject({ id: 'MET630', registrationNumber: 'MET630' });
  });

  it('PATCHes MET630 08-19 listed driver to Aleksandras and leaves Karolis NLL182 R54;R11 alone', () => {
    const met630 = liteAssignmentFromSnapshot({
      id: AUGUST_2026_ALEKSANDRAS_0819_ASSIGNMENT_ID,
      routeId: 'route-aug2026-aleks-0819-xlsx',
      driverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      driverName: 'Aleksandras Arsenij',
      status: 'completed',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: 'route-aug2026-aleks-0819-xlsx', date: '2026-08-19', started_at: '2026-08-19T06:00:00.000+03:00' },
      stops: aleks19.stops.map((stop) => ({ order_number: stop.orderNo, notes: stop.routeCode })),
      shipmentLines: aleks19.stops.map((stop) => ({ route_code: stop.routeCode, order_number: stop.orderNo })),
    });
    expect(isAleksandras0819Met630Target(met630)).toBe(true);
    expect(isAleksandras0819Met630RouteSet(met630)).toBe(true);
    expect(decideAugustBackfillV4DriverSync({
      assignment: met630,
      listedDriverId: KAROLIS_TAUTKUS_DRIVER_ID,
      listedDriverName: 'Karolis Tautkus',
      aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    })).toMatchObject({
      action: 'sync_listed_driver',
      targetDriverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      reason: 'met630_0819_listed_driver_not_aleksandras',
    });
    expect(decideAugustBackfillV4DriverSync({
      assignment: met630,
      listedDriverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      listedDriverName: 'Aleksandras Arsenij',
      aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    })).toMatchObject({ action: 'skip', reason: 'met630_0819_already_aleksandras' });

    const karolisNll = liteAssignmentFromSnapshot({
      id: karolisAugust19Nll182VehicleFix().assignmentId,
      routeId: 'route-karolis-0819-nll',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'NLL182', registrationNumber: 'NLL182' },
      route: { id: 'route-karolis-0819-nll', date: '2026-08-19', started_at: '2026-08-19T06:00:00.000+03:00' },
      stops: [
        { order_number: 'R54-1', notes: 'R54' },
        { order_number: 'R11-1', notes: 'R11' },
      ],
      shipmentLines: [
        { route_code: 'R54', order_number: 'R54-1' },
        { route_code: 'R11', order_number: 'R11-1' },
      ],
    });
    expect(isKarolis0819R54R11Assignment(karolisNll)).toBe(true);
    expect(decideAugustBackfillV4DriverSync({
      assignment: karolisNll,
      listedDriverId: KAROLIS_TAUTKUS_DRIVER_ID,
      listedDriverName: 'Karolis Tautkus',
      aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    })).toMatchObject({ action: 'skip', reason: 'karolis_0819_nll182_r54_r11' });
  });

  it('syncs 2026-08-31 NLL182 listed driver to Erikas without touching Karolis MET630 that day', () => {
    const erikasNll = liteAssignmentFromSnapshot({
      id: 'erikas-0831-nll182',
      routeId: 'route-erikas-0831',
      driverId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
      driverName: ERIKAS_ASKELOVICIUS_DISPLAY_NAME,
      status: 'completed',
      vehicle: { id: 'NLL182', registrationNumber: 'NLL182' },
      route: { id: 'route-erikas-0831', date: '2026-08-31', started_at: '2026-08-31T06:00:00.000+03:00' },
      stops: Array.from({ length: 6 }, (_, index) => ({
        order_number: `R88-${index + 1}`,
        notes: index < 3 ? 'R88' : 'R86',
        delivered_at: '2026-08-31T08:00:00.000Z',
      })),
      shipmentLines: [
        { route_code: 'R88', order_number: 'R88-1' },
        { route_code: 'R86', order_number: 'R86-1' },
      ],
    });
    expect(isErikas0831Nll182Assignment(erikasNll, ERIKAS_ASKELOVICIUS_DRIVER_ID)).toBe(true);
    expect(matchErikasDriver([
      { id: ERIKAS_ASKELOVICIUS_DRIVER_ID, displayName: ERIKAS_ASKELOVICIUS_DISPLAY_NAME, role: 'driver', disabled: false },
    ])?.id).toBe(ERIKAS_ASKELOVICIUS_DRIVER_ID);
    expect(decideAugustBackfillV4DriverSync({
      assignment: erikasNll,
      listedDriverId: KAROLIS_TAUTKUS_DRIVER_ID,
      listedDriverName: 'Karolis Tautkus',
      aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    })).toMatchObject({
      action: 'sync_listed_driver',
      targetDriverId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
      reason: 'nll182_0831_listed_driver_not_erikas',
    });

    const karolisMet = liteAssignmentFromSnapshot({
      id: 'a6f3ea27-0e1b-474f-ba45-f77266ea1ce4',
      routeId: 'route-karolis-0831-met',
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'MET630', registrationNumber: 'MET630' },
      route: { id: 'route-karolis-0831-met', date: '2026-08-31', started_at: '2026-08-31T06:00:00.000+03:00' },
      stops: [
        { order_number: 'R54-1', notes: 'R54' },
        { order_number: 'R11-1', notes: 'R11' },
      ],
      shipmentLines: [
        { route_code: 'R54', order_number: 'R54-1' },
        { route_code: 'R11', order_number: 'R11-1' },
      ],
    });
    expect(decideAugustBackfillV4DriverSync({
      assignment: karolisMet,
      listedDriverId: KAROLIS_TAUTKUS_DRIVER_ID,
      listedDriverName: 'Karolis Tautkus',
      aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    })).toMatchObject({ action: 'skip', reason: 'not_v4_target' });
  });

  it('does not rewrite 08-09 / 08-13 / 08-16 one-stop R56 stubs', () => {
    expect(stub09.stops).toHaveLength(1);
    expect(stub09.stops[0]?.weightKg).toBe(1500);
    expect(stubOrderNumber('2026-08-09')).toBe('STUB-R56-20260809');

    const filled09 = liteAssignmentFromSnapshot({
      id: 'filled-lri740-0809',
      routeId: augustBackfillRouteId(stub09),
      driverId: KAROLIS_TAUTKUS_DRIVER_ID,
      driverName: 'Karolis Tautkus',
      status: 'completed',
      vehicle: { id: 'LRI740', registrationNumber: 'LRI740' },
      route: { id: augustBackfillRouteId(stub09), date: '2026-08-09', started_at: '2026-08-09T06:00:00.000+03:00' },
      stops: [{
        order_number: stubOrderNumber('2026-08-09'),
        address: AUGUST_2026_STUB_PLACEHOLDER.address,
        recipient: AUGUST_2026_STUB_PLACEHOLDER.name,
        notes: 'R56',
        weight_kg: 1500,
        delivered_at: '2026-08-09T08:00:00.000Z',
      }],
    });
    expect(isKarolis0809Lri740Assignment(filled09, KAROLIS_TAUTKUS_DRIVER_ID)).toBe(true);
    expect(isAugust2026ProtectedR56StubAssignment(filled09)).toBe(true);
    expect(decideAugustBackfillV4DriverSync({
      assignment: filled09,
      listedDriverId: KAROLIS_TAUTKUS_DRIVER_ID,
      listedDriverName: 'Karolis Tautkus',
      aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
      erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    })).toMatchObject({ action: 'skip', reason: 'protected_r56_stub' });

    for (const stub of [stub13, stub16]) {
      const lite = liteAssignmentFromSnapshot({
        id: `stub-${stub.date}`,
        routeId: augustBackfillRouteId(stub),
        driverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
        driverName: 'Aleksandras Arsenij',
        status: 'completed',
        vehicle: { id: 'NLL182', registrationNumber: 'NLL182' },
        route: { id: augustBackfillRouteId(stub), date: stub.date, started_at: `${stub.date}T06:00:00.000+03:00` },
        stops: [{
          order_number: stubOrderNumber(stub.date),
          address: AUGUST_2026_STUB_PLACEHOLDER.address,
          notes: 'R56',
          weight_kg: 1500,
        }],
      });
      expect(isAugust2026ProtectedR56StubAssignment(lite)).toBe(true);
      expect(decideAugustBackfillV4DriverSync({
        assignment: lite,
        listedDriverId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
        listedDriverName: 'Aleksandras Arsenij',
        aleksandrasId: AUGUST_2026_ALEKSANDRAS_DRIVER_ID,
        erikasId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
      })).toMatchObject({ action: 'skip', reason: 'protected_r56_stub' });
    }

    const v4Block = storeSource.slice(
      storeSource.indexOf('async applyAugust2026ExcelBackfillV4'),
      storeSource.indexOf('private liteFromRouteAssignment'),
    );
    expect(v4Block).not.toContain('rewriteAugustBackfillEmptyStub');
    expect(v4Block).not.toContain('inventStubStop');
    expect(v4Block).not.toContain('geocodeQueriesCached');
    expect(v4Block).not.toContain('this.assignVehicle');
    expect(v4Block).not.toContain('markAllDelivered');
    expect(v4Block).toContain('await this.updateTripSheet(assignment.id, { driverId: decision.targetDriverId })');
    expect(v4Block).toContain('listedTripSheetDriver');
    expect(v4Block).toContain('refusing to no-op');
    expect(v4Block).toContain('protected 08-09/08-13/08-16 R56 stubs were rewritten');
  });

  it('does not swallow verify failures and awaits v4 after v3 on boot', () => {
    expect(storeSource).toContain('GET /api/trip-sheets 2026-08-19 MET630 driver is still not Aleksandras');
    expect(storeSource).toContain('protected 08-09/08-13/08-16 R56 stubs were rewritten');
    expect(storeSource).toContain('applyTripSheetDriverCorrectionToDayReading');
    expect(storeSource).toContain('odometerTouched');
    expect(apiSource).toContain('await store.applyAugust2026ExcelBackfillV4()');
    expect(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV3()'))
      .toBeLessThan(apiSource.indexOf('await store.applyAugust2026ExcelBackfillV4()'));
    expect(productionServer).toContain('v4 syncs listed trip-sheet driver');
  });
});
