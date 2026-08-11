import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncRoutesWithCloud } from '../../src/application/sync/route-cloud-sync';
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
