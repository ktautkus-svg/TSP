import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { markRouteDeletedForCloud, syncRoutesWithCloud } from '../../src/application/sync/route-cloud-sync';
import { clearEmployeeSession, saveEmployeeSession } from '../../src/infrastructure/auth/employee-session';

class ExpoLikeDatabase {
  readonly raw = new DatabaseSync(':memory:');
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
const schemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)![1]);

function migration(version: number): string {
  const match = migrationSource.match(new RegExp(`const migrationV${version} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration V${version}`);
  return match[1];
}

function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= schemaVersion; version += 1) adapter.raw.exec(migration(version));
  adapter.raw.exec('PRAGMA foreign_keys = ON;');
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const driverA = { id: 'employee-a', username: 'vairuotojas.a', displayName: 'Jonas Jonaitis', role: 'driver' as const, disabled: false };
const driverB = { id: 'employee-b', username: 'vairuotojas.b', displayName: 'Petras Petraitis', role: 'driver' as const, disabled: false };

function insertRoute(adapter: ExpoLikeDatabase, overrides: Partial<{
  id: string; status: string; createdAt: string; updatedAt: string; owner: string | null; cloudSyncedAt: string | null; cloudDeletedAt: string | null;
}> = {}) {
  const id = overrides.id ?? 'route-1';
  const createdAt = overrides.createdAt ?? '2026-08-11T08:00:00.000Z';
  const updatedAt = overrides.updatedAt ?? createdAt;
  adapter.raw.prepare(
    `INSERT INTO routes (id, date, status, total_weight_kg, total_stops, created_at, updated_at, owner_employee_id, cloud_synced_at, cloud_deleted_at)
     VALUES (?, '2026-08-11', ?, 100, 1, ?, ?, ?, ?, ?)`,
  ).run(id, overrides.status ?? 'completed', createdAt, updatedAt, overrides.owner ?? null, overrides.cloudSyncedAt ?? null, overrides.cloudDeletedAt ?? null);
  adapter.raw.prepare(
    `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, created_at, updated_at)
     VALUES (?, ?, 1, 'Gavėjas', 'Adresas 1', ?, ?)`,
  ).run(`${id}-stop-1`, id, createdAt, updatedAt);
  return id;
}

type PushedRoute = { routeSnapshot: { route: { id: string } }; deleted: boolean };

/**
 * Answers the identity check with `serverProfile` — deliberately allowed to
 * differ from the cached client session, which is what the cross-account tests
 * need to prove.
 */
function stubCloud(options: {
  serverProfile: { id: string };
  pull?: { routes: unknown[]; cursor: string } | ((since: string | null) => { routes: unknown[]; cursor: string });
  onPush?: (routes: PushedRoute[]) => unknown;
}) {
  const pushed: PushedRoute[][] = [];
  const pullSince: Array<string | null> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) return Response.json({ profile: options.serverProfile });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { routes: PushedRoute[] };
      pushed.push(body.routes);
      const results = options.onPush?.(body.routes)
        ?? body.routes.map((route) => ({ routeId: route.routeSnapshot.route.id, outcome: 'applied' }));
      return Response.json({ results });
    }
    const since = new URL(url, 'http://localhost').searchParams.get('since');
    pullSince.push(since);
    const pull = typeof options.pull === 'function' ? options.pull(since) : options.pull;
    return Response.json(pull ?? { routes: [], cursor: '2026-08-11T12:00:00.000Z' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { pushed, pullSince, fetchMock };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearEmployeeSession();
});

