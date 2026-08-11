import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exportRouteSnapshot, importAssignmentSnapshot } from '../../src/application/auth/route-assignment-sync';
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
  it('restores a saved session automatically and keeps logout explicit', () => {
    expect(accessGateSource).toContain('setUnlocked(Boolean(cachedSession))');
    expect(accessGateSource).toContain('await logoutEmployee()');
    expect(settingsSource).toContain('testID="logout-button"');
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
});
