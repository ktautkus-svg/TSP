import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { applyRouteSnapshot, exportRouteSnapshot } from '../../src/application/auth/route-assignment-sync';

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
  // Every defect this file covers is a foreign-key consequence, so the probe
  // must run with the same enforcement the app uses.
  adapter.raw.exec('PRAGMA foreign_keys = ON;');
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const T0 = '2026-08-11T08:00:00.000Z';
const T1 = '2026-08-11T09:00:00.000Z';

function seedLocalRoute(adapter: ExpoLikeDatabase, options: { status?: string; vehicleId?: string | null } = {}) {
  const status = options.status ?? 'completed';
  adapter.raw.prepare(
    `INSERT INTO vehicles (id, name, registration_number, fuel_type, created_at, updated_at)
     VALUES ('vehicle-primary', 'Darbinis automobilis', 'ABC123', 'diesel', ?, ?)`,
  ).run(T0, T0);
  adapter.raw.prepare(
    `INSERT INTO routes (id, date, status, total_weight_kg, total_stops, created_at, updated_at, vehicle_id, completed_at)
     VALUES ('route-1', '2026-08-11', ?, 100, 1, ?, ?, ?, ?)`,
  ).run(status, T0, T0, options.vehicleId === undefined ? 'vehicle-primary' : options.vehicleId, T0);
  adapter.raw.prepare(
    `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, weight_kg, created_at, updated_at)
     VALUES ('stop-1', 'route-1', 1, 'Gavėjas', 'Adresas 1', 100, ?, ?)`,
  ).run(T0, T0);
}

function seedTripSheet(adapter: ExpoLikeDatabase) {
  adapter.raw.prepare(
    `INSERT INTO trip_sheets (id, date, vehicle_id, start_location_json, end_location_json, created_at)
     VALUES ('trip-sheet-2026-08-11-vehicle-primary', '2026-08-11', 'vehicle-primary', '{}', '{}', ?)`,
  ).run(T0);
  adapter.raw.prepare(
    `INSERT INTO trip_sheet_routes (trip_sheet_id, route_id, route_order)
     VALUES ('trip-sheet-2026-08-11-vehicle-primary', 'route-1', 1)`,
  ).run();
}

function cloudSnapshot(overrides: Record<string, unknown> = {}, stopOverrides: Record<string, unknown> = {}) {
  return {
    route: {
      id: 'route-1',
      date: '2026-08-11',
      status: 'completed',
      total_weight_kg: 250,
      total_stops: 1,
      created_at: T0,
      updated_at: T1,
      completed_at: T1,
      vehicle_id: null,
      cloud_synced_at: null,
      cloud_deleted_at: null,
      ...overrides,
    },
    stops: [{
      id: 'stop-1',
      route_id: 'route-1',
      original_order: 1,
      recipient: 'Gavėjas',
      address: 'Adresas 1',
      weight_kg: 250,
      delivery_status: 'delivered',
      created_at: T0,
      updated_at: T1,
      ...stopOverrides,
    }],
    shipmentLines: [],
  };
}

