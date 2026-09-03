import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bodyKindFromPalletCapacity, fleetTankCapacity, resolveVehicleCargo } from './fleet-cargo-specs';
import { lithuanianClockOnReferenceDay, lithuanianDateKey } from './lithuanian-time';
import { knownAddressCorrection } from './import/known-address-corrections';
import { normalizeRegionCode, uniqueRegionCodes, type RouteCodeSource } from './route-code';
import {
  AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES,
  ERIKAS_ASKELOVICIUS_DISPLAY_NAME,
  ERIKAS_ASKELOVICIUS_DRIVER_ID,
} from './trip-sheet-august-2026-vehicle-fix';

/**
 * One-shot Firestore tsp_settings flag. First Cloud Run boot with the flag
 * unset materializes August 2026 completed trip sheets from the Excel JSON
 * payloads, then no-ops forever.
 */
export const AUGUST_2026_EXCEL_BACKFILL_ID = 'august-2026-excel-backfill-v1';

/**
 * Follow-up one-shot after v1. Fills verification gaps: missing LRI plates
 * (snapshot or unassigned fleet row), Aleksandras 08-11 LRI741, Aleksandras
 * 08-19 MET630, Karolis 08-09 LRI740 stub, and Karolis 08-19 R54;R11 still
 * sitting on MET630 (vehicleId PATCH only — stops untouched).
 */
export const AUGUST_2026_EXCEL_BACKFILL_V2_ID = 'august-2026-excel-backfill-v2';

/**
 * Follow-up one-shot after v2. v2 marked itself applied even when fleet
 * create / driver PATCH silently no-op'd (createVehicle errors swallowed;
 * 08-19 looked for Karolis R54;R11 on MET630 instead of R14;R27;R28;R51).
 * v3 must actually persist unassigned LRI741 and the remaining gaps.
 */
export const AUGUST_2026_EXCEL_BACKFILL_V3_ID = 'august-2026-excel-backfill-v3';

/**
 * Follow-up one-shot after v3. v3 PATCHed assignment.driverId for MET630
 * 08-19, but GET /api/trip-sheets overlays vehicle-day reading.driverName
 * via applyDayReading — so the kelionės lapas could still show Karolis.
 * v4 syncs that listed driver (PATCH driverId only) and does not rewrite
 * stops, delivered_at, windows, odometer, or vehicle.
 */
export const AUGUST_2026_EXCEL_BACKFILL_V4_ID = 'august-2026-excel-backfill-v4';

export const AUGUST_2026_SNAPSHOT_VEHICLE_MODEL = 'Renault Master';
export const AUGUST_2026_SNAPSHOT_PAYLOAD_KG = 1500;
export const AUGUST_2026_ENSURE_FLEET_PLATES = ['LRI740', 'LRI741'] as const;

/** LRI740 facts for the 08-09 Karolis R56 stub / fleet-create path. */
export const AUGUST_2026_LRI740_TANK_LITERS = 100;
export const AUGUST_2026_LRI740_FUEL_NORM_L_PER_100KM = 15;
export const AUGUST_2026_LRI740_OPENING_LITERS = 13;
export const AUGUST_2026_LRI740_OPENING_DATE = '2026-08-08';
export const AUGUST_2026_LRI740_OPENING_REPORT_ID = 'open-LRI740-20260808';
export const AUGUST_2026_LRI740_OPENING_NOTE = 'Rugpjūčio 8 d. bako likutis prieš 08-09 Karolio R56 stub.';
/** Same Master-class tank/norm as LRI740 — LRI741 had no catalog tank row. */
export const AUGUST_2026_LRI741_TANK_LITERS = 100;
export const AUGUST_2026_LRI741_FUEL_NORM_L_PER_100KM = 15;
export const AUGUST_2026_DUAL_SHEET_DATE = '2026-08-19';
export const AUGUST_2026_KAROLIS_0809_STUB_DATE = '2026-08-09';
export const AUGUST_2026_ALEKSANDRAS_0811_DATE = '2026-08-11';
export const AUGUST_2026_KAROLIS_0819_ROUTES = ['R54', 'R11'] as const;
export const AUGUST_2026_ALEKSANDRAS_0819_ROUTES = ['R14', 'R27', 'R28', 'R51'] as const;
export const AUGUST_2026_ALEKSANDRAS_NAME_CANDIDATES = [
  'Aleksandras Arsenij',
  'Aleksandras Arsenijus',
  'Aleksandras',
] as const;
/** Live Cloud Run 2026-09-03: route-aug2026-aleks-0819-xlsx on GET /api/admin/assignments. */
export const AUGUST_2026_ALEKSANDRAS_0819_ASSIGNMENT_ID = 'eafe0680-649b-44d6-87ee-3cca734ae9ce';
export const AUGUST_2026_ALEKSANDRAS_DRIVER_ID = '3ad054df-6d40-4279-9037-6b0e5c7abb9f';
export const AUGUST_2026_PROTECTED_STUB_DATES = ['2026-08-09', '2026-08-13', '2026-08-16'] as const;
export const AUGUST_2026_ERIKAS_0831_DATE = '2026-08-31';
export const AUGUST_2026_ERIKAS_0831_ROUTES = ['R88', 'R86'] as const;

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
  visibleStopCount: number;
  routeCodes: string[];
};

