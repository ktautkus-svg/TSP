import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lithuanianClockOnReferenceDay, lithuanianDateKey } from './lithuanian-time';
import { knownAddressCorrection } from './import/known-address-corrections';

/**
 * One-shot Firestore tsp_settings flag. First Cloud Run boot with the flag
 * unset materializes August 2026 completed trip sheets from the Excel JSON
 * payloads, then no-ops forever.
 */
export const AUGUST_2026_EXCEL_BACKFILL_ID = 'august-2026-excel-backfill-v1';

export const EXISTING_UI_ROUTE_ID = 'route-1788407220642-xh5w5ldr';
export const EXISTING_UI_ROUTE_DATE = '2026-08-03';
export const EXISTING_UI_ROUTE_DRIVER = 'Karolis Tautkus';
export const EXISTING_UI_ROUTE_VEHICLE = 'MET630';

export const AUGUST_2026_EXCEL_DAY_FILES = [
  'karolis-03.json',
  'karolis-04.json',
  'karolis-05.json',
  'karolis-10.json',
  'karolis-11.json',
  'karolis-12.json',
  'aleksandras-11.json',
  'aleksandras-14.json',
  'aleksandras-18.json',
  'aleksandras-19.json',
  'aleksandras-21.json',
  'aleksandras-25.json',
] as const;

/** Legacy combined dumps — never load these for the boot migration. */
export const AUGUST_2026_LEGACY_COMBINED_FILES = ['karolis.json', 'aleksandras.json'] as const;

/**
 * Stubs have no Excel stop list. Use a stable R56 address already present in
 * the Karolis 2026-08-04 payload (Šiaulių ilgalaikio gydymo ir geriatrijos
 * centras) rather than inventing warehouse/Kretinga — these days are coded R56.
 */
export const AUGUST_2026_STUB_PLACEHOLDER = {
  address: 'UAB Lambda LT\nVilniaus g. 125\n\nŠiauliai  \nLietuva',
  name: 'UAB Lambda LT, Šiaulių ilgalaikio gydymo ir geriatrijos centras',
  routeCode: 'R56',
  timeWindow: '06:00-15:00',
  weightKg: 1500,
  geocodeQuery: 'Vilniaus g. 125, Šiauliai, Lietuva',
  reason: 'R56 placeholder from Karolis 2026-08-04 Excel (Vilniaus g. 125, Šiauliai). Not warehouse/Kretinga.',
} as const;

export const AUGUST_2026_BACKFILL_START_CLOCK = '06:00';
export const AUGUST_2026_BACKFILL_END_CLOCK = '16:30';

export type AugustExcelStop = {
  orderNo: string;
  weightKg: number;
  timeWindow: string;
  address: string;
  name: string;
  routeCode: string;
};

export type AugustExcelDay = {
  date: string;
  driver: string;
  vehicle: string;
  sheet?: string;
  metaWeight?: number;
  metaStops?: number;
  metaRoutes?: string;
  stops: AugustExcelStop[];
  kind: 'excel' | 'stub';
  sourceFile: string;
};

export type AugustBackfillSkip = {
  date: string;
  driver: string;
  routes?: string;
  note: string;
};

export type AugustExistingUiRoute = {
  date: string;
  routeId: string;
  driver: string;
  vehicle: string;
  note: string;
};

export type AugustBackfillCatalog = {
  days: AugustExcelDay[];
  skips: AugustBackfillSkip[];
  existingUiRoute: AugustExistingUiRoute;
  stubPlaceholder: typeof AUGUST_2026_STUB_PLACEHOLDER;
};

export type AugustAssignmentLite = {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  status: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  routeDate: string | null;
  workDate: string | null;
  orderNumbers: string[];
  stopCount: number;
};

export type AugustBackfillDecision =
  | { action: 'complete_existing_ui'; assignmentId: string; reason: string }
  | { action: 'rewrite_existing_ui'; assignmentId: string; reason: string }
  | { action: 'create'; reason: string; routeId: string }
  | { action: 'skip'; reason: string };