describe('applyRouteSnapshot — non-destructive apply', () => {
  it('A. applies a cloud update to a route that a trip sheet already references', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);
    seedTripSheet(adapter);

    await expect(applyRouteSnapshot(db, cloudSnapshot(), T1)).resolves.toBeUndefined();

    const route = adapter.raw.prepare('SELECT total_weight_kg, cloud_synced_at FROM routes WHERE id = ?').get('route-1') as { total_weight_kg: number; cloud_synced_at: string };
    expect(route.total_weight_kg).toBe(250);
    expect(route.cloud_synced_at).toBe(T1);
    const links = adapter.raw.prepare('SELECT route_order FROM trip_sheet_routes WHERE route_id = ?').all('route-1');
    expect(links).toHaveLength(1);
    const sheets = adapter.raw.prepare('SELECT id FROM trip_sheets').all();
    expect(sheets).toHaveLength(1);
  });

  it('B. preserves delivery_attempts recorded locally for stops the cloud still knows', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);
    adapter.raw.prepare(
      `INSERT INTO delivery_attempts (id, route_id, stop_id, result, created_at)
       VALUES ('attempt-1', 'route-1', 'stop-1', 'delivered', ?)`,
    ).run(T0);

    await applyRouteSnapshot(db, cloudSnapshot(), T1);

    const attempts = adapter.raw.prepare('SELECT id, result FROM delivery_attempts WHERE route_id = ?').all('route-1') as { id: string; result: string }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ id: 'attempt-1', result: 'delivered' });
  });

  it('B2. drops only the attempts whose stop no longer exists in the cloud copy', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);
    adapter.raw.prepare(
      `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, created_at, updated_at)
       VALUES ('stop-2', 'route-1', 2, 'Gavėjas 2', 'Adresas 2', ?, ?)`,
    ).run(T0, T0);
    for (const [id, stopId] of [['attempt-1', 'stop-1'], ['attempt-2', 'stop-2']]) {
      adapter.raw.prepare(
        `INSERT INTO delivery_attempts (id, route_id, stop_id, result, created_at) VALUES (?, 'route-1', ?, 'delivered', ?)`,
      ).run(id, stopId, T0);
    }

    // The cloud copy only carries stop-1: stop-2 was removed on the other device.
    await applyRouteSnapshot(db, cloudSnapshot(), T1);

    const attempts = adapter.raw.prepare('SELECT id FROM delivery_attempts WHERE route_id = ?').all('route-1') as { id: string }[];
    expect(attempts.map((attempt) => attempt.id)).toEqual(['attempt-1']);
  });

  it('C. preserves route_sync_state so dispatcher progress reporting keeps working', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter, { status: 'in_progress' });
    adapter.raw.prepare(
      `INSERT INTO route_sync_state (assignment_id, route_id, employee_id, server_revision, sync_status, created_at, updated_at)
       VALUES ('assignment-1', 'route-1', 'employee-1', 'rev-1', 'synced', ?, ?)`,
    ).run(T0, T0);

    await applyRouteSnapshot(db, cloudSnapshot({ status: 'in_progress', completed_at: null }), T1);

    const state = adapter.raw.prepare('SELECT assignment_id, employee_id FROM route_sync_state WHERE route_id = ?').get('route-1');
    expect(state).toMatchObject({ assignment_id: 'assignment-1', employee_id: 'employee-1' });
  });

  it('C2. preserves the other route-owned local tables a delete would have cascaded away', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);
    adapter.raw.prepare(
      `INSERT INTO route_order_snapshots (id, route_id, kind, ordered_stop_ids_json, created_at)
       VALUES ('snapshot-1', 'route-1', 'original', '["stop-1"]', ?)`,
    ).run(T0);
    adapter.raw.prepare(
      `INSERT INTO import_sources (id, route_id, type, created_at) VALUES ('import-1', 'route-1', 'manual', ?)`,
    ).run(T0);
    adapter.raw.prepare(
      `INSERT INTO route_creation_commands (command_id, route_id, created_at) VALUES ('command-1', 'route-1', ?)`,
    ).run(T0);

    await applyRouteSnapshot(db, cloudSnapshot(), T1);

    expect(adapter.raw.prepare('SELECT id FROM route_order_snapshots WHERE route_id = ?').all('route-1')).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT id FROM import_sources WHERE route_id = ?').all('route-1')).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT command_id FROM route_creation_commands WHERE route_id = ?').all('route-1')).toHaveLength(1);
  });

  it('D. keeps the local vehicle_id when the cloud copy carries none', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);

    await applyRouteSnapshot(db, cloudSnapshot(), T1);

    const route = adapter.raw.prepare('SELECT vehicle_id FROM routes WHERE id = ?').get('route-1') as { vehicle_id: string | null };
    expect(route.vehicle_id).toBe('vehicle-primary');
  });

  it('D2. accepts a vehicle_id the cloud copy does carry', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter, { vehicleId: null });
    adapter.raw.prepare(
      `INSERT INTO vehicles (id, name, registration_number, fuel_type, created_at, updated_at)
       VALUES ('vehicle-second', 'Antras', 'XYZ789', 'diesel', ?, ?)`,
    ).run(T0, T0);

    await applyRouteSnapshot(db, cloudSnapshot({ vehicle_id: 'vehicle-second' }), T1);

    const route = adapter.raw.prepare('SELECT vehicle_id FROM routes WHERE id = ?').get('route-1') as { vehicle_id: string | null };
    expect(route.vehicle_id).toBe('vehicle-second');
  });

  it('J. is idempotent — applying the same snapshot twice changes nothing', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);
    seedTripSheet(adapter);
    adapter.raw.prepare(
      `INSERT INTO delivery_attempts (id, route_id, stop_id, result, created_at)
       VALUES ('attempt-1', 'route-1', 'stop-1', 'delivered', ?)`,
    ).run(T0);

    await applyRouteSnapshot(db, cloudSnapshot(), T1);
    await applyRouteSnapshot(db, cloudSnapshot(), T1);

    expect(adapter.raw.prepare('SELECT id FROM routes').all()).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT id FROM delivery_stops WHERE route_id = ?').all('route-1')).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT id FROM delivery_attempts WHERE route_id = ?').all('route-1')).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT route_id FROM trip_sheet_routes').all()).toHaveLength(1);
  });

  it('stamps the owner from the caller, never from the incoming payload', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);

    await applyRouteSnapshot(db, cloudSnapshot({ owner_employee_id: 'employee-attacker' }), T1, 'employee-1');

    const route = adapter.raw.prepare('SELECT owner_employee_id FROM routes WHERE id = ?').get('route-1') as { owner_employee_id: string };
    expect(route.owner_employee_id).toBe('employee-1');
  });

  it('never lets device-local bookkeeping leave in an exported snapshot', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);
    adapter.raw.prepare('UPDATE routes SET owner_employee_id = ?, cloud_synced_at = ? WHERE id = ?').run('employee-1', T0, 'route-1');

    const snapshot = await exportRouteSnapshot(db, 'route-1');

    expect(snapshot.route.owner_employee_id).toBeNull();
    expect(snapshot.route.cloud_synced_at).toBeNull();
    expect(snapshot.route.vehicle_id).toBeNull();
  });

  it('keeps park-memory stop columns when applying onto schema 28', async () => {
    const { adapter, db } = createDb();
    seedLocalRoute(adapter);

    await expect(applyRouteSnapshot(db, cloudSnapshot({}, {
      park_latitude: 55.9,
      park_longitude: 23.3,
      park_heading: 180,
    }), T1)).resolves.toBeUndefined();

    const stop = adapter.raw.prepare('SELECT id, recipient, park_latitude, park_longitude, park_heading FROM delivery_stops WHERE id = ?').get('stop-1') as {
      id: string;
      recipient: string;
      park_latitude: number;
      park_longitude: number;
      park_heading: number;
    };
    expect(stop.id).toBe('stop-1');
    expect(stop.recipient).toBe('Gavėjas');
    expect(stop.park_latitude).toBe(55.9);
    expect(stop.park_longitude).toBe(23.3);
    expect(stop.park_heading).toBe(180);
  });
});