export type AugustBackfillVehicleRef = {
  id: string;
  registrationNumber: string;
  model: string;
  maximumPayloadKg: number;
  cargoBodyKind: 'van_long' | 'van_8pll';
  palletCapacity: 5 | 8;
  hasSideDoor: boolean;
  fuelNormLPer100Km: number | null;
  fuelTankCapacityLiters: number | null;
};

export type AugustBackfillDecision =
  | { action: 'complete_existing_ui'; assignmentId: string; reason: string }
  | { action: 'rewrite_existing_ui'; assignmentId: string; reason: string }
  | { action: 'rewrite_empty_stub'; assignmentId: string; reason: string; routeId: string }
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

export function matchAleksandrasDriver<T extends { id: string; displayName: string; role?: string; disabled?: boolean }>(
  users: readonly T[],
): T | null {
  for (const name of AUGUST_2026_ALEKSANDRAS_NAME_CANDIDATES) {
    const match = matchDriverByName(users, name);
    if (match) return match;
  }
  const byId = users.find((user) => (
    user.id === AUGUST_2026_ALEKSANDRAS_DRIVER_ID && !user.disabled
  ));
  return byId ?? null;
}

export function matchErikasDriver<T extends { id: string; displayName: string; role?: string; disabled?: boolean }>(
  users: readonly T[],
): T | null {
  const byId = users.find((user) => user.id === ERIKAS_ASKELOVICIUS_DRIVER_ID && !user.disabled);
  if (byId) return byId;
  return matchDriverByName(users, ERIKAS_ASKELOVICIUS_DISPLAY_NAME);
}

export function matchVehicleByPlate<T extends { registrationNumber: string }>(
  vehicles: readonly T[],
  plate: string,
): T | null {
  const target = normalizePlate(plate);
  if (!target) return null;
  return vehicles.find((vehicle) => normalizePlate(vehicle.registrationNumber) === target) ?? null;
}

export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase().replace(/\s+/g, '');
}

export function shouldEnsureAugustBackfillFleetPlate(plate: string): boolean {
  const normalized = normalizePlate(plate);
  return (AUGUST_2026_ENSURE_FLEET_PLATES as readonly string[]).includes(normalized);
}

export function august2026EnsureFleetPlateSpecs(plate: string): {
  fuelNormLPer100Km?: number;
  fuelTankCapacityLiters?: number;
} {
  const normalized = normalizePlate(plate);
  if (normalized === 'LRI740') {
    return {
      fuelNormLPer100Km: AUGUST_2026_LRI740_FUEL_NORM_L_PER_100KM,
      fuelTankCapacityLiters: AUGUST_2026_LRI740_TANK_LITERS,
    };
  }
  if (normalized === 'LRI741') {
    return {
      fuelNormLPer100Km: AUGUST_2026_LRI741_FUEL_NORM_L_PER_100KM,
      fuelTankCapacityLiters: AUGUST_2026_LRI741_TANK_LITERS,
    };
  }
  return {};
}

