import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportRouteSnapshot, importAssignmentSnapshot, reconcileAssignedRouteCopies } from '../../src/application/auth/route-assignment-sync';
import { CreateDraftRoute, ReplaceDraftStops } from '../../src/application/routes/route-commands';
import {
  clearEmployeeSession,
  employeeApi,
  getEmployeeSession,
  loginEmployee,
  saveEmployeeSession,
  type ServerRouteAssignment,
} from '../../src/infrastructure/auth/employee-session';

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

const migrationSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
const accessGateSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/local-access-gate.tsx'), 'utf8');
const settingsSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/settings/index.tsx'), 'utf8');
const employeeApiSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../server/employee-api.ts'), 'utf8');
const employeeStoreSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../server/employee-auth-store.ts'), 'utf8');
const employeeRouteSyncStoreSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../server/route-sync-store.ts'), 'utf8');
const assignmentSyncSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/application/auth/route-assignment-sync.ts'), 'utf8');
const adminSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/admin.tsx'), 'utf8');
const tripSheetSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/trip-sheet.tsx'), 'utf8');
const deliverySource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/route/[id]/delivery.tsx'), 'utf8');
const homeSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/index.tsx'), 'utf8');
function migration(version: number): string {
  const match = migrationSource.match(new RegExp(`const migrationV${version} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration V${version}`);
  return match[1];
}
function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= 17; version += 1) adapter.raw.exec(migration(version));
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const profile = { id: 'employee-12345678', username: 'vairuotojas', displayName: 'Jonas Jonaitis', role: 'driver' as const, disabled: false };

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearEmployeeSession();
});