export type AugustBackfillGeocodeResult = {
  normalizedAddress: string;
  latitude: number;
  longitude: number;
} | null;

export type AugustBackfillGeocodeFn = (query: string) => Promise<AugustBackfillGeocodeResult>;

export type AugustPlannedSnapshot = {
  route: Record<string, unknown>;
  stops: Record<string, unknown>[];
  shipmentLines: Record<string, unknown>[];
};

const STREET_LINE = /\b(?:g\.|gatv(?:ė|e)|pr\.|prospekt(?:as|o)|pl\.|plentas|kelias|takas|al\.|alėja|aikšt(?:ė|e)|skg\.)\s*\d/iu;
const LOOSE_STREET = /^\p{L}[\p{L}\s.'’‘-]+\s\d+[A-ZĄČĘĖĮŠŲŪŽ]?/u;

export function resolveAugustBackfillDirectory(fromDir?: string): string {
  const candidates = [
    join(process.cwd(), 'scripts/august-2026-backfill'),
    ...(fromDir ? [
      join(fromDir, '../../scripts/august-2026-backfill'),
      join(fromDir, '../../../scripts/august-2026-backfill'),
      join(fromDir, '../../../../scripts/august-2026-backfill'),
    ] : []),
  ];
  const found = candidates.find((candidate) => existsSync(join(candidate, 'stubs.json')));
  if (!found) {
    throw new Error('August 2026 backfill JSON directory not found (scripts/august-2026-backfill).');
  }
  return found;
}

export function loadAugust2026ExcelBackfillCatalog(
  directory = resolveAugustBackfillDirectory(),
): AugustBackfillCatalog {
  const stubsFile = readJsonFile<StubsFile>(join(directory, 'stubs.json'));
  const days: AugustExcelDay[] = AUGUST_2026_EXCEL_DAY_FILES.map((fileName) => {
    const raw = readJsonFile<RawExcelDay>(join(directory, fileName));
    return {
      date: raw.date,
      driver: raw.driver,
      vehicle: raw.vehicle,
      sheet: raw.sheet,
      metaWeight: raw.metaWeight,
      metaStops: raw.metaStops,
      metaRoutes: raw.metaRoutes,
      stops: raw.stops.map((stop) => ({
        orderNo: String(stop.orderNo),
        weightKg: Number(stop.weightKg),
        timeWindow: String(stop.timeWindow),
        address: String(stop.address),
        name: String(stop.name),
        routeCode: String(stop.routeCode ?? ''),
      })),
      kind: 'excel',
      sourceFile: fileName,
    };
  });

  const stubDays = stubsFile.stubs.map((stub) => ({
    date: stub.date,
    driver: stub.driver,
    vehicle: stub.vehicle,
    metaRoutes: stub.routes,
    metaWeight: stub.weightKg,
    metaStops: 1,
    stops: [inventStubStop(stub)],
    kind: 'stub' as const,
    sourceFile: 'stubs.json',
  }));

  return {
    days: [...days, ...stubDays],
    skips: stubsFile.skip.map((item) => ({
      date: item.date,
      driver: item.driver,
      routes: item.routes,
      note: item.note,
    })),
    existingUiRoute: stubsFile.existingUiRoute,
    stubPlaceholder: AUGUST_2026_STUB_PLACEHOLDER,
  };
}

export function inventStubStop(stub: { date: string; routes: string; weightKg: number }): AugustExcelStop {
  return {
    orderNo: stubOrderNumber(stub.date),
    weightKg: stub.weightKg,
    timeWindow: AUGUST_2026_STUB_PLACEHOLDER.timeWindow,
    address: AUGUST_2026_STUB_PLACEHOLDER.address,
    name: AUGUST_2026_STUB_PLACEHOLDER.name,
    routeCode: stub.routes || AUGUST_2026_STUB_PLACEHOLDER.routeCode,
  };
}

export function stubOrderNumber(date: string): string {
  return `STUB-R56-${date.replace(/-/g, '')}`;
}

export function isAugust2026SkipDay(skips: readonly AugustBackfillSkip[], date: string, driver: string): boolean {
  return skips.some((item) => item.date === date && normalizePersonName(item.driver) === normalizePersonName(driver));
}

export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('lt');
}

