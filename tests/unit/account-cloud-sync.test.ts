import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncAccountDataWithCloud, markSavedLocationDeletedForCloud } from '../../src/application/sync/account-cloud-sync';
import {
  ACCOUNT_PREFERENCE_KEYS,
  isAccountPreferenceKey,
} from '../../src/application/sync/account-preference-allowlist';
import { decideAccountPushOutcome, validateAccountSyncItem } from '../../server/account-sync-store';
import { GetDefaultLocations, PlanningModePreference, ResolveRouteLocations, RouteEndPreference } from '../../src/application/routes/saved-locations';
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

/** A device that has run every migration — i.e. a real installation. */
function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= schemaVersion; version += 1) adapter.raw.exec(migration(version));
  adapter.raw.exec('PRAGMA foreign_keys = ON;');
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const driverX = { id: 'employee-x', username: 'vairuotojas.x', displayName: 'Jonas Jonaitis', role: 'driver' as const, disabled: false };
const driverY = { id: 'employee-y', username: 'vairuotojas.y', displayName: 'Petras Petraitis', role: 'driver' as const, disabled: false };

type PushedItem = { entity: string; localId: string; payload: Record<string, unknown>; deleted: boolean };

/** An in-memory stand-in for the account-sync API, shared between devices. */
class InMemoryAccountCloud {
  private revision = 0;
  readonly records = new Map<string, { item: PushedItem; owner: string; serverUpdatedAt: string }>();
  readonly pushes: PushedItem[][] = [];

  fetchFor(profile: { id: string }) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'https://tsp.test');
      if (url.pathname === '/api/auth/me') return Response.json({ profile });
      if (url.pathname === '/api/route-sync') {
        return init?.method === 'POST'
          ? Response.json({ results: [] })
          : Response.json({ routes: [], cursor: '2026-08-11T12:00:00.000Z' });
      }
      if (url.pathname !== '/api/account-sync') return Response.json({}, { status: 404 });

      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { items: PushedItem[] };
        this.pushes.push(body.items);
        const results = body.items.map((item) => {
          this.revision += 1;
          this.records.set(`${profile.id}--${item.entity}--${item.localId}`, {
            item,
            owner: profile.id,
            serverUpdatedAt: `2026-08-11T12:00:${String(this.revision).padStart(2, '0')}.000Z`,
          });
          return { entity: item.entity, localId: item.localId, outcome: 'applied' };
        });
        return Response.json({ results });
      }

      const items = [...this.records.values()]
        .filter((record) => record.owner === profile.id)
        .filter((record) => {
          const since = url.searchParams.get(`since_${record.item.entity}`);
          return !since || record.serverUpdatedAt > since;
        })
        .map((record) => ({
          entity: record.item.entity,
          localId: record.item.localId,
          payload: record.item.payload,
          deleted: record.item.deleted,
          serverUpdatedAt: record.serverUpdatedAt,
        }));
      const cursors = { saved_location: this.cursorFor('saved_location'), preference: this.cursorFor('preference') };
      return Response.json({ items, cursors });
    };
  }

  private cursorFor(entity: string): string {
    const stamps = [...this.records.values()].filter((record) => record.item.entity === entity).map((record) => record.serverUpdatedAt);
    return stamps.sort().at(-1) ?? '1970-01-01T00:00:00.000Z';
  }
}

/**
 * Signs an account in on this device: a cached client session plus a server
 * that answers as that employee. Both halves matter — the engine asks the
 * server who it is, but employeeApi refuses to call at all without a session.
 */
async function signIn(cloud: InMemoryAccountCloud, profile: typeof driverX) {
  await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
  vi.stubGlobal('fetch', vi.fn(cloud.fetchFor(profile)));
}

const WAREHOUSE_ENDPOINT = '{"originalAddress":"Savanorių pr. 180, Vilnius","geocodingQuery":"Savanorių pr. 180, Vilnius","normalizedAddress":null,"latitude":null,"longitude":null}';

function setWarehouse(adapter: ExpoLikeDatabase, label: string, updatedAt: string) {
  adapter.raw.prepare(
    `INSERT INTO saved_locations (kind, label, endpoint_json, created_at, updated_at)
     VALUES ('warehouse', ?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`,
  ).run(label, WAREHOUSE_ENDPOINT, updatedAt, updatedAt);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearEmployeeSession();
});