describe('employee server session', () => {
  it('migrates the legacy administrator identity before accepting authentication requests', () => {
    expect(employeeApiSource).toContain("fromUsername: 'admln'");
    expect(employeeApiSource).toContain("username: 'sensejus'");
    expect(employeeApiSource).toContain('await ensureLegacyAdminMigrated()');
    expect(employeeStoreSource).toContain('async migrateLegacyAdmin');
    expect(employeeStoreSource).toContain('...pinCredentials(username, input.pin)');
    expect(employeeStoreSource).toContain('transaction.delete(legacyUsernameRef)');
  });

  it('restores a saved session automatically and keeps logout explicit', () => {
    expect(accessGateSource).toContain('setUnlocked(Boolean(cachedSession))');
    expect(accessGateSource).toContain('await logoutEmployee()');
    expect(settingsSource).toContain('testID="logout-button"');
  });

  it('keeps the central fleet on the server and exposes admin create and assignment controls', () => {
    expect(employeeApiSource).toContain("pathname === '/api/admin/vehicles'");
    expect(employeeApiSource).toContain("pathname.match(/^\\/api\\/admin\\/vehicles\\/([^/]+)$/)");
    expect(employeeStoreSource).toContain("collection('tsp_vehicles')");
    expect(employeeStoreSource).toContain("where('assignedDriverId', '==', driverId)");
    expect(adminSource).toContain('testID="fleet-vehicle-management"');
    expect(adminSource).toContain('Miestas automobiliams nesaugomas');
    expect(adminSource).toContain('testID={`${testPrefix}-side-door-yes`}');
    expect(adminSource).toContain('hasSideDoor: editVehicleSideDoor');
    expect(employeeStoreSource).toContain('hasSideDoor: vehicle.hasSideDoor === true');
    expect(employeeStoreSource).toContain('cargoBodyKind: isVanBodyKind(vehicle.cargoBodyKind)');
    expect(adminSource).toContain('Patvirtinti priskyrimą');
    expect(employeeApiSource).toContain("pathname === '/api/operations/vehicle-faults'");
    expect(employeeApiSource).toContain("pathname === '/api/admin/vehicle-faults'");
    expect(employeeStoreSource).toContain("collection('tsp_vehicle_faults')");
    expect(adminSource).toContain('testID="vehicle-fault-inbox"');
    expect(employeeApiSource).toContain("pathname === '/api/operations/departure-overrides'");
    expect(employeeApiSource).toContain("pathname === '/api/admin/departure-overrides'");
    expect(employeeStoreSource).toContain("collection('tsp_departure_overrides')");
    expect(adminSource).toContain('testID="departure-override-inbox"');
  });

  it('allows an administrator to rename an employee login safely', () => {
    expect(adminSource).toContain('username: editEmployeeUsername');
    expect(adminSource).toContain("'Prisijungimo vardas'");
    expect(employeeApiSource).toContain("username: optionalString(body, 'username')");
    expect(employeeStoreSource).toContain('USERNAME_CHANGE_REQUIRES_PIN');
    expect(employeeStoreSource).toContain('transaction.set(nextUsernameRef');
    expect(employeeStoreSource).toContain('transaction.delete(previousUsernameRef)');
  });

  it('lets an administrator close a hanging assignment as completed', () => {
    expect(employeeApiSource).toContain("pathname.match(/^\\/api\\/admin\\/assignments\\/([^/]+)\\/complete$/)");
    expect(employeeStoreSource).toContain('async completeAssignment');
    expect(employeeStoreSource).toContain("ASSIGNMENT_CANCELLED");
    expect(assignmentSyncSource).toContain('export async function completeAssignedRoute');
    expect(assignmentSyncSource).toContain('AdminCompleteRoute');
    expect(adminSource).toContain('completeLocalRoute');
    expect(adminSource).toContain('completeServerAssignment');
  });

  it('publishes completed driver routes as role-scoped trip sheets', () => {
    expect(employeeApiSource).toContain("pathname === '/api/trip-sheets'");
    expect(employeeStoreSource).toContain('async listTripSheets');
    expect(employeeStoreSource).toContain("assignment.status === 'completed'");
    expect(employeeStoreSource).toContain('fuelNormLitersPer100Km: tripSheetFuelNorm');
    expect(tripSheetSource).toContain("employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets')");
    expect(tripSheetSource).toContain('Spausdinti / PDF');
    expect(deliverySource).toContain('await pushRouteAssignmentProgress(db, routeId)');
    expect(homeSource).toContain('await pushCompletedRouteAssignmentProgress(db)');
  });

  it('stores real fuel refills against a completed trip sheet', () => {
    expect(employeeApiSource).toContain("/fuel-entries$/");
    expect(employeeApiSource).toContain('await store.addFuelEntry');
    expect(employeeStoreSource).toContain("private readonly fuelEntries = this.db.collection('tsp_fuel_entries')");
    expect(employeeStoreSource).toContain('async addFuelEntry');
    expect(employeeStoreSource).toContain("assignment.status !== 'completed'");
    expect(employeeStoreSource).toContain('fuelEntries: (entriesByAssignment.get(sheet.assignmentId) ?? [])');
  });

  it('allows management actions only to an admin or an explicitly permitted dispatcher', () => {
    expect(employeeApiSource).toContain("requireManagementPermission(profile, 'canManageEmployees')");
    expect(employeeApiSource).toContain("requireManagementPermission(profile, 'canManageVehicles')");
    expect(employeeApiSource).toContain("requireManagementPermission(profile, 'canManageFinancials')");
    expect(employeeApiSource).toContain("profile.role === 'admin' ? users : users.filter((user) => user.role === 'driver')");
    expect(employeeApiSource).toContain('Dispečeris gali redaguoti tik vairuotojus.');
  });

  it('transfers assignment ownership and pulls newer progress onto every driver device', () => {
    expect(employeeRouteSyncStoreSource).toContain('async seedAssignment(employeeId: string, routeSnapshot: RouteSnapshot)');
    expect(employeeApiSource).toContain('await routeSyncStore.seedAssignment(assignment.driverId, assignment.routeSnapshot)');
    expect(assignmentSyncSource).toContain("assignment.updatedAt > String(existingSync.server_revision ?? '')");
    expect(assignmentSyncSource).toContain('await applyRouteSnapshot(db, assignment.routeSnapshot, assignment.updatedAt, profile.id)');
    expect(assignmentSyncSource).toContain("response.assignments.filter((item) => item.status !== 'cancelled')");
    expect(assignmentSyncSource).toContain('pushRouteAssignmentRevision');
    expect(deliverySource).toContain('pullAssignedRoutes(db, profile)');
  });

  it('stores a successful login and includes the secure same-origin session cookie in employee API calls', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ profile, expiresAt: '2099-01-01T00:00:00.000Z' }))
      .mockResolvedValueOnce(Response.json({ users: [] }));
    await loginEmployee('vairuotojas', '123456', fetcher as typeof fetch);
    expect((await getEmployeeSession())?.profile).toEqual(profile);
    await employeeApi('/api/admin/users', {}, fetcher as typeof fetch);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('keeps the cached local session until explicit logout even if the server expiry passes', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2020-01-01T00:00:00.000Z' });
    expect((await getEmployeeSession())?.profile).toEqual(profile);
  });
});