export function matchDriverByName<T extends { displayName: string; role?: string; disabled?: boolean }>(
  users: readonly T[],
  name: string,
): T | null {
  const target = normalizePersonName(name);
  const drivers = users.filter((user) => (user.role ?? 'driver') === 'driver' && !user.disabled);
  const exact = drivers.find((user) => normalizePersonName(user.displayName) === target);
  if (exact) return exact;
  const first = target.split(' ')[0] ?? '';
  if (!first) return null;
  const prefixed = drivers.filter((user) => normalizePersonName(user.displayName).startsWith(first));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

export function matchVehicleByPlate<T extends { registrationNumber: string }>(
  vehicles: readonly T[],
  plate: string,
): T | null {
  const target = plate.trim().toUpperCase().replace(/\s+/g, '');
  return vehicles.find((vehicle) => vehicle.registrationNumber.toUpperCase().replace(/\s+/g, '') === target) ?? null;
}

/**
 * Turns a multiline Excel cell into a single geocode query.
 * Prefers the street line and keeps city/country that follow it.
 */
export function excelAddressToGeocodeQuery(address: string): string {
  const lines = address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => STREET_LINE.test(line) || LOOSE_STREET.test(line));
  const slice = start >= 0 ? lines.slice(start) : lines;
  const countryAt = slice.findIndex((line) => /\bLietuva\b/iu.test(line));
  const selected = countryAt >= 0 ? slice.slice(0, countryAt + 1) : slice;
  return selected.join(', ').replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim();
}

export function parseExcelTimeWindow(value: string): { from: string | null; to: string | null } {
  const match = value.trim().replace(/[–—]/g, '-').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!match) return { from: null, to: null };
  const from = `${match[1]!.padStart(2, '0')}:${match[2]}`;
  const to = `${match[3]!.padStart(2, '0')}:${match[4]}`;
  return { from, to };
}

export function historicalWorkdayTimestamps(date: string): { startedAt: string; completedAt: string } {
  const reference = `${date}T12:00:00.000+03:00`;
  const startedMs = lithuanianClockOnReferenceDay(reference, AUGUST_2026_BACKFILL_START_CLOCK);
  const completedMs = lithuanianClockOnReferenceDay(reference, AUGUST_2026_BACKFILL_END_CLOCK);
  if (startedMs === null || completedMs === null) {
    throw new Error(`Cannot resolve Lithuanian workday timestamps for ${date}.`);
  }
  return {
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
  };
}

export function augustBackfillRouteId(day: Pick<AugustExcelDay, 'date' | 'driver' | 'kind'>): string {
  const who = normalizePersonName(day.driver).startsWith('aleksandras') ? 'aleks' : 'karolis';
  const stamp = day.date.replace(/-/g, '').slice(4);
  const kind = day.kind === 'stub' ? 'stub' : 'xlsx';
  return `route-aug2026-${who}-${stamp}-${kind}`;
}

export function uniqueGeocodeQueries(days: readonly AugustExcelDay[]): string[] {
  const queries = new Set<string>();
  for (const day of days) {
    for (const stop of day.stops) {
      const query = excelAddressToGeocodeQuery(stop.address);
      if (query) queries.add(query);
    }
  }
  return [...queries];
}

export function createCachedGeocoder(lookup: AugustBackfillGeocodeFn): AugustBackfillGeocodeFn {
  const cache = new Map<string, Promise<AugustBackfillGeocodeResult>>();
  return (query) => {
    const key = query.trim().toLocaleLowerCase('lt');
    const existing = cache.get(key);
    if (existing) return existing;
    const known = knownAddressCorrection(query);
    const pending = known
      ? Promise.resolve({
        normalizedAddress: known.normalizedAddress,
        latitude: known.latitude,
        longitude: known.longitude,
      } satisfies AugustBackfillGeocodeResult)
      : lookup(query);
    cache.set(key, pending);
    return pending;
  };
}