/** Fields passed to createVehicle — Master-like defaults, always unassigned. */
export function august2026EnsureFleetVehicleCreateInput(plate: string): {
  registrationNumber: string;
  model: string;
  maximumPayloadKg: number;
  fuelNormLPer100Km: number;
  fuelTankCapacityLiters: number;
  palletCapacity: 5 | 8;
  hasSideDoor: boolean;
  cargoBodyKind: 'van_long' | 'van_8pll';
} {
  const registrationNumber = normalizePlate(plate);
  const cargo = resolveVehicleCargo({ registrationNumber });
  const specs = august2026EnsureFleetPlateSpecs(registrationNumber);
  return {
    registrationNumber,
    model: AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
    maximumPayloadKg: AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
    fuelNormLPer100Km: specs.fuelNormLPer100Km ?? AUGUST_2026_LRI741_FUEL_NORM_L_PER_100KM,
    fuelTankCapacityLiters: specs.fuelTankCapacityLiters ?? AUGUST_2026_LRI741_TANK_LITERS,
    palletCapacity: cargo.palletCapacity,
    hasSideDoor: cargo.hasSideDoor,
    cargoBodyKind: bodyKindFromPalletCapacity(cargo.palletCapacity),
  };
}

/**
 * When the live fleet has no row for an Excel plate (LRI740 / LRI741 in
 * production), still produce a snapshot the assignment can store. Does not
 * invent a live assignVehicle binding.
 */
export function snapshotFleetVehicleFromPlate(plate: string): AugustBackfillVehicleRef | null {
  const registrationNumber = normalizePlate(plate);
  if (!registrationNumber) return null;
  const cargo = resolveVehicleCargo({ registrationNumber });
  const specs = august2026EnsureFleetPlateSpecs(registrationNumber);
  return {
    id: registrationNumber,
    registrationNumber,
    model: AUGUST_2026_SNAPSHOT_VEHICLE_MODEL,
    maximumPayloadKg: AUGUST_2026_SNAPSHOT_PAYLOAD_KG,
    cargoBodyKind: bodyKindFromPalletCapacity(cargo.palletCapacity),
    palletCapacity: cargo.palletCapacity,
    hasSideDoor: cargo.hasSideDoor,
    fuelNormLPer100Km: specs.fuelNormLPer100Km ?? null,
    fuelTankCapacityLiters: specs.fuelTankCapacityLiters ?? fleetTankCapacity(registrationNumber),
  };
}

export function resolveAugustBackfillVehicle<T extends { id: string; registrationNumber: string }>(
  vehicles: readonly T[],
  plate: string,
): { vehicle: T; source: 'fleet' } | { vehicle: AugustBackfillVehicleRef; source: 'snapshot' } | null {
  const fleet = matchVehicleByPlate(vehicles, plate);
  if (fleet) return { vehicle: fleet, source: 'fleet' };
  const snapshot = snapshotFleetVehicleFromPlate(plate);
  if (!snapshot) return null;
  return { vehicle: snapshot, source: 'snapshot' };
}

export function isAugust2026ExcelBackfillV2GapDay(day: Pick<AugustExcelDay, 'date' | 'driver' | 'kind' | 'sourceFile' | 'vehicle'>): boolean {
  if (day.sourceFile === 'aleksandras-11.json') return true;
  if (day.sourceFile === 'aleksandras-19.json') return true;
  return isKarolis0809Lri740StubDay(day);
}

export function isAugust2026ExcelBackfillV3GapDay(
  day: Pick<AugustExcelDay, 'date' | 'driver' | 'kind' | 'sourceFile' | 'vehicle'>,
): boolean {
  return isAugust2026ExcelBackfillV2GapDay(day);
}

export function isKarolis0809Lri740StubDay(
  day: Pick<AugustExcelDay, 'date' | 'driver' | 'kind' | 'vehicle'>,
): boolean {
  return day.kind === 'stub'
    && day.date === AUGUST_2026_KAROLIS_0809_STUB_DATE
    && normalizePersonName(day.driver).startsWith('karolis')
    && normalizePlate(day.vehicle) === 'LRI740';
}

export function isAleksandras0811Lri741Day(
  day: Pick<AugustExcelDay, 'date' | 'driver' | 'sourceFile' | 'vehicle'>,
): boolean {
  return day.sourceFile === 'aleksandras-11.json'
    || (
      day.date === AUGUST_2026_ALEKSANDRAS_0811_DATE
      && normalizePersonName(day.driver).startsWith('aleksandras')
      && normalizePlate(day.vehicle) === 'LRI741'
    );
}

export function visibleBackfillStopCount(stops: readonly Record<string, unknown>[]): number {
  return stops.filter((stop) => {
    const address = [stop.address, stop.normalized_address, stop.original_address]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    const recipient = typeof stop.recipient === 'string' ? stop.recipient.trim() : '';
    const order = typeof stop.order_number === 'string' ? stop.order_number.trim() : '';
    return Boolean(address || recipient || order);
  }).length;
}