describe('employee route assignment offline copy', () => {
  it('migrates schema v13 and imports the same assignment idempotently', async () => {
    const source = createDb();
    const endpoint = { originalAddress: 'Sandėlio g. 1, Vilnius', geocodingQuery: 'Sandėlio g. 1, Vilnius', normalizedAddress: 'Sandėlio g. 1, Vilnius', latitude: 54.68, longitude: 25.27 };
    await new CreateDraftRoute(source.db).execute({ id: 'route-server-1', startLocation: endpoint, endLocation: endpoint });
    await new ReplaceDraftStops(source.db, undefined, () => 'db-stop-1').execute('route-server-1', [{
      id: 'source-stop-1', originalOrder: 1, orderNumber: null, recipient: 'Klientas', originalAddress: 'Gedimino pr. 9, Vilnius',
      geocodingQuery: 'Gedimino pr. 9, Vilnius', normalizedAddress: 'Gedimino pr. 9, Vilnius', addressValidationState: 'auto_confirmed',
      latitude: 54.68, longitude: 25.28, deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false,
      weightKg: 25, phone: null, notes: null,
    }]);
    const snapshot = await exportRouteSnapshot(source.db, 'route-server-1');
    const target = createDb();
    const assignment: ServerRouteAssignment = {
      id: 'assignment-12345678', routeId: 'route-server-1', driverId: profile.id, driverName: profile.displayName,
      status: 'assigned', routeSnapshot: snapshot, progress: null,
      assignedAt: '2026-08-09T08:00:00.000Z', updatedAt: '2026-08-09T08:00:00.000Z',
    };
    await importAssignmentSnapshot(target.db, assignment, profile.id);
    await importAssignmentSnapshot(target.db, assignment, profile.id);
    expect(target.adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 17 });
    expect(target.adapter.raw.prepare('SELECT count(*) AS count FROM routes').get()).toMatchObject({ count: 1 });
    expect(target.adapter.raw.prepare('SELECT count(*) AS count FROM delivery_stops').get()).toMatchObject({ count: 1 });
    expect(target.adapter.raw.prepare('SELECT employee_id, sync_status FROM route_sync_state').get()).toMatchObject({ employee_id: profile.id, sync_status: 'synced' });
  });

  it('removes cancelled or deleted server assignments from the driver device', async () => {
    const target = createDb();
    const endpoint = { originalAddress: 'Sandėlio g. 1, Vilnius', geocodingQuery: 'Sandėlio g. 1, Vilnius', normalizedAddress: 'Sandėlio g. 1, Vilnius', latitude: 54.68, longitude: 25.27 };
    await new CreateDraftRoute(target.db).execute({ id: 'route-stale-1', startLocation: endpoint, endLocation: endpoint });
    await new ReplaceDraftStops(target.db, undefined, () => 'stale-stop-1').execute('route-stale-1', [{
      id: 'stale-source-1', originalOrder: 1, orderNumber: null, recipient: 'Klientas', originalAddress: 'Gedimino pr. 9, Vilnius',
      geocodingQuery: 'Gedimino pr. 9, Vilnius', normalizedAddress: 'Gedimino pr. 9, Vilnius', addressValidationState: 'auto_confirmed',
      latitude: 54.68, longitude: 25.28, deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false,
      weightKg: 25, phone: null, notes: null,
    }]);
    const now = new Date().toISOString();
    await target.db.runAsync(
      `INSERT INTO route_sync_state (assignment_id, route_id, employee_id, server_revision, sync_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'synced', ?, ?)`,
      'assignment-stale-1', 'route-stale-1', profile.id, now, now, now,
    );

    expect(await reconcileAssignedRouteCopies(target.db, profile.id, [])).toBe(1);
    expect(target.adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 0 });
    expect(target.adapter.raw.prepare('SELECT COUNT(*) AS count FROM route_sync_state').get()).toMatchObject({ count: 0 });
  });
});
