import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncRoutesWithCloud } from '../../src/application/sync/route-cloud-sync';
import { RouteCloudSyncCoordinator } from '../../src/application/sync/route-cloud-sync-coordinator';
import { MarkStopDelivered, MarkStopLoaded } from '../../src/application/routes/route-workday';
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

function insertRoute(adapter: ExpoLikeDatabase, overrides: Partial<{
  id: string; status: string; updatedAt: string; totalWeightKg: number; cloudSyncedAt: string | null; cloudDeletedAt: string | null;
}> = {}) {
  const id = overrides.id ?? 'route-1';
  const status = overrides.status ?? 'draft';
  const updatedAt = overrides.updatedAt ?? '2026-08-11T08:00:00.000Z';
  adapter.raw.prepare(
    `INSERT INTO routes (id, date, status, total_weight_kg, created_at, updated_at, cloud_synced_at, cloud_deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, '2026-08-11', status, overrides.totalWeightKg ?? 100, updatedAt, updatedAt, overrides.cloudSyncedAt ?? null, overrides.cloudDeletedAt ?? null);
  adapter.raw.prepare(
    `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, created_at, updated_at)
     VALUES (?, ?, 1, 'Gavėjas', 'Adresas 1', ?, ?)`,
  ).run(`${id}-stop-1`, id, updatedAt, updatedAt);
  return id;
}

const profile = { id: 'employee-1', username: 'vairuotojas', displayName: 'Jonas Jonaitis', role: 'driver' as const, disabled: false };

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // Every sync pass now confirms the signed-in employee with the server
    // before deciding what to upload. The handler still runs so offline and
    // failing stubs keep failing; only its payload is replaced.
    const response = await handler(input, init);
    return String(input).includes('/api/auth/me') ? Response.json({ profile }) : response;
  }));
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearEmployeeSession();
});

describe('route cloud sync — push (upload)', () => {
  it('uploads a route that has never been synced (first upload / migration of pre-existing local data)', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-new', cloudSyncedAt: null });

    let pushedBody: unknown = null;
    stubFetch(async (_url, init) => {
      const url = String(_url);
      if (url.includes('/api/route-sync') && init?.method === 'POST') {
        pushedBody = JSON.parse(String(init.body));
        return Response.json({ results: [{ routeId: 'route-new', outcome: 'applied' }] });
      }
      return Response.json({ routes: [], cursor: '2026-08-11T09:00:00.000Z' });
    });

    await syncRoutesWithCloud(db);

    expect((pushedBody as { routes: { routeSnapshot: { route: { id: string } } }[] }).routes).toHaveLength(1);
    expect((pushedBody as { routes: { routeSnapshot: { route: { id: string } } }[] }).routes[0]!.routeSnapshot.route.id).toBe('route-new');
    const row = adapter.raw.prepare('SELECT cloud_synced_at, updated_at FROM routes WHERE id = ?').get('route-new') as { cloud_synced_at: string; updated_at: string };
    expect(row.cloud_synced_at).toBe(row.updated_at);
  });

  it('does not re-push a route once cloud_synced_at is caught up with updated_at (idempotency)', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-synced', updatedAt: '2026-08-11T08:00:00.000Z', cloudSyncedAt: '2026-08-11T08:00:00.000Z' });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (String(input).includes('/api/auth/me')
      ? Response.json({ profile })
      : Response.json({ routes: [], cursor: '2026-08-11T09:00:00.000Z' })));
    vi.stubGlobal('fetch', fetchMock);

    await syncRoutesWithCloud(db);

    // Identity check plus the pull GET; nothing was dirty to push.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates a local soft-delete flag on push', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-deleted', status: 'cancelled', cloudDeletedAt: '2026-08-11T08:30:00.000Z' });

    let pushedDeleted: boolean | null = null;
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { routes: { deleted: boolean }[] };
        pushedDeleted = body.routes[0]!.deleted;
        return Response.json({ results: [{ routeId: 'route-deleted', outcome: 'applied' }] });
      }
      return Response.json({ routes: [], cursor: '2026-08-11T09:00:00.000Z' });
    });

    await syncRoutesWithCloud(db);
    expect(pushedDeleted).toBe(true);
  });

  it('keeps a working local route when the server reports a conflict', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-conflict', status: 'in_progress', totalWeightKg: 100, updatedAt: '2026-08-11T08:00:00.000Z' });

    const serverSnapshot = {
      route: { id: 'route-conflict', date: '2026-08-11', status: 'completed', total_weight_kg: 250, created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z', cloud_synced_at: null, cloud_deleted_at: null },
      stops: [{ id: 'route-conflict-stop-1', route_id: 'route-conflict', original_order: 1, recipient: 'Gavėjas', address: 'Adresas 1', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        return Response.json({ results: [{ routeId: 'route-conflict', outcome: 'conflict', routeSnapshot: serverSnapshot, deleted: false }] });
      }
      return Response.json({ routes: [], cursor: '2026-08-11T09:30:00.000Z' });
    });

    const outcome = await syncRoutesWithCloud(db);

    const row = adapter.raw.prepare('SELECT status, total_weight_kg, cloud_synced_at FROM routes WHERE id = ?').get('route-conflict') as { status: string; total_weight_kg: number; cloud_synced_at: string | null };
    expect(row.status).toBe('in_progress');
    expect(row.total_weight_kg).toBe(100);
    expect(row.cloud_synced_at).toBeNull();
    expect(outcome.conflicts).toBe(1);
  });

  it('adopts a conflict snapshot when the local copy is not being worked', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-conflict-planned', status: 'planned', totalWeightKg: 100, updatedAt: '2026-08-11T08:00:00.000Z' });

    const serverSnapshot = {
      route: { id: 'route-conflict-planned', date: '2026-08-11', status: 'planned', total_weight_kg: 250, created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z', cloud_synced_at: null, cloud_deleted_at: null },
      stops: [{ id: 'route-conflict-planned-stop-1', route_id: 'route-conflict-planned', original_order: 1, recipient: 'Gavėjas', address: 'Adresas 1', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        return Response.json({ results: [{ routeId: 'route-conflict-planned', outcome: 'conflict', routeSnapshot: serverSnapshot, deleted: false }] });
      }
      return Response.json({ routes: [], cursor: '2026-08-11T09:30:00.000Z' });
    });

    await syncRoutesWithCloud(db);

    const row = adapter.raw.prepare('SELECT status, total_weight_kg, cloud_synced_at FROM routes WHERE id = ?').get('route-conflict-planned') as { status: string; total_weight_kg: number; cloud_synced_at: string };
    expect(row.status).toBe('planned');
    expect(row.total_weight_kg).toBe(250);
    expect(row.cloud_synced_at).toBe('2026-08-11T09:00:00.000Z');
  });

  it('leaves a forbidden (wrong-owner) route pending instead of marking it synced', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-forbidden' });

    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [{ routeId: 'route-forbidden', outcome: 'forbidden' }] });
      return Response.json({ routes: [], cursor: '2026-08-11T09:00:00.000Z' });
    });

    await syncRoutesWithCloud(db);
    const row = adapter.raw.prepare('SELECT cloud_synced_at FROM routes WHERE id = ?').get('route-forbidden') as { cloud_synced_at: string | null };
    expect(row.cloud_synced_at).toBeNull();
  });

  it('throws (does not silently swallow) when offline, leaving local data untouched', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-offline' });
    stubFetch(async () => { throw new TypeError('Network request failed'); });

    await expect(syncRoutesWithCloud(db)).rejects.toThrow();
    const row = adapter.raw.prepare('SELECT cloud_synced_at FROM routes WHERE id = ?').get('route-offline') as { cloud_synced_at: string | null };
    expect(row.cloud_synced_at).toBeNull();
  });
});

describe('route cloud sync — session requirements', () => {
  it('refuses to sync without a signed-in session, without touching local data', async () => {
    await clearEmployeeSession();
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-no-session' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(syncRoutesWithCloud(db)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    const row = adapter.raw.prepare('SELECT cloud_synced_at FROM routes WHERE id = ?').get('route-no-session') as { cloud_synced_at: string | null };
    expect(row.cloud_synced_at).toBeNull();
  });
});

describe('route cloud sync — pull (second device download)', () => {
  it('inserts a route synced from another device that does not exist locally yet', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();

    const remoteSnapshot = {
      route: { id: 'route-from-phone', date: '2026-08-11', status: 'planned', total_weight_kg: 480, total_stops: 1, created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' },
      stops: [{ id: 'route-from-phone-stop-1', route_id: 'route-from-phone', original_order: 1, recipient: 'Gavėjas', address: 'Gedimino pr. 9, Vilnius', weight_kg: 480, created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [{ routeSnapshot: remoteSnapshot, deleted: false, serverUpdatedAt: '2026-08-11T07:00:01.000Z' }], cursor: '2026-08-11T07:00:01.000Z' });
    });

    await syncRoutesWithCloud(db);

    const route = adapter.raw.prepare('SELECT id, status, total_weight_kg, cloud_synced_at FROM routes WHERE id = ?').get('route-from-phone') as { id: string; status: string; total_weight_kg: number; cloud_synced_at: string };
    expect(route).toBeTruthy();
    expect(route.status).toBe('planned');
    expect(route.total_weight_kg).toBe(480);
    expect(route.cloud_synced_at).toBe('2026-08-11T07:00:00.000Z');
    const stops = adapter.raw.prepare('SELECT * FROM delivery_stops WHERE route_id = ?').all('route-from-phone');
    expect(stops).toHaveLength(1);

    const cursorRow = adapter.raw.prepare("SELECT cursor FROM sync_cursors WHERE entity = 'routes' AND employee_id = ?").get(profile.id) as { cursor: string };
    expect(cursorRow.cursor).toBe('2026-08-11T07:00:01.000Z');
  });

  it('applies pulling twice without duplicating rows (idempotent apply)', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    const remoteSnapshot = {
      route: { id: 'route-idempotent', date: '2026-08-11', status: 'planned', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' },
      stops: [{ id: 'route-idempotent-stop-1', route_id: 'route-idempotent', original_order: 1, recipient: 'Gavėjas', address: 'Adresas', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [{ routeSnapshot: remoteSnapshot, deleted: false, serverUpdatedAt: '2026-08-11T07:00:01.000Z' }], cursor: '2026-08-11T07:00:01.000Z' });
    });

    await syncRoutesWithCloud(db);
    await syncRoutesWithCloud(db);

    const routes = adapter.raw.prepare('SELECT * FROM routes WHERE id = ?').all('route-idempotent');
    const stops = adapter.raw.prepare('SELECT * FROM delivery_stops WHERE route_id = ?').all('route-idempotent');
    expect(routes).toHaveLength(1);
    expect(stops).toHaveLength(1);
  });

  it('defers pulling a completed snapshot over a local working copy of the same route', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-live', status: 'in_progress', updatedAt: '2026-08-11T08:00:00.000Z' });

    const remoteSnapshot = {
      route: { id: 'route-live', date: '2026-08-11', status: 'completed', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' },
      stops: [{ id: 'route-live-stop-1', route_id: 'route-live', original_order: 1, recipient: 'Gavėjas', address: 'Adresas', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T09:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [{ routeSnapshot: remoteSnapshot, deleted: false, serverUpdatedAt: '2026-08-11T09:00:01.000Z' }], cursor: '2026-08-11T09:00:01.000Z' });
    });

    const outcome = await syncRoutesWithCloud(db);
    const row = adapter.raw.prepare('SELECT status FROM routes WHERE id = ?').get('route-live') as { status: string };
    expect(row.status).toBe('in_progress');
    expect(outcome.deferred).toBe(1);
  });

  it('defers a pulled non-terminal route when this device already has a different active route', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-local-active', status: 'in_progress' });

    const remoteSnapshot = {
      route: { id: 'route-other-device-active', date: '2026-08-11', status: 'loading', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' },
      stops: [{ id: 'route-other-device-active-stop-1', route_id: 'route-other-device-active', original_order: 1, recipient: 'Gavėjas', address: 'Adresas', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [{ routeSnapshot: remoteSnapshot, deleted: false, serverUpdatedAt: '2026-08-11T07:00:01.000Z' }], cursor: '2026-08-11T07:00:01.000Z' });
    });

    await syncRoutesWithCloud(db);

    const imported = adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-other-device-active');
    expect(imported).toBeUndefined();
    const active = adapter.raw.prepare("SELECT id FROM routes WHERE status NOT IN ('completed','cancelled')").all();
    expect(active).toHaveLength(1);
    expect((active[0] as { id: string }).id).toBe('route-local-active');
  });

  it('always merges completed/cancelled history routes even while a different route is active locally', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, { id: 'route-local-active', status: 'in_progress' });

    const remoteSnapshot = {
      route: { id: 'route-history', date: '2026-08-10', status: 'completed', created_at: '2026-08-10T07:00:00.000Z', updated_at: '2026-08-10T18:00:00.000Z' },
      stops: [{ id: 'route-history-stop-1', route_id: 'route-history', original_order: 1, recipient: 'Gavėjas', address: 'Adresas', created_at: '2026-08-10T07:00:00.000Z', updated_at: '2026-08-10T18:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [{ routeSnapshot: remoteSnapshot, deleted: false, serverUpdatedAt: '2026-08-10T18:00:01.000Z' }], cursor: '2026-08-10T18:00:01.000Z' });
    });

    await syncRoutesWithCloud(db);
    const historyRoute = adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-history');
    expect(historyRoute).toBeTruthy();
  });

  it('does not recreate a route this device never had just because a tombstone arrived', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    const remoteSnapshot = {
      route: { id: 'route-deleted-remote', date: '2026-08-11', status: 'cancelled', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' },
      stops: [{ id: 'route-deleted-remote-stop-1', route_id: 'route-deleted-remote', original_order: 1, recipient: 'Gavėjas', address: 'Adresas', created_at: '2026-08-11T07:00:00.000Z', updated_at: '2026-08-11T07:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [{ routeSnapshot: remoteSnapshot, deleted: true, serverUpdatedAt: '2026-08-11T07:00:01.000Z' }], cursor: '2026-08-11T07:00:01.000Z' });
    });

    await syncRoutesWithCloud(db);
    const row = adapter.raw.prepare('SELECT id FROM routes WHERE id = ?').get('route-deleted-remote');
    expect(row).toBeUndefined();
  });

  it('sends an incremental since= cursor on the second pull instead of refetching everything', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { db } = createDb();
    const urls: string[] = [];
    stubFetch(async (url, init) => {
      if (!String(url).includes('/api/auth/me')) urls.push(String(url));
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({ routes: [], cursor: '2026-08-11T07:00:01.000Z' });
    });

    await syncRoutesWithCloud(db);
    await syncRoutesWithCloud(db);

    expect(urls[0]).toBe('/api/route-sync');
    expect(urls[1]).toContain('since=2026-08-11T07%3A00%3A01.000Z');
  });
});

describe('route cloud sync — event-driven multi-device workflow', () => {
  it('propagates Device B delivery progress back to Device A', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const deviceA = createDb();
    const deviceB = createDb();
    insertRoute(deviceA.adapter, { id: 'route-device-pair', status: 'in_progress' });
    const cloud = new InMemoryRouteCloud();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => cloud.fetch(input, init)));

    // Device A creates and uploads the route; Device B downloads the same snapshot.
    await syncRoutesWithCloud(deviceA.db);
    await syncRoutesWithCloud(deviceB.db);
    expect(deviceB.adapter.raw.prepare('SELECT delivery_status FROM delivery_stops WHERE id = ?')
      .get('route-device-pair-stop-1')).toMatchObject({ delivery_status: 'pending' });

    // Device B changes operational progress and immediately syncs its dirty route.
    await new MarkStopDelivered(deviceB.db, () => '2026-08-11T10:00:00.000Z').execute(
      'route-device-pair',
      'route-device-pair-stop-1',
    );
    await syncRoutesWithCloud(deviceB.db);

    // Device A's next event-driven pass pulls the changed delivery state.
    await syncRoutesWithCloud(deviceA.db);
    expect(deviceA.adapter.raw.prepare('SELECT delivery_status, delivered_at FROM delivery_stops WHERE id = ?')
      .get('route-device-pair-stop-1')).toMatchObject({
        delivery_status: 'delivered',
        delivered_at: '2026-08-11T10:00:00.000Z',
      });
  });

  it('defers a completed cloud copy over a live local route', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, {
      id: 'route-live',
      status: 'in_progress',
      updatedAt: '2026-08-11T08:00:00.000Z',
      cloudSyncedAt: '2026-08-11T08:00:00.000Z',
    });

    const completedSnapshot = {
      route: { id: 'route-live', date: '2026-08-11', status: 'completed', total_weight_kg: 100, created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T11:00:00.000Z' },
      stops: [{ id: 'route-live-stop-1', route_id: 'route-live', original_order: 1, recipient: 'Gavėjas', address: 'Adresas 1', delivery_status: 'delivered', created_at: '2026-08-11T08:00:00.000Z', updated_at: '2026-08-11T11:00:00.000Z' }],
      shipmentLines: [],
    };
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') return Response.json({ results: [] });
      return Response.json({
        routes: [{ routeSnapshot: completedSnapshot, deleted: false, serverUpdatedAt: '2026-08-11T11:00:01.000Z' }],
        cursor: '2026-08-11T11:00:01.000Z',
      });
    });

    const outcome = await syncRoutesWithCloud(db);
    expect(outcome.deferred).toBe(1);
    expect(adapter.raw.prepare('SELECT status FROM routes WHERE id = ?').get('route-live')).toMatchObject({ status: 'in_progress' });
    expect(adapter.raw.prepare('SELECT last_reason FROM route_sync_deferrals WHERE route_id = ?').get('route-live'))
      .toMatchObject({ last_reason: 'LOCAL_ROUTE_WORKING' });
  });

  it('keeps an offline delivery mutation local, then pushes it after reconnect', async () => {
    await saveEmployeeSession({ profile, expiresAt: '2099-01-01T00:00:00.000Z' });
    const { adapter, db } = createDb();
    insertRoute(adapter, {
      id: 'route-reconnect',
      status: 'in_progress',
      updatedAt: '2026-08-11T08:00:00.000Z',
      cloudSyncedAt: '2026-08-11T08:00:00.000Z',
    });
    await new MarkStopDelivered(db, () => '2026-08-11T10:00:00.000Z').execute(
      'route-reconnect',
      'route-reconnect-stop-1',
    );

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const coordinator = new RouteCloudSyncCoordinator({ sync: () => syncRoutesWithCloud(db) });
    await expect(coordinator.trigger('mutation')).resolves.toBeUndefined();
    expect(coordinator.getState().status).toBe('offline');
    expect(adapter.raw.prepare('SELECT delivery_status FROM delivery_stops WHERE id = ?')
      .get('route-reconnect-stop-1')).toMatchObject({ delivery_status: 'delivered' });

    let pushed = 0;
    stubFetch(async (_url, init) => {
      if (init?.method === 'POST') {
        pushed += 1;
        return Response.json({ results: [{ routeId: 'route-reconnect', outcome: 'applied' }] });
      }
      return Response.json({ routes: [], cursor: '2026-08-11T10:00:01.000Z' });
    });
    coordinator.setOnline(true);
    await coordinator.trigger('network-restored');

    expect(pushed).toBe(1);
    expect(coordinator.getState().status).toBe('synced');
    expect(adapter.raw.prepare('SELECT cloud_synced_at, updated_at FROM routes WHERE id = ?')
      .get('route-reconnect')).toMatchObject({
        cloud_synced_at: '2026-08-11T10:00:00.000Z',
        updated_at: '2026-08-11T10:00:00.000Z',
      });
  });

  it('marks individual loading progress dirty without changing route status', async () => {
    const { adapter, db } = createDb();
    insertRoute(adapter, {
      id: 'route-loading-progress',
      status: 'loading',
      updatedAt: '2026-08-11T08:00:00.000Z',
      cloudSyncedAt: '2026-08-11T08:00:00.000Z',
    });
    adapter.raw.prepare(
      `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, created_at, updated_at)
       VALUES (?, ?, 2, 'Antras', 'Adresas 2', ?, ?)`,
    ).run('route-loading-progress-stop-2', 'route-loading-progress', '2026-08-11T08:00:00.000Z', '2026-08-11T08:00:00.000Z');

    await new MarkStopLoaded(db, () => '2026-08-11T09:00:00.000Z').execute(
      'route-loading-progress',
      'route-loading-progress-stop-1',
    );

    expect(adapter.raw.prepare('SELECT status, updated_at, cloud_synced_at FROM routes WHERE id = ?')
      .get('route-loading-progress')).toMatchObject({
        status: 'loading',
        updated_at: '2026-08-11T09:00:00.000Z',
        cloud_synced_at: '2026-08-11T08:00:00.000Z',
      });
  });
});

class InMemoryRouteCloud {
  private revision = 0;
  private readonly routes = new Map<string, {
    routeSnapshot: { route: Record<string, unknown>; stops: Record<string, unknown>[]; shipmentLines: Record<string, unknown>[] };
    deleted: boolean;
    serverUpdatedAt: string;
  }>();

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input), 'https://tsp.test');
    // Every sync pass resolves its employee from the authenticated session
    // before touching route data, so the fake answers it exactly like the real
    // server does — without it no device can establish ownership at all.
    if (url.pathname === '/api/auth/me') return Response.json({ profile });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        routes: { routeSnapshot: InMemoryRouteCloud['routes'] extends Map<string, infer T> ? T extends { routeSnapshot: infer S } ? S : never : never; deleted: boolean }[];
      };
      const results = body.routes.map((item) => {
        const routeId = String(item.routeSnapshot.route.id);
        this.routes.set(routeId, {
          routeSnapshot: item.routeSnapshot,
          deleted: item.deleted,
          serverUpdatedAt: this.nextCursor(),
        });
        return { routeId, outcome: 'applied' as const };
      });
      return Response.json({ results });
    }

    const since = url.searchParams.get('since');
    const routes = [...this.routes.values()].filter((route) => !since || route.serverUpdatedAt > since);
    return Response.json({ routes, cursor: this.currentCursor() });
  }

  private nextCursor(): string {
    this.revision += 1;
    return `2026-08-11T12:00:${String(this.revision).padStart(2, '0')}.000Z`;
  }

  private currentCursor(): string {
    return `2026-08-11T12:00:${String(this.revision).padStart(2, '0')}.000Z`;
  }
}