export function assignmentNeedsStubStopRewrite(stops: readonly Record<string, unknown>[]): boolean {
  return visibleBackfillStopCount(stops) < 1;
}

export function assignmentPlate(assignment: Pick<AugustAssignmentLite, 'vehiclePlate' | 'vehicleId'>): string {
  return normalizePlate(assignment.vehiclePlate ?? assignment.vehicleId ?? '');
}

export function isAleksandras0819Met630RouteSet(assignment: Pick<
  AugustAssignmentLite,
  'status' | 'workDate' | 'routeDate' | 'vehiclePlate' | 'vehicleId' | 'routeCodes'
>): boolean {
  return assignment.status === 'completed'
    && assignmentMatchesWorkDate(assignment, AUGUST_2026_DUAL_SHEET_DATE)
    && assignmentPlate(assignment) === 'MET630'
    && assignmentHasAllRouteCodes(assignment.routeCodes, AUGUST_2026_ALEKSANDRAS_0819_ROUTES);
}

export function needsAleksandras0819DriverPatch(
  assignment: Pick<AugustAssignmentLite, 'driverId' | 'driverName' | 'status' | 'workDate' | 'routeDate' | 'vehiclePlate' | 'vehicleId' | 'routeCodes'>,
  aleksandrasId: string | null,
): boolean {
  if (!isAleksandras0819Met630RouteSet(assignment)) return false;
  if (aleksandrasId && assignment.driverId === aleksandrasId) return false;
  return !normalizePersonName(assignment.driverName).startsWith('aleksandras');
}

export function isKarolis0809Lri740Assignment(assignment: Pick<
  AugustAssignmentLite,
  'status' | 'workDate' | 'routeDate' | 'vehiclePlate' | 'vehicleId' | 'driverName' | 'driverId'
>, karolisId?: string | null): boolean {
  const onDate = assignmentMatchesWorkDate(assignment, AUGUST_2026_KAROLIS_0809_STUB_DATE);
  const plate = assignmentPlate(assignment) === 'LRI740';
  const karolis = (karolisId && assignment.driverId === karolisId)
    || normalizePersonName(assignment.driverName).startsWith('karolis');
  return assignment.status === 'completed' && onDate && plate && karolis;
}

export function karolisAugust19Nll182VehicleFix() {
  const fix = AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES.find((item) => (
    item.factDate === AUGUST_2026_DUAL_SHEET_DATE
    && item.registrationNumber === 'NLL182'
    && item.factRouteNumbers.includes('R54')
    && item.factRouteNumbers.includes('R11')
  ));
  if (!fix) {
    throw new Error('Karolis 2026-08-19 NLL182 R54;R11 vehicle-fix row is missing.');
  }
  return fix;
}

export function assignmentHasAllRouteCodes(
  codes: readonly string[],
  required: readonly string[],
): boolean {
  const set = new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  return required.every((code) => set.has(code.toUpperCase()));
}

export function assignmentHasAnyRouteCodes(
  codes: readonly string[],
  forbidden: readonly string[],
): boolean {
  const set = new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  return forbidden.some((code) => set.has(code.toUpperCase()));
}

export function isKarolis0819R54R11Assignment(assignment: Pick<
  AugustAssignmentLite,
  'id' | 'driverId' | 'driverName' | 'workDate' | 'routeDate' | 'routeCodes'
>): boolean {
  const fix = karolisAugust19Nll182VehicleFix();
  if (assignment.id === fix.assignmentId) return true;
  const onDate = assignmentMatchesWorkDate(assignment, AUGUST_2026_DUAL_SHEET_DATE);
  const karolis = assignment.driverId === fix.driverId
    || normalizePersonName(assignment.driverName).startsWith('karolis');
  return onDate
    && karolis
    && assignmentHasAllRouteCodes(assignment.routeCodes, AUGUST_2026_KAROLIS_0819_ROUTES)
    && !assignmentHasAnyRouteCodes(assignment.routeCodes, AUGUST_2026_ALEKSANDRAS_0819_ROUTES);
}

export function isAleksandras0819Met630Target(assignment: Pick<
  AugustAssignmentLite,
  'id' | 'status' | 'workDate' | 'routeDate' | 'vehiclePlate' | 'vehicleId' | 'routeCodes'
>): boolean {
  if (assignment.status !== 'completed') return false;
  if (assignment.id === AUGUST_2026_ALEKSANDRAS_0819_ASSIGNMENT_ID) {
    const onDate = assignmentMatchesWorkDate(assignment, AUGUST_2026_DUAL_SHEET_DATE);
    const plate = assignmentPlate(assignment);
    return onDate && (plate === 'MET630' || plate === '');
  }
  return isAleksandras0819Met630RouteSet(assignment);
}

