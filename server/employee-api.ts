import type { IncomingMessage, ServerResponse } from 'node:http';

import { GatewayNonceRegistry, verifyGatewaySignature } from '../gateway/security.js';
import {
    DRIVER_PERMISSION_KEYS,
    EMPLOYEE_ROLES,
    EmployeeApiError,
    EmployeeAuthStore,
    MANAGEMENT_PERMISSION_KEYS,
    type DriverCompensationRates,
    type EmployeePermissionKey,
    type EmployeeProfile,
    type EmployeeRole,
    type RouteSnapshot,
} from './employee-auth-store.js';
import { RouteSyncStore, type RouteSyncPushItem } from './route-sync-store.js';

const store = new EmployeeAuthStore();
const routeSyncStore = new RouteSyncStore();
const bootstrapNonces = new GatewayNonceRegistry();
const loginAttempts = new Map<string, number[]>();
let legacyAdminMigration: Promise<void> | null = null;
let fuelAugust2026Migration: Promise<void> | null = null;
let tripSheetAugust2026VehicleFix: Promise<void> | null = null;
let august2026ExcelBackfill: Promise<void> | null = null;

const TRIVIAL_ADMIN_PINS = new Set(['12345', '123456', '000000', '111111']);

export function requireProductionAdminPin(): void {
  if (process.env.GATEWAY_ENV !== 'production') return;
  const pin = process.env.TSP_INITIAL_ADMIN_PIN?.trim() ?? '';
  if (!pin) throw new Error('TSP_INITIAL_ADMIN_PIN privalo būti nustatytas produkcijoje.');
  if (!/^\d{6,8}$/.test(pin) || TRIVIAL_ADMIN_PINS.has(pin) || /^(\d)\1+$/.test(pin)) {
    throw new Error('TSP_INITIAL_ADMIN_PIN turi būti 6–8 skaitmenys ir ne trivialus kodas.');
  }
}

function resolveInitialAdminPin(): string {
  return process.env.TSP_INITIAL_ADMIN_PIN?.trim() ?? '';
}

function ensureLegacyAdminMigrated(): Promise<void> {
  const initialAdminPin = resolveInitialAdminPin();
  if (!initialAdminPin) return Promise.resolve();
  if (!legacyAdminMigration) {
    legacyAdminMigration = store.migrateLegacyAdmin({
      fromUsername: 'admln',
      username: 'sensejus',
      displayName: 'Sensejus',
      pin: initialAdminPin,
    }).catch((error) => {
      legacyAdminMigration = null;
      throw error;
    });
  }
  return legacyAdminMigration;
}

/**
 * One-shot August 2026 MET/NLL fuel migrations — v2 (full reset) then v3
 * (remove two MET fills + fix 2026-08-03 day km) then v4 (08/52 fill +
 * 2026-08-31 extraDistanceKm). Each is idempotent via its own Firestore
 * tsp_settings flag.
 */
export function ensureFuelAugust2026Migrated(): Promise<void> {
  if (!fuelAugust2026Migration) {
    fuelAugust2026Migration = (async () => {
      const v2 = await store.applyFuelAugust2026V2Migration();
      process.stdout.write(`${JSON.stringify({
        event: 'fuel_august_2026_v2_migration',
        ...v2,
      })}\n`);
      const v3 = await store.applyFuelAugust2026V3Migration();
      process.stdout.write(`${JSON.stringify({
        event: 'fuel_august_2026_v3_migration',
        ...v3,
      })}\n`);
      const v4 = await store.applyFuelAugust2026V4Migration();
      process.stdout.write(`${JSON.stringify({
        event: 'fuel_august_2026_v4_migration',
        ...v4,
      })}\n`);
    })().catch((error) => {
      fuelAugust2026Migration = null;
      throw error;
    });
  }
  return fuelAugust2026Migration;
}

/** One-shot August 2026 trip-sheet vehicle/driver correction — Firestore flag, stops untouched. */
export function ensureTripSheetAugust2026VehicleFixMigrated(): Promise<void> {
  if (!tripSheetAugust2026VehicleFix) {
    tripSheetAugust2026VehicleFix = store.applyTripSheetAugust2026VehicleFix().then((result) => {
      process.stdout.write(`${JSON.stringify({
        event: 'trip_sheet_august_2026_vehicle_fix',
        ...result,
      })}\n`);
    }).catch((error) => {
      tripSheetAugust2026VehicleFix = null;
      throw error;
    });
  }
  return tripSheetAugust2026VehicleFix;
}