describe('E. cross-account upload safety', () => {
  it('adopts the pre-existing local database for the first account that syncs on the device', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-legacy' });
    const cloud = stubCloud({ serverProfile: driverA });

    await syncRoutesWithCloud(db);

    expect(cloud.pushed[0]?.map((route) => route.routeSnapshot.route.id)).toEqual(['route-legacy']);
    const row = adapter.raw.prepare('SELECT owner_employee_id FROM routes WHERE id = ?').get('route-legacy') as { owner_employee_id: string };
    expect(row.owner_employee_id).toBe('employee-a');
  });

  it('never uploads employee A routes into employee B account after an account switch', async () => {
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-of-a' });

    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const firstPass = stubCloud({ serverProfile: driverA });
    await syncRoutesWithCloud(db);
    expect(firstPass.pushed[0]).toHaveLength(1);
    vi.unstubAllGlobals();

    // Employee B signs in on the same physical device.
    await saveEmployeeSession({ profile: driverB, expiresAt: '2099-01-01T00:00:00.000Z' });
    const secondPass = stubCloud({ serverProfile: driverB });
    const result = await syncRoutesWithCloud(db);

    expect(secondPass.pushed).toEqual([]);
    expect(result.foreign).toBe(1);
    const row = adapter.raw.prepare('SELECT owner_employee_id FROM routes WHERE id = ?').get('route-of-a') as { owner_employee_id: string };
    expect(row.owner_employee_id).toBe('employee-a');
  });

  it('leaves unclaimed legacy routes on the device instead of deleting them', async () => {
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-of-a' });
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    stubCloud({ serverProfile: driverA });
    await syncRoutesWithCloud(db);
    vi.unstubAllGlobals();

    await saveEmployeeSession({ profile: driverB, expiresAt: '2099-01-01T00:00:00.000Z' });
    stubCloud({ serverProfile: driverB });
    await syncRoutesWithCloud(db);

    expect(adapter.raw.prepare('SELECT count(*) AS count FROM routes').get()).toMatchObject({ count: 1 });
    expect(adapter.raw.prepare('SELECT count(*) AS count FROM delivery_stops').get()).toMatchObject({ count: 1 });
  });

  it('lets the second account sync the routes it creates itself', async () => {
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-of-a', createdAt: '2026-08-11T08:00:00.000Z' });
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    stubCloud({ serverProfile: driverA });
    await syncRoutesWithCloud(db);
    vi.unstubAllGlobals();

    await saveEmployeeSession({ profile: driverB, expiresAt: '2099-01-01T00:00:00.000Z' });
    const firstB = stubCloud({ serverProfile: driverB });
    await syncRoutesWithCloud(db);
    expect(firstB.pushed).toEqual([]);
    vi.unstubAllGlobals();

    // B now creates a route of their own, after the claim boundary was set.
    insertRoute(adapter, { id: 'route-of-b', createdAt: new Date().toISOString() });
    const secondB = stubCloud({ serverProfile: driverB });
    await syncRoutesWithCloud(db);

    expect(secondB.pushed[0]?.map((route) => route.routeSnapshot.route.id)).toEqual(['route-of-b']);
    const row = adapter.raw.prepare('SELECT owner_employee_id FROM routes WHERE id = ?').get('route-of-b') as { owner_employee_id: string };
    expect(row.owner_employee_id).toBe('employee-b');
  });

  it('scopes the upload by the server session, not by the cached client profile', async () => {
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-of-a' });
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    stubCloud({ serverProfile: driverA });
    await syncRoutesWithCloud(db);
    vi.unstubAllGlobals();

    // The cached profile still says A, but the session actually belongs to B.
    const stale = stubCloud({ serverProfile: driverB });
    const result = await syncRoutesWithCloud(db);

    expect(stale.pushed).toEqual([]);
    expect(result.foreign).toBe(1);
  });
});

