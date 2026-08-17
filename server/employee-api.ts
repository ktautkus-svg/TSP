import type { IncomingMessage, ServerResponse } from 'node:http';

import { GatewayNonceRegistry, verifyGatewaySignature } from '../gateway/security.js';
import {
  EMPLOYEE_ROLES,
  EmployeeApiError,
  EmployeeAuthStore,
  DRIVER_PERMISSION_KEYS,
  MANAGEMENT_PERMISSION_KEYS,
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
const initialAdminPin = process.env.TSP_INITIAL_ADMIN_PIN?.trim() || '12345';
let legacyAdminMigration: Promise<void> | null = null;

function ensureLegacyAdminMigrated(): Promise<void> {
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

export async function handleEmployeeApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  requestId: string,
): Promise<boolean> {
  if (!isEmployeePath(pathname)) return false;
  try {
    await ensureLegacyAdminMigrated();
    if (request.method === 'GET' && pathname === '/api/auth/status') {
      return send(response, 200, { initialized: await store.hasUsers() }, requestId);
    }

    if (request.method === 'POST' && pathname === '/api/auth/bootstrap') {
      const rawBody = await readBody(request, 64_000);
      verifyBootstrapSignature(request, rawBody);
      const body = parseObject(rawBody);
      const pin = stringField(body, 'pin');
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
      requireRole(profile, ['admin', 'dispatcher']);
      const users = await store.listUsers();
      return send(response, 200, { users: profile.role === 'admin' ? users : users.filter((user) => user.role === 'driver') }, requestId);
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
      requireRole(profile, ['admin', 'dispatcher']);
      return send(response, 200, { vehicles: await store.listVehicles() }, requestId);
    }
    if (pathname === '/api/admin/vehicles' && request.method === 'POST') {
      requireManagementPermission(profile, 'canManageVehicles');
      const body = parseObject(await readBody(request, 64_000));
      const vehicle = await store.createVehicle({
        registrationNumber: stringField(body, 'registrationNumber'),
        model: stringField(body, 'model'),
        maximumPayloadKg: numberField(body, 'maximumPayloadKg'),
      });
      return send(response, 201, { vehicle }, requestId);
    }
    const vehicleMatch = pathname.match(/^\/api\/admin\/vehicles\/([^/]+)$/);
    if (vehicleMatch && request.method === 'PATCH') {
      requireManagementPermission(profile, 'canManageVehicles');
      const body = parseObject(await readBody(request, 64_000));
      const hasVehicleFields = body.registrationNumber !== undefined || body.model !== undefined || body.maximumPayloadKg !== undefined;
      let vehicle = hasVehicleFields
        ? await store.updateVehicle(vehicleMatch[1], {
          registrationNumber: optionalString(body, 'registrationNumber'),
          model: optionalString(body, 'model'),
          maximumPayloadKg: body.maximumPayloadKg === undefined ? undefined : numberField(body, 'maximumPayloadKg'),
        })
        : null;
      if (body.assignedDriverId !== undefined) {
        const assignedDriverId = body.assignedDriverId === null ? null : stringField(body, 'assignedDriverId');
        vehicle = await store.assignVehicle(vehicle?.id ?? vehicleMatch[1], assignedDriverId);
      }
      if (!vehicle) throw new EmployeeApiError('EMPTY_UPDATE', 'Nenurodyti automobilio pakeitimai.', 400);
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
      });
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
      requireRole(profile, ['admin', 'dispatcher']);
      return send(response, 200, { assignments: await store.listAssignments(profile) }, requestId);
    }
    if (pathname === '/api/assignments' && request.method === 'GET') {
      requireRole(profile, ['driver']);
      return send(response, 200, { assignments: await store.listAssignments(profile) }, requestId);
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
      requireRole(profile, ['admin', 'dispatcher', 'driver']);
      return send(response, 200, { tripSheets: await store.listTripSheets(profile) }, requestId);
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

function requireManagementPermission(profile: EmployeeProfile, permission: 'canManageEmployees' | 'canManageVehicles' | 'canManageFinancials'): void {
  if (profile.role === 'admin') return;
  if (profile.role === 'dispatcher' && profile.permissions[permission]) return;
  throw new EmployeeApiError('FORBIDDEN', 'Šiam veiksmui neturite suteiktos teisės.', 403);
}

function permissionPatch(value: unknown): Record<EmployeePermissionKey, boolean> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EmployeeApiError('INVALID_PERMISSIONS', 'Neteisingi vairuotojo leidimai.', 400);
  }
  const source = value as Record<string, unknown>;
  return Object.fromEntries([...DRIVER_PERMISSION_KEYS, ...MANAGEMENT_PERMISSION_KEYS].map((key) => [key, source[key] === true])) as Record<EmployeePermissionKey, boolean>;
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