export async function geocodeQueriesCached(
  queries: readonly string[],
  geocode: AugustBackfillGeocodeFn,
  concurrency = 4,
): Promise<Map<string, AugustBackfillGeocodeResult>> {
  const cached = createCachedGeocoder(geocode);
  const results = new Map<string, AugustBackfillGeocodeResult>();
  for (let index = 0; index < queries.length; index += concurrency) {
    const batch = queries.slice(index, index + concurrency);
    const resolved = await Promise.all(batch.map(async (query) => [query, await cached(query)] as const));
    for (const [query, result] of resolved) results.set(query, result);
  }
  return results;
}

export function buildAugustBackfillRouteSnapshot(
  day: AugustExcelDay,
  geocodes: ReadonlyMap<string, AugustBackfillGeocodeResult>,
  routeId: string,
  nowIso: string,
): AugustPlannedSnapshot {
  const timestamps = historicalWorkdayTimestamps(day.date);
  const totalWeightKg = day.stops.reduce((sum, stop) => sum + (Number.isFinite(stop.weightKg) ? stop.weightKg : 0), 0);
  const unknownWeightStops = day.stops.filter((stop) => !Number.isFinite(stop.weightKg)).length;
  const firstQuery = day.stops[0] ? excelAddressToGeocodeQuery(day.stops[0].address) : '';
  const lastQuery = day.stops.at(-1) ? excelAddressToGeocodeQuery(day.stops.at(-1)!.address) : firstQuery;
  const firstGeo = geocodes.get(firstQuery) ?? null;
  const lastGeo = geocodes.get(lastQuery) ?? firstGeo;
  const startLocation = endpointFromQuery(firstQuery || AUGUST_2026_STUB_PLACEHOLDER.geocodeQuery, firstGeo);
  const endLocation = endpointFromQuery(lastQuery || firstQuery, lastGeo);

  const stops = day.stops.map((stop, index) => {
    const window = parseExcelTimeWindow(stop.timeWindow);
    const query = excelAddressToGeocodeQuery(stop.address);
    const geo = geocodes.get(query) ?? null;
    const stopId = augustStopId(routeId, index, stop.orderNo);
    return {
      id: stopId,
      source_stop_id: `excel-aug2026:${day.sourceFile}:${index + 1}:${stop.orderNo}`,
      route_id: routeId,
      original_order: index + 1,
      optimized_order: null,
      active_order: index + 1,
      order_number: stop.orderNo,
      recipient: stop.name,
      address: geo?.normalizedAddress ?? query,
      original_address: stop.address,
      geocoding_query: query,
      normalized_address: geo?.normalizedAddress ?? query,
      address_validation_state: geo ? 'auto_confirmed' : 'needs_review',
      geocoding_error: geo ? null : 'GEOCODE_UNAVAILABLE',
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      delivery_time_from: window.from,
      delivery_time_to: window.to,
      required_time_window: window.from && window.to ? 1 : 0,
      service_duration_minutes: 10,
      planned_arrival_at: null,
      planned_departure_at: null,
      latest_estimated_arrival_at: null,
      leg_distance_km: null,
      leg_duration_minutes: null,
      weight_kg: Number.isFinite(stop.weightKg) ? stop.weightKg : null,
      phone: null,
      notes: stop.routeCode || null,
      loading_status: 'pending',
      delivery_status: 'pending',
      failure_reason: null,
      failure_comment: null,
      loaded_at: null,
      delivered_at: null,
      failed_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    };
  });

  const shipmentLines = day.stops.map((stop, index) => {
    const window = parseExcelTimeWindow(stop.timeWindow);
    const stopId = String(stops[index]!.id);
    return {
      id: `line-${stopId}`,
      route_id: routeId,
      delivery_stop_id: stopId,
      source_import_id: `august-2026-excel-backfill:${day.sourceFile}`,
      source_sheet_name: day.sheet ?? day.date,
      source_row_number: index + 1,
      order_number: stop.orderNo,
      weight_grams: Number.isFinite(stop.weightKg) ? Math.round(stop.weightKg * 1000) : null,
      delivery_time_from: window.from,
      delivery_time_to: window.to,
      supplier_prefix: null,
      recipient: stop.name,
      route_code: stop.routeCode || null,
      raw_column_d: stop.name,
      raw_column_e: stop.address,
      raw_row: {
        orderNo: stop.orderNo,
        weightKg: stop.weightKg,
        timeWindow: stop.timeWindow,
        routeCode: stop.routeCode,
      },
      created_at: nowIso,
    };
  });

  return {
    route: {
      id: routeId,
      vehicle_id: null,
      date: day.date,
      status: 'planned',
      planning_mode: 'ignore_time_windows',
      estimated_distance_km: null,
      actual_distance_km: null,
      total_weight_kg: totalWeightKg,
      remaining_weight_kg: totalWeightKg,
      total_stops: stops.length,
      remaining_stops: stops.length,
      start_odometer: null,
      end_odometer: null,
      created_at: nowIso,
      updated_at: nowIso,
      started_at: null,
      completed_at: null,
      start_location_json: JSON.stringify(startLocation),
      end_location_json: JSON.stringify(endLocation),
      planned_departure_at: timestamps.startedAt,
      selected_run_id: null,
      selected_candidate_id: null,
      estimated_duration_minutes: null,
      source_import_audit_id: `august-2026-excel-backfill:${day.sourceFile}`,
      unknown_weight_stops: unknownWeightStops,
      remaining_unknown_weight_stops: unknownWeightStops,
      cancelled_at: null,
      return_destination_kind: null,
      completion_summary_json: null,
    },
    stops,
    shipmentLines,
  };
}