export function isAugust2026ProtectedR56StubAssignment(assignment: Pick<
  AugustAssignmentLite,
  'status' | 'workDate' | 'routeDate' | 'routeCodes' | 'orderNumbers' | 'visibleStopCount' | 'stopCount'
>): boolean {
  if (assignment.status !== 'completed') return false;
  const onProtectedDate = AUGUST_2026_PROTECTED_STUB_DATES.some((date) => (
    assignmentMatchesWorkDate(assignment, date)
  ));
  if (!onProtectedDate) return false;
  const stubOrder = assignment.orderNumbers.some((order) => order.startsWith('STUB-R56-'));
  const oneStop = assignment.visibleStopCount <= 1 && assignment.stopCount <= 1;
  const r56 = assignment.routeCodes.length === 0
    || assignmentHasAllRouteCodes(assignment.routeCodes, ['R56']);
  return stubOrder || (oneStop && r56);
}

export function isErikas0831Nll182Assignment(assignment: Pick<
  AugustAssignmentLite,
  'status' | 'workDate' | 'routeDate' | 'vehiclePlate' | 'vehicleId' | 'driverName' | 'driverId' | 'routeCodes'
>, erikasId?: string | null): boolean {
  if (assignment.status !== 'completed') return false;
  if (!assignmentMatchesWorkDate(assignment, AUGUST_2026_ERIKAS_0831_DATE)) return false;
  if (assignmentPlate(assignment) !== 'NLL182') return false;
  const erikas = (erikasId && assignment.driverId === erikasId)
    || normalizePersonName(assignment.driverName).startsWith('erikas');
  if (!erikas) return false;
  if (assignment.routeCodes.length === 0) return true;
  return assignmentHasAllRouteCodes(assignment.routeCodes, AUGUST_2026_ERIKAS_0831_ROUTES);
}

export function driverSnapshotMatchesTarget(
  snapshot: { driverId: string; driverName: string },
  targetId: string,
  namePrefix: string,
): boolean {
  return snapshot.driverId === targetId
    && normalizePersonName(snapshot.driverName).startsWith(namePrefix);
}

export function needsTripSheetListedDriverSync(
  assignment: { driverId: string; driverName: string },
  listed: { driverId: string; driverName: string },
  targetId: string,
  namePrefix: string,
): boolean {
  return !driverSnapshotMatchesTarget(assignment, targetId, namePrefix)
    || !driverSnapshotMatchesTarget(listed, targetId, namePrefix);
}

export type AugustBackfillV4Decision =
  | { action: 'sync_listed_driver'; targetDriverId: string; reason: string }
  | { action: 'skip'; reason: string };

/**
 * v4 never creates/rewrites routes. It only PATCHes driverId when the
 * assignment/list overlay is the leftover MET630 08-19 or NLL182 08-31
 * driver snapshot. Protected R56 stubs and Karolis 08-19 R54;R11 are skip.
 */
export function decideAugustBackfillV4DriverSync(input: {
  assignment: AugustAssignmentLite;
  listedDriverId: string;
  listedDriverName: string;
  aleksandrasId: string | null;
  erikasId: string | null;
}): AugustBackfillV4Decision {
  if (isKarolis0819R54R11Assignment(input.assignment)) {
    return { action: 'skip', reason: 'karolis_0819_nll182_r54_r11' };
  }
  if (isAugust2026ProtectedR56StubAssignment(input.assignment)) {
    return { action: 'skip', reason: 'protected_r56_stub' };
  }
  if (isAleksandras0819Met630Target(input.assignment)) {
    if (!input.aleksandrasId) return { action: 'skip', reason: 'aleksandras_missing' };
    const listed = { driverId: input.listedDriverId, driverName: input.listedDriverName };
    if (needsTripSheetListedDriverSync(input.assignment, listed, input.aleksandrasId, 'aleksandras')) {
      return {
        action: 'sync_listed_driver',
        targetDriverId: input.aleksandrasId,
        reason: 'met630_0819_listed_driver_not_aleksandras',
      };
    }
    return { action: 'skip', reason: 'met630_0819_already_aleksandras' };
  }
  if (isErikas0831Nll182Assignment(input.assignment, input.erikasId)) {
    if (!input.erikasId) return { action: 'skip', reason: 'erikas_missing' };
    const listed = { driverId: input.listedDriverId, driverName: input.listedDriverName };
    if (needsTripSheetListedDriverSync(input.assignment, listed, input.erikasId, 'erikas')) {
      return {
        action: 'sync_listed_driver',
        targetDriverId: input.erikasId,
        reason: 'nll182_0831_listed_driver_not_erikas',
      };
    }
    return { action: 'skip', reason: 'nll182_0831_already_erikas' };
  }
  return { action: 'skip', reason: 'not_v4_target' };
}