describe('G. deferred routes are retried, not lost', () => {
  const remoteActive = {
    route: {
      id: 'route-from-phone', date: '2026-08-11', status: 'planned', total_weight_kg: 480, total_stops: 1,
      created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z',
    },
    stops: [{
      id: 'route-from-phone-stop-1', route_id: 'route-from-phone', original_order: 1,
      recipient: 'Gavėjas', address: 'Gedimino pr. 9, Vilnius', weight_kg: 480,
      created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z',
    }],
    shipmentLines: [],
  };
  const remoteItem = { routeSnapshot: remoteActive, deleted: false, serverUpdatedAt: '2026-08-11T07:00:01.000Z' };

  it('applies a deferred route on a later pass, after the cursor has moved past it', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    // This device is already working a different route.
    insertRoute(adapter, { id: 'route-local-active', status: 'in_progress', owner: 'employee-a', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });

    // First pass: the cloud offers the other device's route; it cannot be applied.
    stubCloud({
      serverProfile: driverA,
      pull: (since) => (since ? { routes: [], cursor: '2026-08-11T12:00:00.000Z' } : { routes: [remoteItem], cursor: '2026-08-11T07:00:01.000Z' }),
    });
    const first = await syncRoutesWithCloud(db);

    expect(first.deferred).toBe(1);
    expect(adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-from-phone')).toBeUndefined();
    const deferral = adapter.raw.prepare('SELECT employee_id, attempts FROM route_sync_deferrals WHERE route_id = ?').get('route-from-phone') as { employee_id: string; attempts: number };
    expect(deferral).toMatchObject({ employee_id: 'employee-a', attempts: 1 });

    // The blocker finishes. The server has nothing new to offer any more — the
    // cursor is already past the deferred route.
    adapter.raw.prepare("UPDATE routes SET status = 'completed', completed_at = ? WHERE id = ?").run('2026-08-11T11:00:00.000Z', 'route-local-active');
    const second = await syncRoutesWithCloud(db);

    expect(second.pulled).toBe(1);
    const applied = adapter.raw.prepare('SELECT status, total_weight_kg FROM routes WHERE id = ?').get('route-from-phone') as { status: string; total_weight_kg: number };
    expect(applied).toMatchObject({ status: 'planned', total_weight_kg: 480 });
    expect(adapter.raw.prepare('SELECT route_id FROM route_sync_deferrals').all()).toEqual([]);
  });

  it('keeps deferring while the blocker is still there, counting attempts', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-local-active', status: 'in_progress', owner: 'employee-a', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });
    stubCloud({
      serverProfile: driverA,
      pull: (since) => (since ? { routes: [], cursor: '2026-08-11T12:00:00.000Z' } : { routes: [remoteItem], cursor: '2026-08-11T07:00:01.000Z' }),
    });

    await syncRoutesWithCloud(db);
    const second = await syncRoutesWithCloud(db);

    expect(second.deferred).toBe(1);
    const deferral = adapter.raw.prepare('SELECT attempts FROM route_sync_deferrals WHERE route_id = ?').get('route-from-phone') as { attempts: number };
    expect(deferral.attempts).toBe(2);
  });

  it('never lets an older cloud copy overwrite newer local work', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, {
      id: 'route-from-phone', status: 'in_progress', owner: 'employee-a',
      createdAt: '2026-08-11T07:00:00.000Z', updatedAt: '2026-08-11T10:00:00.000Z',
      cloudSyncedAt: '2026-08-11T07:00:00.000Z',
    });
    stubCloud({ serverProfile: driverA, pull: { routes: [remoteItem], cursor: '2026-08-11T12:00:00.000Z' } });

    await syncRoutesWithCloud(db);

    const route = adapter.raw.prepare('SELECT status, updated_at FROM routes WHERE id = ?').get('route-from-phone') as { status: string; updated_at: string };
    expect(route).toMatchObject({ status: 'in_progress', updated_at: '2026-08-11T10:00:00.000Z' });
  });
});