export function assignmentOrderNumbers(stops: readonly Record<string, unknown>[]): string[] {
  return stops
    .map((stop) => (typeof stop.order_number === 'string' ? stop.order_number.trim() : ''))
    .filter(Boolean);
}

export function hasOverlappingOrderNumbers(existing: readonly string[], incoming: readonly string[]): boolean {
  const left = new Set(existing.map((value) => value.trim().toLocaleLowerCase('lt')));
  return incoming.some((value) => left.has(value.trim().toLocaleLowerCase('lt')));
}

export function assignmentMatchesWorkDate(assignment: AugustAssignmentLite, date: string): boolean {
  return assignment.workDate === date || assignment.routeDate === date;
}

export function decideAugustBackfillDayAction(input: {
  day: AugustExcelDay;
  skips: readonly AugustBackfillSkip[];
  existingUiRoute: AugustExistingUiRoute;
  driverId: string | null;
  vehicleId: string | null;
  assignments: readonly AugustAssignmentLite[];
}): AugustBackfillDecision {
  if (isAugust2026SkipDay(input.skips, input.day.date, input.day.driver)) {
    return { action: 'skip', reason: 'listed_skip' };
  }

  const isExistingUiDay = input.day.date === input.existingUiRoute.date
    && normalizePersonName(input.day.driver) === normalizePersonName(input.existingUiRoute.driver)
    && input.day.kind === 'excel';

  if (isExistingUiDay) {
    const ui = input.assignments.find((assignment) => assignment.routeId === input.existingUiRoute.routeId);
    if (ui) {
      // Trip sheets key off started_at/completed_at, not the planned route.date.
      if (ui.status === 'completed' && ui.workDate === input.existingUiRoute.date) {
        return { action: 'skip', reason: 'existing_ui_already_historically_completed' };
      }
      if (ui.status === 'completed') {
        return { action: 'rewrite_existing_ui', assignmentId: ui.id, reason: 'existing_ui_completed_wrong_day' };
      }
      return { action: 'complete_existing_ui', assignmentId: ui.id, reason: 'existing_ui_historically_complete' };
    }
  }

  if (!input.driverId) return { action: 'skip', reason: 'driver_missing' };
  if (!input.vehicleId) return { action: 'skip', reason: 'vehicle_missing' };

  const sameDriverVehicleDate = input.assignments.find((assignment) => (
    assignment.status === 'completed'
    && assignment.driverId === input.driverId
    && assignment.vehicleId === input.vehicleId
    && assignmentMatchesWorkDate(assignment, input.day.date)
    && assignment.stopCount >= 1
  ));
  if (sameDriverVehicleDate) {
    return { action: 'skip', reason: 'already_exists_same_driver_vehicle_date' };
  }

  const incomingOrders = input.day.stops.map((stop) => stop.orderNo);
  const wrongDriver = input.assignments.find((assignment) => (
    assignment.status === 'completed'
    && assignment.driverId !== input.driverId
    && assignmentMatchesWorkDate(assignment, input.day.date)
    && assignment.stopCount >= 1
    && hasOverlappingOrderNumbers(assignment.orderNumbers, incomingOrders)
  ));
  if (wrongDriver) {
    return { action: 'skip', reason: `wrong_driver_completed_sheet:${wrongDriver.id}` };
  }

  return { action: 'create', reason: isExistingUiDay ? 'existing_ui_missing_create_from_excel' : 'create_from_excel', routeId: augustBackfillRouteId(input.day) };
}