/** One-shot August 2026 Excel trip-sheet backfill — v1 then v2 then v3 then v4, after fuel + vehicle-fix. */
export function ensureAugust2026ExcelBackfillMigrated(): Promise<void> {
  if (!august2026ExcelBackfill) {
    august2026ExcelBackfill = (async () => {
      const v1 = await store.applyAugust2026ExcelBackfill();
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill',
        ...v1,
      })}\n`);
      const v2 = await store.applyAugust2026ExcelBackfillV2();
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v2',
        ...v2,
      })}\n`);
      const v3 = await store.applyAugust2026ExcelBackfillV3();
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v3',
        ...v3,
      })}\n`);
      const v4 = await store.applyAugust2026ExcelBackfillV4();
      process.stdout.write(`${JSON.stringify({
        event: 'august_2026_excel_backfill_v4',
        ...v4,
      })}\n`);
    })().catch((error) => {
      august2026ExcelBackfill = null;
      throw error;
    });
  }
  return august2026ExcelBackfill;
}

export async function handleEmployeeApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  requestId: string,
): Promise<boolean> {
  if (!isEmployeePath(pathname)) return false;
  try {
    await ensureLegacyAdminMigrated();
    await ensureFuelAugust2026Migrated();
    await ensureTripSheetAugust2026VehicleFixMigrated();
    await ensureAugust2026ExcelBackfillMigrated();
    if (request.method === 'GET' && pathname === '/api/auth/status') {
      return send(response, 200, { initialized: await store.hasUsers() }, requestId);
    }

    if (request.method === 'POST' && pathname === '/api/auth/bootstrap') {
      const rawBody = await readBody(request, 64_000);
      verifyBootstrapSignature(request, rawBody);
      const body = parseObject(rawBody);
      const pin = stringField(body, 'pin');
      const initialAdminPin = resolveInitialAdminPin();
      if (!initialAdminPin) {
        throw new EmployeeApiError('INITIAL_PIN_UNSET', 'Serveris neturi pradinio administratoriaus PIN. Nustatykite TSP_INITIAL_ADMIN_PIN.', 503);
      }
      if (pin !== initialAdminPin) {
        throw new EmployeeApiError('INVALID_INITIAL_PIN', 'Neteisingas pradinis administratoriaus PIN.', 400);
      }
      const profile = await store.bootstrapAdmin({
        username: stringField(body, 'username'),
        displayName: stringField(body, 'displayName'),
        pin,
      });
      const session = await store.login(profile.username, pin);
      return send(response, 201, { profile: session.profile, expiresAt: session.expiresAt }, requestId, {
        'set-cookie': sessionCookie(session.token),
      });
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      const client = request.socket.remoteAddress ?? 'unknown';
      enforceLoginLimit(client);
      const body = parseObject(await readBody(request, 32_000));
      const session = await store.login(stringField(body, 'username'), stringField(body, 'pin'));
      loginAttempts.delete(client);
      return send(response, 200, { profile: session.profile, expiresAt: session.expiresAt }, requestId, {
        'set-cookie': sessionCookie(session.token),
      });
    }

    const token = sessionToken(request);
    const profile = await store.authenticate(token);

    if (request.method === 'GET' && pathname === '/api/auth/me') {
      return send(response, 200, { profile }, requestId);
    }
    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      await store.logout(token);
      return send(response, 204, null, requestId, { 'set-cookie': expiredSessionCookie() });
    }

    if (pathname === '/api/operations/contacts' && request.method === 'GET') {
      const users = await store.listUsers();
      return send(response, 200, {
        contacts: users
          .filter((user) => !user.disabled && user.phone)
          .map((user) => ({
            id: `employee-${user.id}`,
            employeeId: user.id,
            name: user.displayName,
            role: user.role,
            phone: user.phone,
            email: user.email,
            isEmergency: user.role === 'admin' || user.role === 'dispatcher',
          })),
      }, requestId);
    }

    if (pathname === '/api/admin/route-price-settings' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher']);
      return send(response, 200, { settings: await store.getRoutePriceSettings() }, requestId);
    }
    if (pathname === '/api/admin/route-price-settings' && request.method === 'PATCH') {
      requireManagementPermission(profile, 'canManageFinancials');
      const body = parseObject(await readBody(request, 256_000));
      return send(response, 200, { settings: await store.updateRoutePriceSettings(body.settings, profile.id) }, requestId);
    }

    if (pathname === '/api/admin/users' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher', 'quality']);
      const users = await store.listUsers();
      return send(response, 200, { users: profile.role === 'admin' ? users : users.filter((user) => user.role === 'driver') }, requestId);
    }
    if (pathname === '/api/admin/clients' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher']);
      return send(response, 200, { clients: await store.listClients() }, requestId);
    }
    const clientMatch = pathname.match(/^\/api\/admin\/clients\/([^/]+)$/);
    if (clientMatch && request.method === 'PATCH') {
      requireRole(profile, ['admin', 'dispatcher']);
      const body = parseObject(await readBody(request, 32_000));
      const client = await store.updateClient(profile, decodeURIComponent(clientMatch[1]), {
        phone: body.phone === undefined ? undefined : optionalString(body, 'phone') ?? null,
        email: body.email === undefined ? undefined : optionalString(body, 'email') ?? null,
        contactPerson: body.contactPerson === undefined ? undefined : optionalString(body, 'contactPerson') ?? null,
      });
      return send(response, 200, { client }, requestId);
    }
    if (pathname === '/api/admin/users' && request.method === 'POST') {
      requireManagementPermission(profile, 'canManageEmployees');
      const body = parseObject(await readBody(request, 64_000));
      const role = stringField(body, 'role') as EmployeeRole;
      if (!EMPLOYEE_ROLES.includes(role)) throw new EmployeeApiError('INVALID_ROLE', 'Neleistina darbuotojo rolė.', 400);
      if (profile.role !== 'admin' && role !== 'driver') throw new EmployeeApiError('FORBIDDEN', 'Dispečeris gali kurti tik vairuotojo paskyrą.', 403);
      const user = await store.createUser({
        username: stringField(body, 'username'),
        displayName: stringField(body, 'displayName'),
        pin: stringField(body, 'pin'),
        role,
        email: optionalString(body, 'email'),
        phone: optionalString(body, 'phone'),
      });
      return send(response, 201, { user }, requestId);
    }
    if (pathname === '/api/admin/vehicles' && request.method === 'GET') {
      requireFleetVehicleListAccess(profile);
      return send(response, 200, { vehicles: await store.listVehicles() }, requestId);
    }
    if (pathname === '/api/admin/vehicles' && request.method === 'POST') {
      requireManagementPermission(profile, 'canManageVehicles');
      const body = parseObject(await readBody(request, 64_000));
      const vehicle = await store.createVehicle({
        registrationNumber: stringField(body, 'registrationNumber'),
        model: stringField(body, 'model'),
        maximumPayloadKg: numberField(body, 'maximumPayloadKg'),
        fuelNormLPer100Km: body.fuelNormLPer100Km === undefined || body.fuelNormLPer100Km === null
          ? null
          : numberField(body, 'fuelNormLPer100Km'),
        fuelTankCapacityLiters: body.fuelTankCapacityLiters === undefined
          ? undefined
          : body.fuelTankCapacityLiters === null
            ? null
            : numberField(body, 'fuelTankCapacityLiters'),
        cargoLengthMm: body.cargoLengthMm === undefined || body.cargoLengthMm === null ? null : numberField(body, 'cargoLengthMm'),
        cargoWidthMm: body.cargoWidthMm === undefined || body.cargoWidthMm === null ? null : numberField(body, 'cargoWidthMm'),
        wheelArchStartMm: body.wheelArchStartMm === undefined || body.wheelArchStartMm === null ? null : numberField(body, 'wheelArchStartMm'),
        wheelArchEndMm: body.wheelArchEndMm === undefined || body.wheelArchEndMm === null ? null : numberField(body, 'wheelArchEndMm'),
        wheelArchIntrusionMm: body.wheelArchIntrusionMm === undefined || body.wheelArchIntrusionMm === null ? null : numberField(body, 'wheelArchIntrusionMm'),
        cargoBodyType: optionalString(body, 'cargoBodyType') ?? null,
        cargoBodyKind: optionalString(body, 'cargoBodyKind'),
        palletCapacity: typeof body.palletCapacity === 'number' ? body.palletCapacity : undefined,
        hasSideDoor: typeof body.hasSideDoor === 'boolean' ? body.hasSideDoor : undefined,
      });
      return send(response, 201, { vehicle }, requestId);
    }
    const vehicleMatch = pathname.match(/^\/api\/admin\/vehicles\/([^/]+)$/);
    if (vehicleMatch && request.method === 'PATCH') {
      requireManagementPermission(profile, 'canManageVehicles');
      const body = parseObject(await readBody(request, 64_000));
      const hasVehicleFields = body.registrationNumber !== undefined || body.model !== undefined
        || body.maximumPayloadKg !== undefined || body.fuelNormLPer100Km !== undefined
        || body.fuelTankCapacityLiters !== undefined
        || body.cargoLengthMm !== undefined || body.cargoWidthMm !== undefined
        || body.wheelArchStartMm !== undefined || body.wheelArchEndMm !== undefined
        || body.wheelArchIntrusionMm !== undefined || body.cargoBodyType !== undefined
        || body.cargoBodyKind !== undefined || body.palletCapacity !== undefined
        || body.hasSideDoor !== undefined;
      let vehicle = hasVehicleFields
        ? await store.updateVehicle(vehicleMatch[1], {
          registrationNumber: optionalString(body, 'registrationNumber'),
          model: optionalString(body, 'model'),
          maximumPayloadKg: body.maximumPayloadKg === undefined ? undefined : numberField(body, 'maximumPayloadKg'),
          fuelNormLPer100Km: body.fuelNormLPer100Km === undefined
            ? undefined
            : body.fuelNormLPer100Km === null ? null : numberField(body, 'fuelNormLPer100Km'),
          fuelTankCapacityLiters: body.fuelTankCapacityLiters === undefined
            ? undefined
            : body.fuelTankCapacityLiters === null ? null : numberField(body, 'fuelTankCapacityLiters'),
          cargoLengthMm: body.cargoLengthMm === undefined ? undefined : body.cargoLengthMm === null ? null : numberField(body, 'cargoLengthMm'),
          cargoWidthMm: body.cargoWidthMm === undefined ? undefined : body.cargoWidthMm === null ? null : numberField(body, 'cargoWidthMm'),
          wheelArchStartMm: body.wheelArchStartMm === undefined ? undefined : body.wheelArchStartMm === null ? null : numberField(body, 'wheelArchStartMm'),
          wheelArchEndMm: body.wheelArchEndMm === undefined ? undefined : body.wheelArchEndMm === null ? null : numberField(body, 'wheelArchEndMm'),
          wheelArchIntrusionMm: body.wheelArchIntrusionMm === undefined ? undefined : body.wheelArchIntrusionMm === null ? null : numberField(body, 'wheelArchIntrusionMm'),
          cargoBodyType: optionalString(body, 'cargoBodyType'),
          cargoBodyKind: optionalString(body, 'cargoBodyKind'),
          palletCapacity: typeof body.palletCapacity === 'number' ? body.palletCapacity : undefined,
          hasSideDoor: typeof body.hasSideDoor === 'boolean' ? body.hasSideDoor : undefined,
        })
        : null;
      if (body.assignedDriverId !== undefined) {
        const assignedDriverId = body.assignedDriverId === null ? null : stringField(body, 'assignedDriverId');
        vehicle = await store.assignVehicle(vehicle?.id ?? vehicleMatch[1], assignedDriverId);
      }
      if (!vehicle) throw new EmployeeApiError('EMPTY_UPDATE', 'Nenurodyti automobilio pakeitimai.', 400);
      return send(response, 200, { vehicle }, requestId);
    }
    if (vehicleMatch && request.method === 'DELETE') {
      requireManagementPermission(profile, 'canManageVehicles');
      const vehicle = await store.deleteVehicle(decodeURIComponent(vehicleMatch[1]));
      return send(response, 200, { vehicle }, requestId);
    }
    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch && request.method === 'PATCH') {
      requireManagementPermission(profile, 'canManageEmployees');
      const body = parseObject(await readBody(request, 64_000));
      if (profile.role !== 'admin' && (body.role !== undefined || body.permissions !== undefined)) {
        throw new EmployeeApiError('FORBIDDEN', 'Roles ir teisių keitimą gali atlikti tik administratorius.', 403);
      }
      if (profile.role !== 'admin') {
        const target = (await store.listUsers()).find((user) => user.id === decodeURIComponent(userMatch[1]));
        if (!target || target.role !== 'driver') throw new EmployeeApiError('FORBIDDEN', 'Dispečeris gali redaguoti tik vairuotojus.', 403);
      }
      const role = optionalString(body, 'role') as EmployeeRole | undefined;
      const user = await store.updateUser(decodeURIComponent(userMatch[1]), {
        username: optionalString(body, 'username'),
        displayName: optionalString(body, 'displayName'),
        role,
        disabled: typeof body.disabled === 'boolean' ? body.disabled : undefined,
        pin: optionalString(body, 'pin'),
        permissions: permissionPatch(body.permissions),
        email: optionalString(body, 'email'),
        phone: optionalString(body, 'phone'),
        compensation: compensationPatch(body.compensation),
      });
      return send(response, 200, { user }, requestId);
    }
    if (userMatch && request.method === 'DELETE') {
      requireManagementPermission(profile, 'canManageEmployees');
      const targetId = decodeURIComponent(userMatch[1]);
      if (targetId === profile.id) throw new EmployeeApiError('CANNOT_DELETE_SELF', 'Negalite pašalinti paskyros, kuria šiuo metu esate prisijungę.', 409);
      const target = (await store.listUsers()).find((user) => user.id === targetId);
      if (!target) throw new EmployeeApiError('USER_NOT_FOUND', 'Darbuotojas nerastas.', 404);
      if (profile.role !== 'admin' && target.role !== 'driver') {
        throw new EmployeeApiError('FORBIDDEN', 'Dispečeris gali pašalinti tik vairuotojus.', 403);
      }
      const user = await store.deleteUser(targetId);
      return send(response, 200, { user }, requestId);
    }

    if (pathname === '/api/admin/assignments' && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher']);
      const body = parseObject(await readBody(request, 8_000_000));
      const assignment = await store.createAssignment({
        driverId: stringField(body, 'driverId'),
        routeSnapshot: body.routeSnapshot as RouteSnapshot,
        createdBy: profile.id,
        vehicleId: optionalString(body, 'vehicleId'),
      });
      // Best-effort: establishes the driver as the route's cloud-sync owner
      // so it also participates in general multi-device sync going forward.
      // Never blocks the assignment response — the one-shot assignment
      // download remains the primary path for the driver's first device.
      await routeSyncStore.seedAssignment(assignment.driverId, assignment.routeSnapshot).catch((reason) => {
        process.stderr.write(`${JSON.stringify({ event: 'route_sync_seed_failed', requestId, error: reason instanceof Error ? reason.message : String(reason) })}\n`);
      });
      return send(response, 201, { assignment }, requestId);
    }
    if (pathname === '/api/admin/assignments' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher', 'quality']);
      return send(response, 200, { assignments: await store.listAssignments(profile) }, requestId);
    }
    if (pathname === '/api/assignments' && request.method === 'GET') {
      requireRole(profile, ['driver']);
      return send(response, 200, { assignments: await store.listAssignments(profile) }, requestId);
    }
    /**
     * Admin/dispatcher only. Empty body keeps the live same-day complete
     * (completed_at = now, pending stops unmarked). Optional startedAt /
     * completedAt ISO timestamps historically start+close a trip sheet on the
     * Lithuanian work day of those stamps. markAllDelivered backfills stops
     * without GPS or routing spend.
     */
    const adminAssignmentCompleteMatch = pathname.match(/^\/api\/admin\/assignments\/([^/]+)\/complete$/);
    if (adminAssignmentCompleteMatch && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher']);
      const rawBody = await readBody(request, 32_000);
      const body = rawBody.trim() ? parseObject(rawBody) : {};
      const assignment = await store.completeAssignment(
        decodeURIComponent(adminAssignmentCompleteMatch[1]),
        {
          startedAt: optionalIsoTimestamp(body, 'startedAt'),
          completedAt: optionalIsoTimestamp(body, 'completedAt'),
          markAllDelivered: optionalBoolean(body, 'markAllDelivered'),
        },
      );
      await routeSyncStore.seedAssignment(assignment.driverId, assignment.routeSnapshot).catch((reason) => {
        process.stderr.write(`${JSON.stringify({ event: 'route_sync_complete_seed_failed', requestId, error: reason instanceof Error ? reason.message : String(reason) })}\n`);
      });
      return send(response, 200, { assignment }, requestId);
    }
    const adminAssignmentCancelMatch = pathname.match(/^\/api\/admin\/assignments\/([^/]+)\/cancel$/);
    if (adminAssignmentCancelMatch && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher']);
      const assignment = await store.cancelAssignment(decodeURIComponent(adminAssignmentCancelMatch[1]));
      return send(response, 200, { assignment }, requestId);
    }
    const adminAssignmentMatch = pathname.match(/^\/api\/admin\/assignments\/([^/]+)$/);
    if (adminAssignmentMatch && request.method === 'PATCH') {
      requireRole(profile, ['admin', 'dispatcher']);
      const body = parseObject(await readBody(request, 32_000));
      const assignment = await store.updateAssignmentSchedule(
        decodeURIComponent(adminAssignmentMatch[1]),
        stringField(body, 'date'),
      );
      await routeSyncStore.seedAssignment(assignment.driverId, assignment.routeSnapshot);
      return send(response, 200, { assignment }, requestId);
    }
    if (adminAssignmentMatch && request.method === 'DELETE') {
      requireRole(profile, ['admin', 'dispatcher']);
      const assignment = await store.deleteAssignment(decodeURIComponent(adminAssignmentMatch[1]));
      await routeSyncStore.tombstone(assignment.routeId);
      return send(response, 204, null, requestId);
    }
    if (pathname === '/api/trip-sheets' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher', 'driver', 'quality']);
      return send(response, 200, { tripSheets: await store.listTripSheets(profile) }, requestId);
    }
    if (pathname === '/api/trip-sheets/day-readings' && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher', 'driver', 'quality']);
      const body = parseObject(await readBody(request, 32_000));
      const reading = await store.upsertVehicleDayReading(profile, {
        vehicleId: stringField(body, 'vehicleId'),
        date: stringField(body, 'date'),
        startOdometer: numberField(body, 'startOdometer'),
        endOdometer: numberField(body, 'endOdometer'),
        driverId: body.driverId === undefined ? undefined : body.driverId === null ? null : stringField(body, 'driverId'),
      });
      return send(response, 200, { reading }, requestId);
    }
    const tripSheetCorrectionMatch = pathname.match(/^\/api\/trip-sheets\/([^/]+)$/);
    if (tripSheetCorrectionMatch && request.method === 'PATCH') {
      requireRole(profile, ['admin', 'dispatcher']);
      const body = parseObject(await readBody(request, 32_000));
      const tripSheet = await store.updateTripSheet(decodeURIComponent(tripSheetCorrectionMatch[1]), {
        startOdometer: body.startOdometer === undefined ? undefined : body.startOdometer === null ? null : numberField(body, 'startOdometer'),
        endOdometer: body.endOdometer === undefined ? undefined : body.endOdometer === null ? null : numberField(body, 'endOdometer'),
        driverId: body.driverId === undefined ? undefined : stringField(body, 'driverId'),
        vehicleId: body.vehicleId === undefined ? undefined : stringField(body, 'vehicleId'),
      });
      return send(response, 200, { tripSheet }, requestId);
    }
    const unassignedTripDayMatch = pathname.match(/^\/api\/admin\/trip-sheets\/unassigned-day\/([^/]+)\/([^/]+)$/);
    if (unassignedTripDayMatch && request.method === 'DELETE') {
      requireManagementPermission(profile, 'canManageFinancials');
      await store.deleteUnassignedTripDay(decodeURIComponent(unassignedTripDayMatch[1]), decodeURIComponent(unassignedTripDayMatch[2]));
      return send(response, 204, null, requestId);
    }
    const tripSheetFuelMatch = pathname.match(/^\/api\/trip-sheets\/([^/]+)\/fuel-entries$/);
    if (tripSheetFuelMatch && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher', 'driver', 'quality']);
      const body = parseObject(await readBody(request, 32_000));
      const entry = await store.addFuelEntry(profile, decodeURIComponent(tripSheetFuelMatch[1]), {
        filledAt: stringField(body, 'filledAt'),
        odometer: typeof body.odometer === 'number' ? body.odometer : undefined,
        liters: numberField(body, 'liters'),
        pricePerLiter: typeof body.pricePerLiter === 'number' ? body.pricePerLiter : undefined,
        station: optionalString(body, 'station'),
        receiptNumber: optionalString(body, 'receiptNumber'),
        notes: optionalString(body, 'notes'),
      });
      return send(response, 201, { entry }, requestId);
    }
    const routeFuelMatch = pathname.match(/^\/api\/routes\/([^/]+)\/fuel-entries$/);
    if (routeFuelMatch && request.method === 'POST') {
      requireRole(profile, ['driver', 'admin', 'dispatcher']);
      const body = parseObject(await readBody(request, 32_000));
      const routeId = decodeURIComponent(routeFuelMatch[1]);
      const assignment = (await store.listAssignments(profile)).find((item) => item.routeId === routeId && item.status !== 'cancelled');
      if (!assignment) throw new EmployeeApiError('ROUTE_ASSIGNMENT_NOT_FOUND', 'Aktyvaus maršruto priskyrimas nerastas.', 404);
      const entry = await store.addFuelEntry(profile, assignment.id, {
        filledAt: stringField(body, 'filledAt'),
        odometer: typeof body.odometer === 'number' ? body.odometer : undefined,
        liters: numberField(body, 'liters'),
        pricePerLiter: typeof body.pricePerLiter === 'number' ? body.pricePerLiter : undefined,
        station: optionalString(body, 'station'),
        receiptNumber: optionalString(body, 'receiptNumber'),
        notes: optionalString(body, 'notes'),
      });
      return send(response, 201, { entry }, requestId);
    }
    const fuelEntryMatch = pathname.match(/^\/api\/fuel-entries\/([^/]+)$/);
    if (fuelEntryMatch && request.method === 'PATCH') {
      requireRole(profile, ['admin', 'dispatcher', 'driver', 'quality']);
      const body = parseObject(await readBody(request, 32_000));
      const entry = await store.updateFuelEntry(profile, decodeURIComponent(fuelEntryMatch[1]), {
        filledAt: body.filledAt === undefined ? undefined : stringField(body, 'filledAt'),
        odometer: body.odometer === undefined ? undefined : numberField(body, 'odometer'),
        liters: body.liters === undefined ? undefined : numberField(body, 'liters'),
        pricePerLiter: body.pricePerLiter === undefined ? undefined : body.pricePerLiter === null ? null : numberField(body, 'pricePerLiter'),
        station: body.station === undefined ? undefined : optionalString(body, 'station'),
        receiptNumber: body.receiptNumber === undefined ? undefined : optionalString(body, 'receiptNumber'),
        notes: body.notes === undefined ? undefined : optionalString(body, 'notes'),
      });
      return send(response, 200, { entry }, requestId);
    }
    if (fuelEntryMatch && request.method === 'DELETE') {
      requireRole(profile, ['admin', 'dispatcher', 'driver', 'quality']);
      const entry = await store.deleteFuelEntry(profile, decodeURIComponent(fuelEntryMatch[1]));
      return send(response, 200, { entry }, requestId);
    }
    if (pathname === '/api/fuel-status' && request.method === 'GET') {
      requireRole(profile, ['driver']);
      return send(response, 200, await store.getFuelStatus(profile), requestId);
    }
    if (pathname === '/api/fuel-status' && request.method === 'POST') {
      requireRole(profile, ['driver']);
      const body = parseObject(await readBody(request, 32_000));
      return send(response, 200, await store.reportFuel(profile, numberField(body, 'liters')), requestId);
    }
    if (pathname === '/api/operations/vehicle-faults' && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      const body = parseObject(await readBody(request, 32_000));
      const report = await store.reportVehicleFault(profile, {
        localId: optionalString(body, 'localId') ?? null,
        vehicleId: optionalString(body, 'vehicleId') ?? null,
        registrationNumber: optionalString(body, 'registrationNumber') ?? null,
        comment: stringField(body, 'comment'),
        reportedAt: optionalString(body, 'reportedAt') ?? null,
      });
      return send(response, 201, { report }, requestId);
    }
    if (pathname === '/api/admin/vehicle-faults' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher']);
      return send(response, 200, { faults: await store.listVehicleFaults() }, requestId);
    }
    if (pathname === '/api/operations/departure-overrides' && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      const body = parseObject(await readBody(request, 32_000));
      const override = await store.requestDepartureOverride(profile, {
        localId: optionalString(body, 'localId') ?? null,
        vehicleId: optionalString(body, 'vehicleId') ?? null,
        registrationNumber: optionalString(body, 'registrationNumber') ?? null,
        fingerprint: stringField(body, 'fingerprint'),
        summary: stringField(body, 'summary'),
        requestedAt: optionalString(body, 'requestedAt') ?? null,
      });
      return send(response, 201, { override }, requestId);
    }
    if (pathname === '/api/operations/departure-overrides' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      const params = new URL(request.url ?? '', 'http://localhost').searchParams;
      return send(response, 200, {
        override: await store.getLatestDepartureOverride({
          vehicleId: params.get('vehicleId'),
          registrationNumber: params.get('registrationNumber'),
        }),
      }, requestId);
    }
    if (pathname === '/api/admin/departure-overrides' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher']);
      return send(response, 200, { overrides: await store.listDepartureOverrides() }, requestId);
    }
    if (pathname === '/api/admin/departure-overrides' && request.method === 'POST') {
      requireManagementPermission(profile, 'canManageVehicles');
      const body = parseObject(await readBody(request, 32_000));
      const override = await store.approveDepartureOverride(profile, {
        id: optionalString(body, 'id') ?? null,
        localId: optionalString(body, 'localId') ?? null,
        vehicleId: optionalString(body, 'vehicleId') ?? null,
        registrationNumber: optionalString(body, 'registrationNumber') ?? null,
        fingerprint: stringField(body, 'fingerprint'),
        summary: stringField(body, 'summary'),
        note: optionalString(body, 'note') ?? null,
      });
      return send(response, 200, { override }, requestId);
    }
    const overrideReviewMatch = pathname.match(/^\/api\/admin\/departure-overrides\/([^/]+)\/review$/);
    if (overrideReviewMatch && request.method === 'POST') {
      requireManagementPermission(profile, 'canManageVehicles');
      const body = parseObject(await readBody(request, 8_000));
      const override = await store.reviewDepartureOverride(
        decodeURIComponent(overrideReviewMatch[1]),
        profile,
        optionalString(body, 'note') ?? null,
      );
      return send(response, 200, { override }, requestId);
    }
    if (pathname === '/api/admin/fuel-reports' && request.method === 'GET') {
      requireRole(profile, ['admin']);
      return send(response, 200, { reports: await store.listFuelReports() }, requestId);
    }
    const fuelReviewMatch = pathname.match(/^\/api\/admin\/fuel-reports\/([^/]+)\/(approve|reject)$/);
    if (fuelReviewMatch && request.method === 'POST') {
      requireRole(profile, ['admin']);
      const report = await store.reviewFuelReport(decodeURIComponent(fuelReviewMatch[1]), profile, fuelReviewMatch[2] === 'approve');
      return send(response, 200, { report }, requestId);
    }
    if (pathname === '/api/admin/fuel-corrections' && request.method === 'POST') {
      requireRole(profile, ['admin']);
      const body = parseObject(await readBody(request, 8_000));
      const report = await store.correctFuelBalance(profile, {
        vehicleId: stringField(body, 'vehicleId'),
        liters: numberField(body, 'liters'),
        effectiveAt: stringField(body, 'effectiveAt'),
        note: optionalString(body, 'note') ?? null,
      });
      return send(response, 201, { report }, requestId);
    }
    if (pathname === '/api/quality/routes' && request.method === 'GET') {
      requireRole(profile, ['quality', 'admin', 'dispatcher']);
      return send(response, 200, { routes: await store.listQualityRoutes(), serverTime: new Date().toISOString() }, requestId);
    }

    if (pathname === '/api/route-sync' && request.method === 'GET') {
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      const since = new URL(request.url ?? '', 'http://localhost').searchParams.get('since');
      const result = await routeSyncStore.pull(profile.id, since);
      return send(response, 200, result, requestId);
    }
    if (pathname === '/api/route-sync' && request.method === 'POST') {
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      const body = parseObject(await readBody(request, 8_000_000));
      const results = await routeSyncStore.push(profile.id, routeSyncItems(body.routes));
      return send(response, 200, { results }, requestId);
    }

    const downloadedMatch = pathname.match(/^\/api\/assignments\/([^/]+)\/downloaded$/);
    if (downloadedMatch && request.method === 'POST') {
      requireRole(profile, ['driver']);
      await store.markAssignmentDownloaded(profile, decodeURIComponent(downloadedMatch[1]));
      return send(response, 204, null, requestId);
    }
    const progressMatch = pathname.match(/^\/api\/assignments\/([^/]+)\/progress$/);
    if (progressMatch && request.method === 'PUT') {
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      const body = parseObject(await readBody(request, 8_000_000));
      const assignment = await store.updateAssignmentProgress(
        profile,
        decodeURIComponent(progressMatch[1]),
        body.routeSnapshot as RouteSnapshot,
      );
      await routeSyncStore.seedAssignment(assignment.driverId, assignment.routeSnapshot).catch((reason) => {
        process.stderr.write(`${JSON.stringify({ event: 'route_sync_progress_seed_failed', requestId, error: reason instanceof Error ? reason.message : String(reason) })}\n`);
      });
      return send(response, 200, { assignment }, requestId);
    }

    send(response, 404, { error: { code: 'NOT_FOUND', message: 'API veiksmas nerastas.' } }, requestId);
    return true;
  } catch (error) {
    const safe = error instanceof EmployeeApiError
      ? error
      : new EmployeeApiError('EMPLOYEE_API_ERROR', 'Darbuotojų serveris laikinai nepasiekiamas.', 500);
    if (!(error instanceof EmployeeApiError)) {
      process.stderr.write(`${JSON.stringify({ event: 'employee_api_error', requestId, error: error instanceof Error ? error.message : String(error) })}\n`);
    }
    send(response, safe.status, { error: { code: safe.code, message: safe.message } }, requestId);
    return true;
  }
}

export async function authenticateApiRequest(request: IncomingMessage): Promise<EmployeeProfile> {
  return store.authenticate(sessionToken(request));
}

function isEmployeePath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/admin/')
    || pathname.startsWith('/api/assignments')
    || pathname.startsWith('/api/trip-sheets')
    || pathname.startsWith('/api/fuel-status')
    || pathname.startsWith('/api/operations/')
    || pathname.startsWith('/api/quality/')
    || pathname.startsWith('/api/route-sync');
}

function routeSyncItems(value: unknown): RouteSyncPushItem[] {
  if (!Array.isArray(value)) throw new EmployeeApiError('INVALID_REQUEST', 'Trūksta lauko: routes.', 400);
  // A malformed *item* is passed through and rejected individually by the sync
  // store; only a malformed request envelope fails the whole call. One bad
  // route must never cost the client its entire sync pass.
  return value.map((item) => {
    const record = (item && typeof item === 'object' ? item : {}) as { routeSnapshot?: unknown; deleted?: unknown };
    return {
      routeSnapshot: record.routeSnapshot as RouteSnapshot,
      deleted: record.deleted === true,
    };
  });
}

function requireRole(profile: EmployeeProfile, roles: EmployeeRole[]): void {
  if (!roles.includes(profile.role)) throw new EmployeeApiError('FORBIDDEN', 'Šiam veiksmui neturite teisės.', 403);
}

function requireManagementPermission(profile: EmployeeProfile, permission: 'canManageEmployees' | 'canManageVehicles' | 'canManageFinancials' | 'canEditTripSheets'): void {
  if (profile.role === 'admin') return;
  if (profile.role === 'dispatcher' && profile.permissions[permission]) return;
  throw new EmployeeApiError('FORBIDDEN', 'Šiam veiksmui neturite suteiktos teisės.', 403);
}

function requireFleetVehicleListAccess(profile: EmployeeProfile): void {
  if (profile.role === 'admin' || profile.role === 'dispatcher') return;
  if (profile.permissions.canEnterTripReadings) return;
  throw new EmployeeApiError('FORBIDDEN', 'Šiam veiksmui neturite teisės.', 403);
}

function permissionPatch(value: unknown): Record<EmployeePermissionKey, boolean> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EmployeeApiError('INVALID_PERMISSIONS', 'Neteisingi vairuotojo leidimai.', 400);
  }
  const source = value as Record<string, unknown>;
  return Object.fromEntries([...DRIVER_PERMISSION_KEYS, ...MANAGEMENT_PERMISSION_KEYS].map((key) => [key, source[key] === true])) as Record<EmployeePermissionKey, boolean>;
}

/** `null` clears the driver's own rates and returns them to the defaults. */
function compensationPatch(value: unknown): DriverCompensationRates | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new EmployeeApiError('INVALID_COMPENSATION', 'Neteisingi atlygio tarifai.', 400);
  }
  const source = value as Record<string, unknown>;
  return {
    type: source.type === 'fixed' ? 'fixed' : 'variable',
    fixedDailyNetEur: numberField(source, 'fixedDailyNetEur'),
    perKmEur: numberField(source, 'perKmEur'),
    perKgEur: numberField(source, 'perKgEur'),
    perStopEur: numberField(source, 'perStopEur'),
  };
}

function sessionToken(request: IncomingMessage): string {
  const value = header(request, 'authorization') ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  const cookies = header(request, 'cookie') ?? '';
  const cookie = cookies.split(';').map((part) => part.trim()).find((part) => part.startsWith('tsp_session='));
  if (cookie) return decodeURIComponent(cookie.slice('tsp_session='.length));
  throw new EmployeeApiError('SESSION_REQUIRED', 'Reikia prisijungti.', 401);
}

function verifyBootstrapSignature(request: IncomingMessage, rawBody: string): void {
  const secret = process.env.GATEWAY_DEVICE_SECRET?.trim();
  if (!secret) throw new EmployeeApiError('BOOTSTRAP_DISABLED', 'Administratoriaus aktyvavimas nesukonfigūruotas.', 503);
  try {
    verifyGatewaySignature({
      secret,
      timestamp: header(request, 'x-routing-timestamp'),
      signature: header(request, 'x-routing-signature'),
      nonce: header(request, 'x-routing-nonce'),
      rawBody,
      nonceRegistry: bootstrapNonces,
      requireNonce: true,
    });
  } catch {
    throw new EmployeeApiError('DEVICE_KEY_REQUIRED', 'Pirmajam administratoriui reikia galiojančio įrenginio rakto.', 401);
  }
}

function enforceLoginLimit(client: string): void {
  const now = Date.now();
  const windowStart = now - 15 * 60_000;
  const attempts = (loginAttempts.get(client) ?? []).filter((value) => value >= windowStart);
  if (attempts.length >= 10) throw new EmployeeApiError('LOGIN_RATE_LIMITED', 'Per daug prisijungimo bandymų. Palaukite 15 minučių.', 429);
  attempts.push(now);
  loginAttempts.set(client, attempts);
}

async function readBody(request: IncomingMessage, maximumBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new EmployeeApiError('PAYLOAD_TOO_LARGE', 'Užklausa per didelė.', 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseObject(rawBody: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawBody) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value as Record<string, unknown>;
  } catch {
    throw new EmployeeApiError('INVALID_JSON', 'Užklausos duomenys neteisingi.', 400);
  }
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string') throw new EmployeeApiError('INVALID_REQUEST', `Trūksta lauko: ${name}.`, 400);
  return value;
}

function optionalString(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  return typeof value === 'string' ? value : undefined;
}

function optionalIsoTimestamp(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new EmployeeApiError('INVALID_REQUEST', `Neteisingas laukas: ${name}.`, 400);
  }
  return value.trim();
}

function optionalBoolean(body: Record<string, unknown>, name: string): boolean | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new EmployeeApiError('INVALID_REQUEST', `Neteisingas laukas: ${name}.`, 400);
  }
  return value;
}

function numberField(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  if (typeof value !== 'number') throw new EmployeeApiError('INVALID_REQUEST', `Trūksta skaitinio lauko: ${name}.`, 400);
  return value;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(response: ServerResponse, status: number, body: unknown, requestId: string, extraHeaders: Record<string, string> = {}): true {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
    ...extraHeaders,
  });
  response.end(status === 204 ? undefined : JSON.stringify(body));
  return true;
}

function sessionCookie(token: string): string {
  return `tsp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86_400}`;
}

function expiredSessionCookie(): string {
  return 'tsp_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
