import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { aggregateWageDays, summarizeWageDays, type WageAdjustment } from '../../src/application/finance/wage-report';
import { buildMonthSummary } from '../../src/application/reporting/month-summary';
import type { ServerRouteAssignment, ServerTripSheet } from '../../src/infrastructure/auth/employee-session';
import { inMemoryFirestore } from '../support/in-memory-firestore';

// Runtime test of the real DELETE /api/admin/accounting-trips/:id handler:
// real handleEmployeeApi, real EmployeeAuthStore and RouteSyncStore, real
// session resolution and permission checks. Only Firestore is replaced by an
// in-memory map, so no network, credentials or live data are involved.
vi.mock('@google-cloud/firestore', () => import('../support/in-memory-firestore'));

const { EmployeeAuthStore } = await import('../../server/employee-auth-store');
const { handleEmployeeApi } = await import('../../server/employee-api');

// One-shot production data migrations/backfills are not part of this
// behaviour and must never run against test data.
const ONE_SHOT_MIGRATIONS = [
  'applyFuelAugust2026V2Migration',
  'applyFuelAugust2026V3Migration',
  'applyFuelAugust2026V4Migration',
  'applyFuelAugust2026V5Migration',
  'applyFuelAugust2026V6Migration',
  'applyTripSheetAugust2026VehicleFix',
  'applyAugust2026ExcelBackfill',
  'applyAugust2026ExcelBackfillV2',
  'applyAugust2026ExcelBackfillV3',
  'applyAugust2026ExcelBackfillV4',
  'applyAugust2026ExcelBackfillV5',
  'applySeptember2026Nll182Backfill',
  'applySeptember2026Nll182BackfillV2',
  'applySeptember2026Nll182BackfillV3',
] as const;

const NOW = '2026-10-07T08:00:00.000Z';
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';

const USERS = {
  admin: { id: 'admin-test-0001', username: 'admin.test', displayName: 'Admin Testas', role: 'admin', permissions: {} },
  financeDispatcher: { id: 'dispatcher-fin-01', username: 'disp.fin', displayName: 'Dispečerė Finansai', role: 'dispatcher', permissions: { canManageFinancials: true } },
  plainDispatcher: { id: 'dispatcher-plain1', username: 'disp.plain', displayName: 'Dispečeris Be Teisės', role: 'dispatcher', permissions: { canManageFinancials: false } },
  jonas: { id: 'driver-jonas-0001', username: 'jonas', displayName: 'Jonas Sintetinis', role: 'driver', permissions: {} },
  petras: { id: 'driver-petras-001', username: 'petras', displayName: 'Petras Sintetinis', role: 'driver', permissions: {} },
} as const;

type UserKey = keyof typeof USERS;

const VEHICLES = [
  { id: 'TST101', registrationNumber: 'TST101', model: 'Sintetinis Crafter', maximumPayloadKg: 1200 },
  { id: 'TST202', registrationNumber: 'TST202', model: 'Sintetinis Sprinter', maximumPayloadKg: 1400 },
];

let server: Server | undefined;
let baseUrl = '';

function token(user: UserKey): string {
  return `token-${user}`;
}