export function replaceLiteAssignment(assignments: AugustAssignmentLite[], next: AugustAssignmentLite): void {
  const index = assignments.findIndex((item) => item.id === next.id);
  if (index >= 0) assignments[index] = next;
  else assignments.push(next);
}

export function liteAssignmentFromSnapshot(input: {
  id: string;
  routeId: string;
  driverId: string;
  driverName: string;
  status: string;
  vehicle: { id?: string | null; registrationNumber?: string | null } | null;
  route: Record<string, unknown>;
  stops: Record<string, unknown>[];
}): AugustAssignmentLite {
  const startedAt = optionalText(input.route.started_at);
  const completedAt = optionalText(input.route.completed_at);
  const workReference = startedAt ?? completedAt;
  return {
    id: input.id,
    routeId: input.routeId,
    driverId: input.driverId,
    driverName: input.driverName,
    status: input.status,
    vehicleId: input.vehicle?.id ?? null,
    vehiclePlate: input.vehicle?.registrationNumber ?? null,
    routeDate: optionalText(input.route.date),
    workDate: workReference ? lithuanianDateKey(workReference) : optionalText(input.route.date),
    orderNumbers: assignmentOrderNumbers(input.stops),
    stopCount: input.stops.length,
  };
}

function endpointFromQuery(query: string, geo: AugustBackfillGeocodeResult): Record<string, unknown> {
  return {
    originalAddress: query,
    geocodingQuery: query,
    normalizedAddress: geo?.normalizedAddress ?? query,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
  };
}

function augustStopId(routeId: string, index: number, orderNo: string): string {
  const safeOrder = orderNo.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'stop';
  return `${routeId}-${String(index + 1).padStart(2, '0')}-${safeOrder}`.slice(0, 80);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

type RawExcelDay = {
  sheet?: string;
  date: string;
  driver: string;
  vehicle: string;
  metaWeight?: number;
  metaStops?: number;
  metaRoutes?: string;
  stops: Array<{
    orderNo: string;
    weightKg: number;
    timeWindow: string;
    address: string;
    name: string;
    routeCode?: string;
  }>;
};

type StubsFile = {
  stubs: Array<{
    date: string;
    driver: string;
    vehicle: string;
    routes: string;
    weightKg: number;
    stops: number;
    note: string;
  }>;
  skip: Array<{
    date: string;
    driver: string;
    routes?: string;
    note: string;
  }>;
  existingUiRoute: AugustExistingUiRoute;
};
