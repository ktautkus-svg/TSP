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
  summarizePwaBackup,
} from '../../src/application/backup/pwa-backup';

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

const migrationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'),
  'utf8',
);

// Read from the source so a new migration cannot silently leave this behind.
const latestSchemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)![1]);

function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= latestSchemaVersion; version += 1) {
    const match = migrationSource.match(new RegExp('const migrationV' + version + ' = `([\\s\\S]*?)`;'));
    if (!match) throw new Error(`Missing migration ${version}`);
    adapter.raw.exec(match[1]);
  }
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

async function insertCompletedRoute(db: SQLiteDatabase, id: string) {
  await db.runAsync(
    `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops, created_at, updated_at, completed_at)
     VALUES (?, '2026-08-03', 'completed', 100, 0, 1, 0, ?, ?, ?)`,
    id,
    '2026-08-03T06:00:00.000Z',
    '2026-08-03T15:00:00.000Z',
    '2026-08-03T15:00:00.000Z',
  );
  await db.runAsync(
    `INSERT INTO delivery_stops (id, route_id, original_order, recipient, address, weight_kg, loading_status, delivery_status, created_at, updated_at)
     VALUES (?, ?, 1, 'Gavėjas', 'Vilniaus g. 1, Šiauliai', 100, 'loaded', 'delivered', ?, ?)`,
    `${id}-stop`, id, '2026-08-03T06:00:00.000Z', '2026-08-03T08:00:00.000Z',
  );
}

describe('PWA full backup', () => {
  it('exports required route data without gateway secrets', async () => {
    const { db } = createDb();
    await insertCompletedRoute(db, 'route-a');
    await db.runAsync("INSERT INTO app_preferences (key, value, updated_at) VALUES ('local_access_pin_hash', 'private-pin-hash', '2026-08-03T16:00:00Z')");
    const backup = await createPwaBackup(db, '1.0.0', new Date('2026-08-03T16:00:00Z'));
    const serialized = JSON.stringify(backup);
    expect(summarizePwaBackup(backup)).toMatchObject({ routeCount: 1, stopCount: 1 });
    expect(serialized).toContain('route-a');
    expect(serialized).not.toContain('GOOGLE_ROUTES_API_KEY');
    expect(serialized).not.toContain('gateway_device_secret');
    expect(serialized).not.toContain('private-pin-hash');
  });

  it('restores all data atomically into another same-schema database', async () => {
    const source = createDb();
    await insertCompletedRoute(source.db, 'route-source');
    const backup = await createPwaBackup(source.db, '1.0.0');
    const target = createDb();
    await insertCompletedRoute(target.db, 'route-old');
    await target.db.runAsync("INSERT INTO app_preferences (key, value, updated_at) VALUES ('local_access_pin_hash', 'keep-this-hash', '2026-08-03T16:00:00Z')");
    await restorePwaBackup(target.db, backup);
    expect(await target.db.getFirstAsync<{ id: string }>('SELECT id FROM routes')).toEqual({ id: 'route-source' });
    expect(await target.db.getFirstAsync<{ route_id: string }>('SELECT route_id FROM delivery_stops')).toEqual({ route_id: 'route-source' });
    expect(await target.db.getFirstAsync<{ value: string }>("SELECT value FROM app_preferences WHERE key = 'local_access_pin_hash'")).toEqual({ value: 'keep-this-hash' });
  });

  it('rejects invalid format/schema and rolls back incompatible rows', async () => {
    expect(() => parsePwaBackup('{"format":"other"}')).toThrow();
    const source = createDb();
    await insertCompletedRoute(source.db, 'route-source');
    const backup = await createPwaBackup(source.db, '1.0.0');
    const target = createDb();
    await insertCompletedRoute(target.db, 'route-safe');
    backup.tables.routes[0].unknown_column = 'bad';
    await expect(restorePwaBackup(target.db, backup)).rejects.toThrow();
    expect(await target.db.getFirstAsync<{ id: string }>('SELECT id FROM routes')).toEqual({ id: 'route-safe' });
  });
});