describe('account preference allowlist', () => {
  it('carries only the two portable planning defaults', () => {
    expect([...ACCOUNT_PREFERENCE_KEYS]).toEqual(['last_route_end_kind', 'last_planning_mode']);
  });

  it('never allows security-sensitive or device-specific preferences', () => {
    for (const key of [
      'local_access_username', 'local_access_pin_salt', 'local_access_pin_hash', 'local_access_updated_at',
      'theme_preference', 'default_navigation_provider',
      'pwa_service_worker_version', 'pwa_last_successful_write_at', 'last_pwa_restore_at',
      'route_cloud_sync_cursor',
    ]) {
      expect(isAccountPreferenceKey(key)).toBe(false);
    }
  });

  it('rejects an unknown key, so a new preference is device-local by default', () => {
    expect(isAccountPreferenceKey('some_future_preference')).toBe(false);
  });

  it('keeps the server allowlist identical to the client one, so they cannot drift', () => {
    for (const key of ACCOUNT_PREFERENCE_KEYS) {
      expect(() => validateAccountSyncItem({ entity: 'preference', localId: key, payload: { updated_at: 'x' }, deleted: false })).not.toThrow();
    }
    for (const key of ['local_access_pin_hash', 'theme_preference', 'anything_else']) {
      expect(() => validateAccountSyncItem({ entity: 'preference', localId: key, payload: { updated_at: 'x' }, deleted: false })).toThrow();
    }
  });

  it('refuses a saved location kind the schema does not allow', () => {
    expect(() => validateAccountSyncItem({ entity: 'saved_location', localId: 'secret', payload: { updated_at: 'x' }, deleted: false })).toThrow();
  });
});

describe('server conflict rule', () => {
  it('accepts the first write and later ones, refuses stale and foreign writes', () => {
    expect(decideAccountPushOutcome(null, { ownerEmployeeId: 'a', updatedAt: '2026-01-01' })).toBe('applied');
    expect(decideAccountPushOutcome({ ownerEmployeeId: 'a', updatedAt: '2026-01-01' }, { ownerEmployeeId: 'a', updatedAt: '2026-01-02' })).toBe('applied');
    expect(decideAccountPushOutcome({ ownerEmployeeId: 'a', updatedAt: '2026-01-02' }, { ownerEmployeeId: 'a', updatedAt: '2026-01-01' })).toBe('conflict');
    expect(decideAccountPushOutcome({ ownerEmployeeId: 'a', updatedAt: '2026-01-01' }, { ownerEmployeeId: 'a', updatedAt: '2026-01-01' })).toBe('conflict');
    expect(decideAccountPushOutcome({ ownerEmployeeId: 'a', updatedAt: '2026-01-01' }, { ownerEmployeeId: 'b', updatedAt: '2026-01-02' })).toBe('forbidden');
  });
});

describe('new device acceptance scenario', () => {
  it('device A uploads, device B downloads warehouse and allowed preferences and can plan a route', async () => {
    const cloud = new InMemoryAccountCloud();

    // --- Device A: account X has locations and preferences, then syncs.
    const deviceA = createDb();
    setWarehouse(deviceA.adapter, 'Savanorių pr. 180', '2026-08-11T08:00:00.000Z');
    await new RouteEndPreference(deviceA.db).save('home', '2026-08-11T08:00:00.000Z');
    await new PlanningModePreference(deviceA.db).save('with_time_windows', '2026-08-11T08:00:00.000Z');
    // Device-local values that must never travel.
    deviceA.adapter.raw.prepare("INSERT INTO app_preferences (key, value, updated_at) VALUES ('local_access_pin_hash', 'secret-hash', ?)").run('2026-08-11T08:00:00.000Z');
    deviceA.adapter.raw.prepare("INSERT INTO app_preferences (key, value, updated_at) VALUES ('theme_preference', 'dark', ?)").run('2026-08-11T08:00:00.000Z');

    await signIn(cloud, driverX);
    const firstUpload = await syncAccountDataWithCloud(deviceA.db);
    expect(firstUpload.pushed).toBe(4); // warehouse + home seed + 2 preferences

    const uploadedKeys = cloud.pushes.flat().map((item) => `${item.entity}:${item.localId}`);
    expect(uploadedKeys).toContain('saved_location:warehouse');
    expect(uploadedKeys).toContain('preference:last_route_end_kind');
    expect(uploadedKeys).not.toContain('preference:local_access_pin_hash');
    expect(uploadedKeys).not.toContain('preference:theme_preference');
    expect(JSON.stringify(cloud.pushes)).not.toContain('secret-hash');

    // --- Device B: clean install, same account signs in.
    vi.unstubAllGlobals();
    const deviceB = createDb();
    deviceB.adapter.raw.prepare('DELETE FROM saved_locations').run();
    deviceB.adapter.raw.prepare("DELETE FROM app_preferences WHERE key IN ('last_route_end_kind','last_planning_mode')").run();
    await signIn(cloud, driverX);
    const download = await syncAccountDataWithCloud(deviceB.db);
    expect(download.pulled).toBeGreaterThanOrEqual(3);

    const locations = await new GetDefaultLocations(deviceB.db).execute();
    expect(locations.warehouse?.label).toBe('Savanorių pr. 180');
    // The acceptance criterion that matters: planning can resolve a warehouse.
    const resolved = await new ResolveRouteLocations(deviceB.db).execute({ kind: 'warehouse' }, { kind: 'home' });
    expect(resolved.startLocation.originalAddress).toBe('Savanorių pr. 180, Vilnius');
    expect(await new RouteEndPreference(deviceB.db).get()).toBe('home');
    expect(await new PlanningModePreference(deviceB.db).get()).toBe('with_time_windows');

    // Device-local and security-sensitive values did not transfer.
    expect(deviceB.adapter.raw.prepare("SELECT value FROM app_preferences WHERE key = 'local_access_pin_hash'").get()).toBeUndefined();
    expect(deviceB.adapter.raw.prepare("SELECT value FROM app_preferences WHERE key = 'theme_preference'").get()).toBeUndefined();

    // --- Device B edits; device A receives it.
    setWarehouse(deviceB.adapter, 'Naujas sandėlis', '2026-08-11T13:00:00.000Z');
    await new RouteEndPreference(deviceB.db).save('warehouse', '2026-08-11T13:00:00.000Z');
    await syncAccountDataWithCloud(deviceB.db);

    vi.unstubAllGlobals();
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(deviceA.db);
    const backOnA = await new GetDefaultLocations(deviceA.db).execute();
    expect(backOnA.warehouse?.label).toBe('Naujas sandėlis');
    expect(await new RouteEndPreference(deviceA.db).get()).toBe('warehouse');
  });
});