describe('H. deletion / tombstone propagation', () => {
  it('device A: marks a route deleted, pushes the tombstone and then drops the local row', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-doomed', status: 'cancelled', owner: 'employee-a', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });
    const cloud = stubCloud({ serverProfile: driverA });

    await markRouteDeletedForCloud(db, 'route-doomed');
    const result = await syncRoutesWithCloud(db);

    expect(cloud.pushed[0]).toHaveLength(1);
    expect(cloud.pushed[0]![0]!.deleted).toBe(true);
    expect(result.deleted).toBe(1);
    expect(adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-doomed')).toBeUndefined();
    expect(adapter.raw.prepare('SELECT id FROM delivery_stops WHERE route_id = ?').all('route-doomed')).toEqual([]);
  });

  it('device B: applies a pulled tombstone, unlinking the trip sheet that referenced the route', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-doomed', status: 'completed', owner: 'employee-a', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });
    adapter.raw.prepare(
      `INSERT INTO vehicles (id, name, registration_number, fuel_type, created_at, updated_at)
       VALUES ('vehicle-primary', 'Darbinis', 'ABC123', 'diesel', '2026-08-11T08:00:00.000Z', '2026-08-11T08:00:00.000Z')`,
    ).run();
    adapter.raw.prepare(
      `INSERT INTO trip_sheets (id, date, vehicle_id, start_location_json, end_location_json, created_at)
       VALUES ('trip-sheet-1', '2026-08-11', 'vehicle-primary', '{}', '{}', '2026-08-11T08:00:00.000Z')`,
    ).run();
    adapter.raw.prepare(
      `INSERT INTO trip_sheet_routes (trip_sheet_id, route_id, route_order) VALUES ('trip-sheet-1', 'route-doomed', 1)`,
    ).run();

    const tombstone = {
      routeSnapshot: {
        route: { id: 'route-doomed', date: '2026-08-11', status: 'cancelled', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' },
        stops: [{ id: 'route-doomed-stop-1', route_id: 'route-doomed', original_order: 1, recipient: 'G', address: 'A', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T08:00:00.000Z' }],
        shipmentLines: [],
      },
      deleted: true,
      serverUpdatedAt: '2026-08-11T09:00:01.000Z',
    };
    stubCloud({ serverProfile: driverA, pull: { routes: [tombstone], cursor: '2026-08-11T09:00:01.000Z' } });

    const result = await syncRoutesWithCloud(db);

    expect(result.deleted).toBe(1);
    expect(adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-doomed')).toBeUndefined();
    expect(adapter.raw.prepare('SELECT route_id FROM trip_sheet_routes').all()).toEqual([]);
    // The trip sheet itself survives; it is derived and regenerates.
    expect(adapter.raw.prepare('SELECT id FROM trip_sheets').all()).toHaveLength(1);
  });

  it('refuses to delete a route that is being driven right now, and retries later', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-active', status: 'in_progress', owner: 'employee-a', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });
    const tombstone = {
      routeSnapshot: {
        route: { id: 'route-active', date: '2026-08-11', status: 'cancelled', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' },
        stops: [{ id: 'route-active-stop-1', route_id: 'route-active', original_order: 1, recipient: 'G', address: 'A', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T08:00:00.000Z' }],
        shipmentLines: [],
      },
      deleted: true,
      serverUpdatedAt: '2026-08-11T09:00:01.000Z',
    };
    stubCloud({
      serverProfile: driverA,
      pull: (since) => (since ? { routes: [], cursor: '2026-08-11T12:00:00.000Z' } : { routes: [tombstone], cursor: '2026-08-11T09:00:01.000Z' }),
    });

    const first = await syncRoutesWithCloud(db);
    expect(first.deferred).toBe(1);
    expect(adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-active')).toBeTruthy();
    expect(adapter.raw.prepare('SELECT last_reason FROM route_sync_deferrals WHERE route_id = ?').get('route-active')).toMatchObject({ last_reason: 'ROUTE_IN_PROGRESS' });

    adapter.raw.prepare("UPDATE routes SET status = 'completed' WHERE id = ?").run('route-active');
    const second = await syncRoutesWithCloud(db);

    expect(second.deleted).toBe(1);
    expect(adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-active')).toBeUndefined();
  });

  it('is idempotent — a tombstone pulled twice stays a no-op the second time', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-doomed', status: 'completed', owner: 'employee-a', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });
    const tombstone = {
      routeSnapshot: {
        route: { id: 'route-doomed', date: '2026-08-11', status: 'cancelled', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' },
        stops: [{ id: 'route-doomed-stop-1', route_id: 'route-doomed', original_order: 1, recipient: 'G', address: 'A', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T08:00:00.000Z' }],
        shipmentLines: [],
      },
      deleted: true,
      serverUpdatedAt: '2026-08-11T09:00:01.000Z',
    };
    stubCloud({ serverProfile: driverA, pull: { routes: [tombstone], cursor: '2026-08-11T09:00:01.000Z' } });

    await syncRoutesWithCloud(db);
    const second = await syncRoutesWithCloud(db);

    expect(second.deleted).toBe(0);
    expect(adapter.raw.prepare('SELECT count(*) AS count FROM routes').get()).toMatchObject({ count: 0 });
  });
});

describe('I. bad records are isolated, not fatal', () => {
  it('pushes the good routes of a mixed batch and reports the rejected one', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-good', owner: 'employee-a' });
    insertRoute(adapter, { id: 'route-bad', owner: 'employee-a' });

    const cloud = stubCloud({
      serverProfile: driverA,
      onPush: (routes) => routes.map((route) => (route.routeSnapshot.route.id === 'route-bad'
        ? { routeId: 'route-bad', outcome: 'rejected', reason: 'Maršruto duomenys nepilni.' }
        : { routeId: route.routeSnapshot.route.id, outcome: 'applied' })),
      pull: { routes: [], cursor: '2026-08-11T12:00:00.000Z' },
    });

    const result = await syncRoutesWithCloud(db);

    expect(result.pushed).toBe(1);
    expect(result.rejected).toBe(1);
    // The pass completed: the pull ran despite the bad record.
    expect(cloud.pullSince).toEqual([null]);
    const good = adapter.raw.prepare('SELECT cloud_synced_at FROM routes WHERE id = ?').get('route-good') as { cloud_synced_at: string | null };
    const bad = adapter.raw.prepare('SELECT cloud_synced_at FROM routes WHERE id = ?').get('route-bad') as { cloud_synced_at: string | null };
    expect(good.cloud_synced_at).not.toBeNull();
    expect(bad.cloud_synced_at).toBeNull();
  });

  it('does not let a zero-stop route stop the rest of the sync pass', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-good', owner: 'employee-a' });
    insertRoute(adapter, { id: 'route-empty', owner: 'employee-a' });
    adapter.raw.prepare('DELETE FROM delivery_stops WHERE route_id = ?').run('route-empty');

    const cloud = stubCloud({ serverProfile: driverA, pull: { routes: [], cursor: '2026-08-11T12:00:00.000Z' } });
    const result = await syncRoutesWithCloud(db);

    expect(cloud.pushed[0]?.map((route) => route.routeSnapshot.route.id)).toEqual(['route-good']);
    expect(result.rejected).toBe(1);
    expect(result.pushed).toBe(1);
    expect(cloud.pullSince).toEqual([null]);
    // Still local, still dirty: it uploads as soon as it has stops again.
    expect(adapter.raw.prepare('SELECT cloud_synced_at FROM routes WHERE id = ?').get('route-empty')).toMatchObject({ cloud_synced_at: null });
  });

  it('J. repeated sync is idempotent', async () => {
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-good', owner: 'employee-a' });
    const remote = {
      routeSnapshot: {
        route: { id: 'route-remote', date: '2026-08-11', status: 'completed', total_stops: 1, created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' },
        stops: [{ id: 'route-remote-stop-1', route_id: 'route-remote', original_order: 1, recipient: 'G', address: 'A', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' }],
        shipmentLines: [],
      },
      deleted: false,
      serverUpdatedAt: '2026-08-11T07:00:01.000Z',
    };
    const cloud = stubCloud({
      serverProfile: driverA,
      pull: (since) => (since ? { routes: [], cursor: '2026-08-11T12:00:00.000Z' } : { routes: [remote], cursor: '2026-08-11T07:00:01.000Z' }),
    });

    await syncRoutesWithCloud(db);
    const second = await syncRoutesWithCloud(db);
    const third = await syncRoutesWithCloud(db);

    expect(second).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0, rejected: 0, deleted: 0, deferred: 0 });
    expect(third).toMatchObject({ pushed: 0, pulled: 0 });
    expect(cloud.pushed).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT count(*) AS count FROM routes').get()).toMatchObject({ count: 2 });
    expect(adapter.raw.prepare('SELECT count(*) AS count FROM delivery_stops').get()).toMatchObject({ count: 2 });
  });
});

describe('F. per-account sync cursor', () => {
  it('keeps a separate cursor per employee so one account cannot suppress the other', async () => {
    const { adapter, db } = createDb();

    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    stubCloud({ serverProfile: driverA, pull: { routes: [], cursor: '2026-08-11T10:00:00.000Z' } });
    await syncRoutesWithCloud(db);
    vi.unstubAllGlobals();

    await saveEmployeeSession({ profile: driverB, expiresAt: '2099-01-01T00:00:00.000Z' });
    const passB = stubCloud({ serverProfile: driverB, pull: { routes: [], cursor: '2026-08-11T11:00:00.000Z' } });
    await syncRoutesWithCloud(db);

    // B's first pull must start from scratch, not from A's watermark.
    expect(passB.pullSince).toEqual([null]);
    const cursors = adapter.raw.prepare('SELECT employee_id, cursor FROM sync_cursors ORDER BY employee_id').all() as Array<{ employee_id: string; cursor: string }>;
    expect(cursors).toEqual([
      { employee_id: 'employee-a', cursor: '2026-08-11T10:00:00.000Z' },
      { employee_id: 'employee-b', cursor: '2026-08-11T11:00:00.000Z' },
    ]);
  });

  it('resumes from its own cursor on the next pass', async () => {
    const { db } = createDb();
    await saveEmployeeSession({ profile: driverA, expiresAt: '2099-01-01T00:00:00.000Z' });
    const cloud = stubCloud({ serverProfile: driverA, pull: { routes: [], cursor: '2026-08-11T10:00:00.000Z' } });

    await syncRoutesWithCloud(db);
    await syncRoutesWithCloud(db);

    expect(cloud.pullSince).toEqual([null, '2026-08-11T10:00:00.000Z']);
  });
});
