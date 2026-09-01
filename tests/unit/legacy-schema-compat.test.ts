import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  createPwaBackup,
  parsePwaBackup,
  restorePwaBackup,
} from '../../src/application/backup/pwa-backup';
import { applyRouteSnapshot, exportRouteSnapshot } from '../../src/application/auth/route-assignment-sync';
import {
  COMPATIBLE_LEGACY_SCHEMA_VERSIONS,
  migrateDatabase,
  SCHEMA_VERSION,
} from '../../src/database/migrations';

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params as never[]) as T[];
  }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');

function migration(index: number): string {
  const match = source.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}

function schema27(): ExpoLikeDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= SCHEMA_VERSION; index += 1) adapter.raw.exec(migration(index));
  return adapter;
}

function leftoverV28(): ExpoLikeDatabase {
  const adapter = schema27();
  adapter.raw.exec(`
    CREATE TABLE IF NOT EXISTS location_park_memory (
      address_key TEXT PRIMARY KEY NOT NULL,
      latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      heading REAL CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
      accuracy_m REAL CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
      sample_count INTEGER NOT NULL DEFAULT 1 CHECK (sample_count > 0),
      last_sampled_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    ALTER TABLE delivery_stops ADD COLUMN park_latitude REAL;
    ALTER TABLE delivery_stops ADD COLUMN park_longitude REAL;
    ALTER TABLE delivery_stops ADD COLUMN park_heading REAL;
    ALTER TABLE delivery_stops ADD COLUMN park_accuracy_m REAL;
    ALTER TABLE delivery_stops ADD COLUMN park_sample_count INTEGER;
    ALTER TABLE delivery_stops ADD COLUMN park_sampled_at TEXT;
    PRAGMA user_version = 28;
  `);
  return adapter;
}

async function insertDraftRoute(db: SQLiteDatabase, id: string) {
  const now = '2026-09-01T15:00:00.000Z';
  await db.runAsync(
    `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops, created_at, updated_at)
     VALUES (?, '2026-09-01', 'loading', 40, 40, 1, 1, ?, ?)`,
    id, now, now,
  );
  await db.runAsync(
    `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, weight_kg, loading_status, delivery_status, created_at, updated_at)
     VALUES (?, ?, 1, 'Gavėjas', 'Vilniaus g. 1, Šiauliai', 40, 'pending', 'pending', ?, ?)`,
    `${id}-stop`, id, now, now,
  );
}

describe('legacy schema 28 leftover after park-memory rollback', () => {
  it('keeps SCHEMA_VERSION at 27 and treats 28 as compatible leftover', () => {
    expect(SCHEMA_VERSION).toBe(27);
    expect(COMPATIBLE_LEGACY_SCHEMA_VERSIONS).toEqual([28]);
  });

  it('opens a user_version 28 database without wiping routes or blocking stop updates', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    await insertDraftRoute(db, 'route-kept');

    await expect(migrateDatabase(db)).resolves.toBeUndefined();

    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 28 });
    expect(adapter.raw.prepare('SELECT id FROM routes').get()).toMatchObject({ id: 'route-kept' });

    await db.runAsync(
      "UPDATE delivery_stops SET loading_status = 'loaded', updated_at = ? WHERE id = ?",
      '2026-09-01T15:05:00.000Z',
      'route-kept-stop',
    );
    expect(adapter.raw.prepare('SELECT loading_status FROM delivery_stops').get())
      .toMatchObject({ loading_status: 'loaded' });
  });

  it('still rejects a newer unknown schema', async () => {
    const adapter = leftoverV28();
    adapter.raw.exec('PRAGMA user_version = 29');
    await expect(migrateDatabase(adapter as unknown as SQLiteDatabase)).rejects.toThrow(/29/);
  });

  it('backs up a leftover v28 database as schema 27 without park columns', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    await insertDraftRoute(db, 'route-backup');
    await db.runAsync(
      "UPDATE delivery_stops SET park_latitude = 55.9, park_longitude = 23.3 WHERE id = 'route-backup-stop'",
    );

    const backup = await createPwaBackup(db, '1.0.0', new Date('2026-09-01T16:00:00Z'));
    expect(backup.schemaVersion).toBe(27);
    expect(backup.tables.delivery_stops[0]).not.toHaveProperty('park_latitude');
    expect(JSON.stringify(backup)).toContain('route-backup');
  });

  it('restores a schema-28 backup that still has leftover park columns', async () => {
    const source = leftoverV28();
    await insertDraftRoute(source as unknown as SQLiteDatabase, 'route-v28');
    const backup = await createPwaBackup(source as unknown as SQLiteDatabase, '1.0.0');
    backup.schemaVersion = 28;
    backup.tables.delivery_stops[0] = {
      ...backup.tables.delivery_stops[0],
      park_latitude: 55.9,
      park_longitude: 23.3,
    };
    expect(() => parsePwaBackup(JSON.stringify(backup))).not.toThrow();

    const target = schema27();
    await restorePwaBackup(target as unknown as SQLiteDatabase, backup);
    expect(target.raw.prepare('SELECT id FROM routes').get()).toMatchObject({ id: 'route-v28' });
    expect(target.raw.prepare('PRAGMA table_info(delivery_stops)').all().map((column) => String(column.name)))
      .not.toEqual(expect.arrayContaining(['park_latitude']));
  });

  it('does not publish leftover park columns in a cloud snapshot', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    await insertDraftRoute(db, 'route-sync');
    await db.runAsync(
      "UPDATE delivery_stops SET park_latitude = 55.9, park_longitude = 23.3 WHERE id = 'route-sync-stop'",
    );

    const snapshot = await exportRouteSnapshot(db, 'route-sync');
    expect(snapshot.stops[0]).not.toHaveProperty('park_latitude');
    expect(snapshot.stops[0]).not.toHaveProperty('park_longitude');
  });

  it('applies a leftover-28 snapshot onto a schema-27 peer', async () => {
    const target = schema27();
    const db = target as unknown as SQLiteDatabase;
    await applyRouteSnapshot(db, {
      route: {
        id: 'route-peer',
        date: '2026-09-01',
        status: 'loading',
        total_weight_kg: 40,
        remaining_weight_kg: 40,
        total_stops: 1,
        remaining_stops: 1,
        created_at: '2026-09-01T15:00:00.000Z',
        updated_at: '2026-09-01T15:00:00.000Z',
      },
      stops: [{
        id: 'route-peer-stop',
        route_id: 'route-peer',
        original_order: 1,
        recipient: 'Gavėjas',
        address: 'Vilniaus g. 1, Šiauliai',
        weight_kg: 40,
        loading_status: 'pending',
        delivery_status: 'pending',
        created_at: '2026-09-01T15:00:00.000Z',
        updated_at: '2026-09-01T15:00:00.000Z',
        park_latitude: 55.9,
        park_longitude: 23.3,
      }],
      shipmentLines: [],
    }, '2026-09-01T16:00:00.000Z');

    expect(target.raw.prepare('SELECT id FROM routes').get()).toMatchObject({ id: 'route-peer' });
    expect(target.raw.prepare('SELECT id FROM delivery_stops').get()).toMatchObject({ id: 'route-peer-stop' });
    expect(target.raw.prepare('PRAGMA table_info(delivery_stops)').all().map((column) => String(column.name)))
      .not.toEqual(expect.arrayContaining(['park_latitude']));
  });
});