describe('account isolation and switching', () => {
  it('never gives account Y the saved locations of account X', async () => {
    const cloud = new InMemoryAccountCloud();
    const deviceA = createDb();
    setWarehouse(deviceA.adapter, 'X sandėlis', '2026-08-11T08:00:00.000Z');
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(deviceA.db);

    // A different account on a clean device pulls nothing belonging to X.
    vi.unstubAllGlobals();
    const deviceB = createDb();
    deviceB.adapter.raw.prepare('DELETE FROM saved_locations').run();
    await signIn(cloud, driverY);
    await syncAccountDataWithCloud(deviceB.db);

    expect(deviceB.adapter.raw.prepare('SELECT count(*) AS count FROM saved_locations').get()).toMatchObject({ count: 0 });
  });

  it('does not upload account X data when account Y signs in on the same device', async () => {
    const cloud = new InMemoryAccountCloud();
    const { adapter, db } = createDb();
    setWarehouse(adapter, 'X sandėlis', '2026-08-11T08:00:00.000Z');

    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(db);
    const uploadsByX = cloud.pushes.length;

    // Account switch on the same physical device.
    vi.unstubAllGlobals();
    await signIn(cloud, driverY);
    const result = await syncAccountDataWithCloud(db);

    expect(cloud.pushes.length).toBe(uploadsByX);
    expect(result.foreign).toBeGreaterThan(0);
    // Nothing of X's is stored under Y.
    expect([...cloud.records.values()].every((record) => record.owner === 'employee-x')).toBe(true);
    // And X's data is still on the device, not deleted.
    expect(adapter.raw.prepare("SELECT label FROM saved_locations WHERE kind = 'warehouse'").get()).toMatchObject({ label: 'X sandėlis' });
  });

  it('hands a shared device over to the arriving account without stealing the other account rows', async () => {
    const cloud = new InMemoryAccountCloud();

    // Y has their own warehouse, synced from their own device.
    const deviceY = createDb();
    setWarehouse(deviceY.adapter, 'Y sandėlis', '2026-08-11T09:00:00.000Z');
    await signIn(cloud, driverY);
    await syncAccountDataWithCloud(deviceY.db);
    vi.unstubAllGlobals();

    // A shared device where X synced first, so X owns the local rows.
    const shared = createDb();
    setWarehouse(shared.adapter, 'X sandėlis', '2026-08-11T08:00:00.000Z');
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(shared.db);
    const uploadsBeforeSwitch = cloud.pushes.length;
    vi.unstubAllGlobals();

    // Y signs in on the shared device: their own cloud copy arrives and the row
    // becomes theirs, but nothing of X's was ever uploaded under Y.
    await signIn(cloud, driverY);
    await syncAccountDataWithCloud(shared.db);

    const warehouse = shared.adapter.raw.prepare("SELECT label, owner_employee_id FROM saved_locations WHERE kind = 'warehouse'").get();
    expect(warehouse).toMatchObject({ label: 'Y sandėlis', owner_employee_id: 'employee-y' });
    expect(cloud.pushes.length).toBe(uploadsBeforeSwitch);
    expect(cloud.records.get('employee-y--saved_location--warehouse')?.item.payload.label).toBe('Y sandėlis');
    // X's cloud copy is untouched by any of this.
    expect(cloud.records.get('employee-x--saved_location--warehouse')?.item.payload.label).toBe('X sandėlis');
  });
});