export function karolis0819NeedsNll182Move(assignment: Pick<AugustAssignmentLite, 'vehiclePlate' | 'vehicleId'>): boolean {
  const plate = normalizePlate(assignment.vehiclePlate ?? assignment.vehicleId ?? '');
  return plate !== 'NLL182';
}

export function routeCodesFromAssignmentSnapshot(
  stops: readonly Record<string, unknown>[],
  shipmentLines: readonly Record<string, unknown>[] = [],
): string[] {
  const fromLines = uniqueRegionCodes(shipmentLines as unknown as RouteCodeSource[]);
  const fromNotes: string[] = [];
  for (const stop of stops) {
    const note = typeof stop.notes === 'string' ? normalizeRegionCode(stop.notes) : null;
    if (note) fromNotes.push(note);
  }
  return [...new Set([...fromLines, ...fromNotes])];
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

export function assignmentMatchesWorkDate(
  assignment: Pick<AugustAssignmentLite, 'workDate' | 'routeDate'>,
  date: string,
): boolean {
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

/**
 * v2 gap days reuse v1 decisions, except 2026-08-19 must keep BOTH sheets
 * (Karolis NLL182 R54;R11 and Aleksandras MET630 R14;R27;R28;R51). A completed
 * other-driver sheet on that date must not block create.
 */
export function decideAugustBackfillV2GapAction(input: {
  day: AugustExcelDay;
  skips: readonly AugustBackfillSkip[];
  existingUiRoute: AugustExistingUiRoute;
  driverId: string | null;
  vehicleId: string | null;
  assignments: readonly AugustAssignmentLite[];
}): AugustBackfillDecision {
  const decision = decideAugustBackfillDayAction(input);
  if (
    decision.action === 'skip'
    && decision.reason.startsWith('wrong_driver_completed_sheet')
    && input.day.date === AUGUST_2026_DUAL_SHEET_DATE
  ) {
    return {
      action: 'create',
      reason: 'create_dual_sheet_2026_08_19',
      routeId: augustBackfillRouteId(input.day),
    };
  }
  return decision;
}

/**
 * v3 gap days: same create/skip as v2, except
 * - 2026-08-19 MET630 already holding R14;R27;R28;R51 is patched (driver),
 *   not duplicated;
 * - 2026-08-09 LRI740 stub with no visible stop lines is rewritten in place.
 */
export function decideAugustBackfillV3GapAction(input: {
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

  if (input.day.sourceFile === 'aleksandras-19.json' || (
    input.day.date === AUGUST_2026_DUAL_SHEET_DATE
    && normalizePersonName(input.day.driver).startsWith('aleksandras')
    && normalizePlate(input.day.vehicle) === 'MET630'
  )) {
    const existing = input.assignments.find((assignment) => isAleksandras0819Met630RouteSet(assignment));
    if (existing) {
      return {
        action: 'skip',
        reason: needsAleksandras0819DriverPatch(existing, input.driverId)
          ? 'met630_0819_will_patch_driver'
          : 'met630_0819_already_aleksandras',
      };
    }
  }

  if (isKarolis0809Lri740StubDay(input.day)) {
    const existing = input.assignments.find((assignment) => (
      isKarolis0809Lri740Assignment(assignment, input.driverId)
    ));
    if (existing && existing.visibleStopCount < 1) {
      return {
        action: 'rewrite_empty_stub',
        assignmentId: existing.id,
        reason: 'lri740_0809_stub_missing_stops',
        routeId: existing.routeId || augustBackfillRouteId(input.day),
      };
    }
  }

  return decideAugustBackfillV2GapAction(input);
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
  shipmentLines?: Record<string, unknown>[];
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
    visibleStopCount: visibleBackfillStopCount(input.stops),
    routeCodes: routeCodesFromAssignmentSnapshot(input.stops, input.shipmentLines ?? []),
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