function seedUsersAndVehicles(): void {
  for (const [key, user] of Object.entries(USERS)) {
    inMemoryFirestore.seed('tsp_users', user.id, {
      ...user,
      disabled: false,
      compensation: null,
      pinSalt: 'x',
      pinHash: 'x',
      pinIterations: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    inMemoryFirestore.seed('tsp_sessions', createHash('sha256').update(token(key as UserKey)).digest('hex'), {
      userId: user.id,
      createdAt: NOW,
      expiresAt: FAR_FUTURE,
      lastSeenAt: NOW,
    });
  }
  for (const vehicle of VEHICLES) {
    inMemoryFirestore.seed('tsp_vehicles', vehicle.id, { ...vehicle, assignedDriverId: null, createdAt: NOW, updatedAt: NOW });
  }
}

async function api<T = unknown>(user: UserKey, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token(user)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function createAccountingTrip(input: {
  date: string;
  driverId: string;
  vehicleId: string;
  routeLabel: string;
  totalStops: number;
  totalWeightKg: number;
  startOdometer?: number | null;
  endOdometer?: number | null;
}): Promise<ServerRouteAssignment> {
  const created = await api<{ assignment: ServerRouteAssignment }>('admin', 'POST', '/api/admin/accounting-trips', {
    startOdometer: null,
    endOdometer: null,
    startedClock: '07:00',
    completedClock: '15:00',
    ...input,
  });
  expect(created.status).toBe(201);
  return created.body.assignment;
}

type Fixture = {
  jonasDay3: ServerRouteAssignment;
  jonasDay4: ServerRouteAssignment;
  petrasDay3: ServerRouteAssignment;
  jonasOdometerDay: ServerRouteAssignment;
  liveDelivery: ServerRouteAssignment;
};

async function seedFixture(): Promise<Fixture> {
  const jonasDay3 = await createAccountingTrip({ date: '2026-09-03', driverId: USERS.jonas.id, vehicleId: 'TST101', routeLabel: 'Servisas', totalStops: 2, totalWeightKg: 40 });
  const jonasDay4 = await createAccountingTrip({ date: '2026-09-04', driverId: USERS.jonas.id, vehicleId: 'TST101', routeLabel: 'Sandėlis', totalStops: 1, totalWeightKg: 10 });
  const petrasDay3 = await createAccountingTrip({ date: '2026-09-03', driverId: USERS.petras.id, vehicleId: 'TST202', routeLabel: 'Petro reisas', totalStops: 3, totalWeightKg: 90 });
  const jonasOdometerDay = await createAccountingTrip({
    date: '2026-09-08', driverId: USERS.jonas.id, vehicleId: 'TST101', routeLabel: 'Su odometru', totalStops: 1, totalWeightKg: 5, startOdometer: 10_000, endOdometer: 10_080,
  });
  // A live delivery route: same shape, but not an accounting-* route and it has stops.
  const liveDelivery: ServerRouteAssignment = {
    ...jonasDay3,
    id: 'live-delivery-0001',
    routeId: 'route-live-0001',
    routeSnapshot: {
      ...jonasDay3.routeSnapshot,
      route: {
        ...jonasDay3.routeSnapshot.route,
        id: 'route-live-0001',
        date: '2026-09-05',
        started_at: '2026-09-05T05:00:00.000Z',
        completed_at: '2026-09-05T13:00:00.000Z',
      },
      stops: [{ id: 'stop-live-1', delivery_status: 'delivered', weight_kg: 30 }],
    },
  };
  inMemoryFirestore.seed('tsp_assignments', liveDelivery.id, { ...liveDelivery, createdBy: USERS.admin.id });
  // Fuel saved against the accounting trip that will be deleted, plus a fuel
  // fill on another day. Neither may be touched by the delete.
  inMemoryFirestore.seed('tsp_fuel_entries', 'fuel-jonas-day3', {
    id: 'fuel-jonas-day3', tripSheetId: jonasDay3.id, assignmentId: jonasDay3.id, routeId: jonasDay3.routeId,
    driverId: USERS.jonas.id, driverName: USERS.jonas.displayName, vehicleId: 'TST101', registrationNumber: 'TST101',
    filledAt: '2026-09-03T10:00:00.000Z', odometer: 9_990, liters: 35, pricePerLiter: 1.5, totalCost: 52.5,
    station: 'Sintetinė', receiptNumber: 'SYN-1', notes: null, createdAt: NOW, createdBy: USERS.admin.id,
  });
  inMemoryFirestore.seed('tsp_fuel_entries', 'fuel-petras-day3', {
    id: 'fuel-petras-day3', tripSheetId: petrasDay3.id, assignmentId: petrasDay3.id, routeId: petrasDay3.routeId,
    driverId: USERS.petras.id, driverName: USERS.petras.displayName, vehicleId: 'TST202', registrationNumber: 'TST202',
    filledAt: '2026-09-03T11:00:00.000Z', odometer: 20_000, liters: 20, pricePerLiter: 1.5, totalCost: 30,
    station: 'Sintetinė', receiptNumber: 'SYN-2', notes: null, createdAt: NOW, createdBy: USERS.admin.id,
  });
  // Cloud copies of the routes, so the tombstone path is exercised too.
  for (const routeId of [jonasDay3.routeId, liveDelivery.routeId]) {
    inMemoryFirestore.seed('tsp_routes', routeId, { routeId, ownerEmployeeId: USERS.jonas.id, deleted: false, clientUpdatedAt: NOW });
  }
  // Manual wage adjustments for the same driver/date and for others.
  for (const [driver, date, amountEur, comment] of [
    ['jonas', '2026-09-03', 15, 'Priedas'],
    ['jonas', '2026-09-04', -5, 'Korekcija'],
    ['petras', '2026-09-03', 0, 'Tik komentaras'],
  ] as const) {
    const response = await api('admin', 'PUT', '/api/admin/wage-adjustments', { driverId: USERS[driver].id, date, amountEur, comment });
    expect(response.status).toBe(200);
  }
  return { jonasDay3, jonasDay4, petrasDay3, jonasOdometerDay, liveDelivery };
}

async function report(user: UserKey = 'admin') {
  const [assignments, sheets, adjustments] = await Promise.all([
    api<{ assignments: ServerRouteAssignment[] }>(user, 'GET', '/api/admin/assignments'),
    api<{ tripSheets: ServerTripSheet[] }>(user, 'GET', '/api/trip-sheets'),
    api<{ adjustments: WageAdjustment[] }>(user, 'GET', '/api/admin/wage-adjustments?from=2026-09-01&to=2026-09-30'),
  ]);
  expect([assignments.status, sheets.status, adjustments.status]).toEqual([200, 200, 200]);
  const month = buildMonthSummary({
    year: 2026,
    month: 9,
    assignments: assignments.body.assignments.map((item) => ({ ...item, vehicle: item.vehicle ?? null })),
    tripSheets: sheets.body.tripSheets,
  });
  const wageDays = aggregateWageDays(sheets.body.tripSheets, adjustments.body.adjustments);
  return {
    assignments: assignments.body.assignments,
    tripSheets: sheets.body.tripSheets,
    adjustments: adjustments.body.adjustments,
    month,
    wageDays,
    totals: summarizeWageDays(wageDays),
  };
}

function untouchedCollections() {
  return {
    fuel: inMemoryFirestore.list('tsp_fuel_entries'),
    readings: inMemoryFirestore.list('tsp_vehicle_day_readings'),
    adjustments: inMemoryFirestore.list('tsp_wage_adjustments'),
    users: inMemoryFirestore.list('tsp_users'),
    vehicles: inMemoryFirestore.list('tsp_vehicles'),
  };
}

beforeAll(async () => {
  vi.stubEnv('TSP_INITIAL_ADMIN_PIN', '');
  for (const name of ONE_SHOT_MIGRATIONS) {
    vi.spyOn(EmployeeAuthStore.prototype, name).mockResolvedValue({ applied: false, reason: 'disabled in tests' } as never);
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    void handleEmployeeApi(request, response, pathname, 'test-request').then((handled) => {
      if (!handled) { response.writeHead(404); response.end(); }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // beforeAll may fail before listen(); only close a started server.
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  inMemoryFirestore.reset();
  seedUsersAndVehicles();
});

describe('DELETE /api/admin/accounting-trips/:id (runtime, in-memory store)', () => {
  it('requires the finance permission: driver and dispatcher without canManageFinancials get 403 and nothing is removed', async () => {
    const fixture = await seedFixture();
    const before = inMemoryFirestore.ids('tsp_assignments');
    for (const user of ['jonas', 'plainDispatcher'] as const) {
      const response = await api<{ error: { code: string } }>(user, 'DELETE', `/api/admin/accounting-trips/${fixture.jonasDay3.id}`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
    expect(inMemoryFirestore.ids('tsp_assignments')).toEqual(before);

    const dispatcher = await api('financeDispatcher', 'DELETE', `/api/admin/accounting-trips/${fixture.jonasDay3.id}`);
    expect(dispatcher.status).toBe(204);
    expect(inMemoryFirestore.read('tsp_assignments', fixture.jonasDay3.id)).toBeUndefined();

    const admin = await api('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.petrasDay3.id}`);
    expect(admin.status).toBe(204);
    expect(inMemoryFirestore.read('tsp_assignments', fixture.petrasDay3.id)).toBeUndefined();
  });

  it('rejects a session-less request with 401', async () => {
    const fixture = await seedFixture();
    const response = await fetch(`${baseUrl}/api/admin/accounting-trips/${fixture.jonasDay3.id}`, { method: 'DELETE' });
    expect(response.status).toBe(401);
    expect(inMemoryFirestore.read('tsp_assignments', fixture.jonasDay3.id)).toBeDefined();
  });

  it('refuses to delete a live delivery route (non accounting-* routeId) and keeps it', async () => {
    const fixture = await seedFixture();
    const response = await api<{ error: { code: string } }>('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.liveDelivery.id}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('NOT_ACCOUNTING_TRIP');
    expect(inMemoryFirestore.read('tsp_assignments', fixture.liveDelivery.id)).toMatchObject({ routeId: 'route-live-0001' });
    expect(inMemoryFirestore.read('tsp_routes', 'route-live-0001')).toMatchObject({ deleted: false });
  });

  it('returns 404 for an unknown id and for a second delete of the same record', async () => {
    const fixture = await seedFixture();
    const before = inMemoryFirestore.ids('tsp_assignments');
    const unknown = await api<{ error: { code: string } }>('admin', 'DELETE', '/api/admin/accounting-trips/aaaaaaaa-0000-0000-0000-000000000000');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ASSIGNMENT_NOT_FOUND');
    expect(inMemoryFirestore.ids('tsp_assignments')).toEqual(before);

    expect((await api('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.jonasDay4.id}`)).status).toBe(204);
    const again = await api<{ error: { code: string } }>('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.jonasDay4.id}`);
    expect(again.status).toBe(404);
  });

  it('rejects malformed ids with 400 INVALID_ID and changes nothing', async () => {
    await seedFixture();
    const before = untouchedCollections();
    const assignmentIds = inMemoryFirestore.ids('tsp_assignments');
    for (const id of ['short', 'has%20space', 'dot.dot.dot.dot', '%2E%2E%2Ftsp_users', 'x'.repeat(81)]) {
      const response = await api<{ error: { code: string } }>('admin', 'DELETE', `/api/admin/accounting-trips/${id}`);
      expect(response.status, id).toBe(400);
      expect(response.body.error.code, id).toBe('INVALID_ID');
    }
    // A slash splits the path, so it never reaches the handler as one id.
    const nested = await api('admin', 'DELETE', '/api/admin/accounting-trips/aaaaaaaa/bbbbbbbb');
    expect(nested.status).toBe(404);
    expect(inMemoryFirestore.ids('tsp_assignments')).toEqual(assignmentIds);
    expect(untouchedCollections()).toEqual(before);
  });

  it('removes only the selected record: other drivers, dates, routes, fuel, odometers and wage adjustments stay', async () => {
    const fixture = await seedFixture();
    const before = untouchedCollections();
    const response = await api('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.jonasDay3.id}`);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();

    expect(inMemoryFirestore.ids('tsp_assignments')).toEqual(
      [fixture.jonasDay4.id, fixture.petrasDay3.id, fixture.jonasOdometerDay.id, fixture.liveDelivery.id].sort(),
    );
    expect(untouchedCollections()).toEqual(before);
    expect(before.fuel.map((entry) => entry.id).sort()).toEqual(['fuel-jonas-day3', 'fuel-petras-day3']);
    expect(before.readings).toHaveLength(1);
    expect(before.adjustments).toHaveLength(3);
    // Route-sync copy of the deleted accounting route is tombstoned, the live one is not.
    expect(inMemoryFirestore.read('tsp_routes', fixture.jonasDay3.routeId)).toMatchObject({ deleted: true });
    expect(inMemoryFirestore.read('tsp_routes', fixture.liveDelivery.routeId)).toMatchObject({ deleted: false });
  });

  it('the removed record disappears from the month summary, the trip sheets and the wage total; nothing else changes', async () => {
    const fixture = await seedFixture();
    const before = await report();
    const deletedDay = before.wageDays.find((day) => day.key === `${USERS.jonas.id}:2026-09-03`)!;
    expect(deletedDay.sheets.map((sheet) => sheet.assignmentId)).toEqual([fixture.jonasDay3.id]);
    expect(deletedDay.figures.wageEur).toBeGreaterThan(0);
    expect(before.month.rows.some((row) => row.assignmentId === fixture.jonasDay3.id && row.canDelete)).toBe(true);
    expect(before.month.rows.find((row) => row.assignmentId === fixture.liveDelivery.id)?.canDelete).toBe(false);

    expect((await api('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.jonasDay3.id}`)).status).toBe(204);
    const after = await report();

    // Month summary: the manual row is gone, every other row is unchanged.
    expect(after.month.rows.some((row) => row.assignmentId === fixture.jonasDay3.id)).toBe(false);
    const rowsWithout = (rows: typeof before.month.rows) => rows
      .filter((row) => row.source !== 'empty' && row.assignmentId !== fixture.jonasDay3.id && row.source !== 'fuel-day')
      .map((row) => ({ key: row.key, driverId: row.driverId, stops: row.totalStops, weight: row.totalWeightKg, km: row.distanceKm }));
    expect(rowsWithout(after.month.rows)).toEqual(rowsWithout(before.month.rows));

    // Trip sheets: no sheet left for the deleted assignment or its route.
    expect(after.tripSheets.some((sheet) => sheet.assignmentId === fixture.jonasDay3.id || sheet.routeId === fixture.jonasDay3.routeId)).toBe(false);
    const otherSheets = (sheets: ServerTripSheet[]) => sheets
      .filter((sheet) => sheet.assignmentId !== fixture.jonasDay3.id && !(sheet.driverId === USERS.jonas.id && sheet.date === '2026-09-03'))
      .map((sheet) => ({ id: sheet.id, date: sheet.date, driverId: sheet.driverId, km: sheet.actualDistanceKm, stops: sheet.totalStops, pay: sheet.compensation?.totalNetEur ?? null }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(otherSheets(after.tripSheets)).toEqual(otherSheets(before.tripSheets));

    // The fuel fill survives as a fuel-only day; it carries no wage.
    const fuelDay = after.tripSheets.filter((sheet) => sheet.vehicle?.id === 'TST101' && sheet.date === '2026-09-03');
    expect(fuelDay.flatMap((sheet) => sheet.fuelEntries.map((entry) => entry.id))).toEqual(['fuel-jonas-day3']);

    // Wage: the day's calculated wage is gone, the separate manual adjustment stays.
    const afterDay = after.wageDays.find((day) => day.key === `${USERS.jonas.id}:2026-09-03`)!;
    expect(afterDay.sheets.every((sheet) => sheet.assignmentId !== fixture.jonasDay3.id)).toBe(true);
    expect(afterDay.manualAdjustment).toMatchObject({ amountEur: 15, comment: 'Priedas' });
    const removedWage = deletedDay.figures.wageEur! - (afterDay.figures.wageEur ?? 0);
    expect(removedWage).toBeGreaterThan(0);
    expect(after.totals.wageEur).toBeCloseTo(before.totals.wageEur - removedWage, 2);
    expect(after.totals.extraEur).toBe(before.totals.extraEur);

    // Every other driver/day keeps exactly the same pay.
    const payByDay = (days: typeof before.wageDays) => Object.fromEntries(days
      .filter((day) => day.key !== `${USERS.jonas.id}:2026-09-03`)
      .map((day) => [day.key, day.figures.payEur]));
    expect(payByDay(after.wageDays)).toEqual(payByDay(before.wageDays));
  });

  it('deleting a trip that wrote an odometer day keeps the odometer reading itself', async () => {
    const fixture = await seedFixture();
    const readingBefore = inMemoryFirestore.list('tsp_vehicle_day_readings');
    expect(readingBefore).toEqual([expect.objectContaining({ vehicleId: 'TST101', date: '2026-09-08', startOdometer: 10_000, endOdometer: 10_080 })]);
    expect((await api('admin', 'DELETE', `/api/admin/accounting-trips/${fixture.jonasOdometerDay.id}`)).status).toBe(204);
    expect(inMemoryFirestore.list('tsp_vehicle_day_readings')).toEqual(readingBefore);
    const after = await report();
    expect(after.tripSheets.some((sheet) => sheet.assignmentId === fixture.jonasOdometerDay.id)).toBe(false);
    expect(after.month.rows.some((row) => row.assignmentId === fixture.jonasOdometerDay.id)).toBe(false);
    // The surviving odometer day is a separate, non-deletable record.
    const odometerRows = after.month.rows.filter((row) => row.source === 'odometer-day' && row.date === '2026-09-08');
    expect(odometerRows).toHaveLength(1);
    expect(odometerRows[0]!.canDelete).toBe(false);
  });

  it('wage adjustment removal (PUT amount 0 without comment) clears only that driver/date', async () => {
    await seedFixture();
    const response = await api<{ adjustment: unknown }>('admin', 'PUT', '/api/admin/wage-adjustments', {
      driverId: USERS.jonas.id, date: '2026-09-03', amountEur: 0, comment: '',
    });
    expect(response.status).toBe(200);
    expect(response.body.adjustment).toBeNull();
    expect(inMemoryFirestore.ids('tsp_wage_adjustments')).toEqual([
      `${USERS.jonas.id}:2026-09-04`,
      `${USERS.petras.id}:2026-09-03`,
    ]);
    const forbidden = await api('plainDispatcher', 'PUT', '/api/admin/wage-adjustments', {
      driverId: USERS.jonas.id, date: '2026-09-04', amountEur: 0, comment: '',
    });
    expect(forbidden.status).toBe(403);
    expect(inMemoryFirestore.ids('tsp_wage_adjustments')).toHaveLength(2);
  });
});
