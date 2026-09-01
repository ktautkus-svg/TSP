import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  ActivateRoute,
  CreateDraftRoute,
  ReplaceDraftStops,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import { ensureParkMemorySchema, migrateDatabase } from '../../src/database/migrations';
import { RouteRepository } from '../../src/database/repositories/route-repository';

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) {
    return this.raw.prepare(sql).run(...params as never[]);
  }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params as never[]) as T[];
  }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      await operation();
      this.raw.exec('COMMIT');
    } catch (error) {
      try { this.raw.exec('ROLLBACK'); } catch { /* already closed */ }
      throw error;
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationSource = readFileSync(resolve(here, '../../src/database/migrations.ts'), 'utf8');
const schemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)?.[1]);

function migration(index: number): string {
  const match = migrationSource.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}

function adapterThrough(version: number): ExpoLikeDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= version; index += 1) adapter.raw.exec(migration(index));
  return adapter;
}

const endpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai',
  geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva',
  latitude: 55.93,
  longitude: 23.31,
};

function stop(order: number): DraftStopInput {
  return {
    originalOrder: order,
    orderNumber: `U-${order}`,
    recipient: `Gavėjas ${order}`,
    originalAddress: `Tilžės g. ${order}, Šiauliai`,
    geocodingQuery: `Tilžės g. ${order}, Šiauliai`,
    normalizedAddress: `Tilžės g. ${order}, Šiauliai, Lietuva`,
    addressValidationState: 'auto_confirmed',
    latitude: 55.93 + order / 1000,
    longitude: 23.31 + order / 1000,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg: 20,
    phone: null,
    notes: null,
  };
}

async function plannedRoute(db: SQLiteDatabase, routeId = 'route-1') {
  await new CreateDraftRoute(db, () => '2026-09-01T10:00:00.000Z').execute({
    id: routeId,
    startLocation: endpoint,
    endLocation: endpoint,
  });
  let index = 0;
  await new ReplaceDraftStops(
    db,
    () => '2026-09-01T10:00:00.000Z',
    (prefix) => `${routeId}-${prefix}-${++index}`,
  ).execute(routeId, [stop(1), stop(2)]);
  await db.runAsync("UPDATE routes SET status = 'planned' WHERE id = ?", routeId);
}

describe('park-memory schema v28 and start-loading path', () => {
  it('keeps SCHEMA_VERSION at 28 with an idempotent park-memory migration', () => {
    expect(schemaVersion).toBe(28);
    expect(migrationSource).toContain('ensureParkMemorySchema');
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS location_park_memory');
    // The production upgrade path must not re-exec the brittle BEGIN-wrapped blob.
    expect(migrationSource).toMatch(/if \(currentVersion < 28\) \{[\s\S]*ensureParkMemorySchema/);
    expect(migration(28)).not.toContain('BEGIN IMMEDIATE');
  });

  it('upgrades a populated v27 database via migrateDatabase and can ActivateRoute', async () => {
    const adapter = adapterThrough(27);
    const db = adapter as unknown as SQLiteDatabase;
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 27 });

    await plannedRoute(db);
    await migrateDatabase(db);

    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 28 });
    const stopColumns = adapter.raw.prepare('PRAGMA table_info(delivery_stops)').all()
      .map((column) => String(column.name));
    expect(stopColumns).toEqual(expect.arrayContaining([
      'park_latitude', 'park_longitude', 'park_heading',
      'park_accuracy_m', 'park_sample_count', 'park_sampled_at',
    ]));
    expect(adapter.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='location_park_memory'",
    ).get()).toMatchObject({ name: 'location_park_memory' });

    await expect(new ActivateRoute(db).execute('route-1')).resolves.toEqual({ idempotent: false });
    expect(await new RouteRepository(db).getById('route-1')).toMatchObject({ status: 'loading' });
    expect(await new ActivateRoute(db).execute('route-1')).toEqual({ idempotent: true });
  });

  it('repairs a partial v28 state where the memory table exists but park columns do not', async () => {
    const adapter = adapterThrough(27);
    // Simulate the stale-client failure mode: CREATE succeeded (or was left
    // behind) while delivery_stops park_* columns were never added and
    // user_version stayed at 27.
    adapter.raw.exec(`
      CREATE TABLE location_park_memory (
        address_key TEXT PRIMARY KEY NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        heading REAL,
        accuracy_m REAL,
        sample_count INTEGER NOT NULL DEFAULT 1,
        last_sampled_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const db = adapter as unknown as SQLiteDatabase;
    await plannedRoute(db);

    await migrateDatabase(db);

    const stopColumns = adapter.raw.prepare('PRAGMA table_info(delivery_stops)').all()
      .map((column) => String(column.name));
    expect(stopColumns).toEqual(expect.arrayContaining(['park_latitude', 'park_longitude']));
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 28 });
    await expect(new ActivateRoute(db).execute('route-1')).resolves.toEqual({ idempotent: false });
  });

  it('ensureParkMemorySchema is safe to re-run on an already-migrated database', async () => {
    const adapter = adapterThrough(28);
    const db = adapter as unknown as SQLiteDatabase;
    await ensureParkMemorySchema(db);
    await ensureParkMemorySchema(db);
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 28 });
  });

  it('ActivateRoute reports a clear conflict when another route is already working', async () => {
    const adapter = adapterThrough(28);
    const db = adapter as unknown as SQLiteDatabase;
    await plannedRoute(db, 'route-new');
    await plannedRoute(db, 'route-busy');
    await db.runAsync("UPDATE routes SET status = 'in_progress' WHERE id = 'route-busy'");

    await expect(new ActivateRoute(db).execute('route-new')).rejects.toMatchObject({
      code: 'ACTIVE_ROUTE_EXISTS',
      message: expect.stringContaining('Jau vykdomas kitas maršrutas'),
    });
    expect(await new RouteRepository(db).getById('route-new')).toMatchObject({ status: 'planned' });
  });

  it('fresh install through migrateDatabase can start loading', async () => {
    const adapter = new ExpoLikeDatabase();
    const db = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(db);
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 28 });
    await plannedRoute(db);
    await expect(new ActivateRoute(db).execute('route-1')).resolves.toEqual({ idempotent: false });
  });
});