describe('migration, deletion, offline and idempotency', () => {
  it('adopts a pre-existing device for the first account that signs in (legacy migration)', async () => {
    const cloud = new InMemoryAccountCloud();
    const { adapter, db } = createDb();
    await signIn(cloud, driverX);

    await syncAccountDataWithCloud(db);

    // The seeded warehouse/home from migration v10 are claimed and uploaded.
    const rows = adapter.raw.prepare('SELECT kind, owner_employee_id FROM saved_locations ORDER BY kind').all() as Array<{ kind: string; owner_employee_id: string }>;
    expect(rows.every((row) => row.owner_employee_id === 'employee-x')).toBe(true);
    expect(rows.map((row) => row.kind)).toEqual(['home', 'warehouse']);
  });

  it('propagates a saved-location deletion to the other device', async () => {
    const cloud = new InMemoryAccountCloud();
    const deviceA = createDb();
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(deviceA.db);

    vi.unstubAllGlobals();
    const deviceB = createDb();
    deviceB.adapter.raw.prepare('DELETE FROM saved_locations').run();
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(deviceB.db);
    expect(deviceB.adapter.raw.prepare("SELECT kind FROM saved_locations WHERE kind = 'home'").get()).toBeTruthy();

    // Device A deletes; device B must lose it too.
    vi.unstubAllGlobals();
    await signIn(cloud, driverX);
    await markSavedLocationDeletedForCloud(deviceA.db, 'home');
    await syncAccountDataWithCloud(deviceA.db);
    expect(deviceA.adapter.raw.prepare("SELECT kind FROM saved_locations WHERE kind = 'home'").get()).toBeUndefined();

    vi.unstubAllGlobals();
    await signIn(cloud, driverX);
    const result = await syncAccountDataWithCloud(deviceB.db);
    expect(result.deleted).toBe(1);
    expect(deviceB.adapter.raw.prepare("SELECT kind FROM saved_locations WHERE kind = 'home'").get()).toBeUndefined();
  });

  it('keeps working offline and uploads the change after reconnect', async () => {
    const cloud = new InMemoryAccountCloud();
    const { adapter, db } = createDb();
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(db);

    // Offline: the local edit still lands in SQLite, sync just fails.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    setWarehouse(adapter, 'Pakeista be ryšio', '2026-08-11T14:00:00.000Z');
    await expect(syncAccountDataWithCloud(db)).rejects.toThrow();
    expect(adapter.raw.prepare("SELECT label FROM saved_locations WHERE kind = 'warehouse'").get()).toMatchObject({ label: 'Pakeista be ryšio' });

    // Reconnect: the queued change goes up without any extra bookkeeping.
    vi.unstubAllGlobals();
    await signIn(cloud, driverX);
    const reconnect = await syncAccountDataWithCloud(db);
    expect(reconnect.pushed).toBe(1);
    expect(cloud.records.get('employee-x--saved_location--warehouse')?.item.payload.label).toBe('Pakeista be ryšio');
  });

  it('is idempotent — a second and third pass push and pull nothing new', async () => {
    const cloud = new InMemoryAccountCloud();
    const { adapter, db } = createDb();
    await signIn(cloud, driverX);

    await syncAccountDataWithCloud(db);
    const pushesAfterFirst = cloud.pushes.length;
    const second = await syncAccountDataWithCloud(db);
    const third = await syncAccountDataWithCloud(db);

    expect(second).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0, rejected: 0 });
    expect(third).toMatchObject({ pushed: 0, pulled: 0 });
    expect(cloud.pushes.length).toBe(pushesAfterFirst);
    expect(adapter.raw.prepare('SELECT count(*) AS count FROM saved_locations').get()).toMatchObject({ count: 2 });
  });

  it('keeps its own cursor per account on a shared device', async () => {
    const cloud = new InMemoryAccountCloud();
    const { adapter, db } = createDb();
    await signIn(cloud, driverX);
    await syncAccountDataWithCloud(db);
    vi.unstubAllGlobals();
    await signIn(cloud, driverY);
    await syncAccountDataWithCloud(db);

    const cursors = adapter.raw.prepare("SELECT employee_id, entity FROM sync_cursors WHERE entity IN ('saved_location','preference') ORDER BY employee_id, entity").all();
    expect(cursors).toEqual([
      { employee_id: 'employee-x', entity: 'preference' },
      { employee_id: 'employee-x', entity: 'saved_location' },
      { employee_id: 'employee-y', entity: 'preference' },
      { employee_id: 'employee-y', entity: 'saved_location' },
    ]);
  });
});
