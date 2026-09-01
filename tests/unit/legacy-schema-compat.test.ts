import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { applyRouteSnapshot, exportRouteSnapshot } from '../../src/application/auth/route-assignment-sync';
import {
  createPwaBackup,
  parsePwaBackup,
  restorePwaBackup,
} from '../../src/application/backup/pwa-backup';
import { ActivateRoute, CreateDraftRouteWithStops } from '../../src/application/routes/route-commands';
import {
  COMPATIBLE_LEGACY_SCHEMA_VERSIONS,
  migrateDatabase,
  SCHEMA_VERSION,
} from '../../src/database/migrations';
import { LocationParkMemoryRepository } from '../../src/database/repositories/location-park-memory-repository';
import { ExcelImportRepository } from '../../src/database/repositories/excel-import-repository';
import { LOGISTICS_EXCEL_V1, type ExcelImportPreview } from '../../src/domain/import/excel-models';

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
    try {
      this.raw.exec('BEGIN IMMEDIATE');
      await operation();
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }
}

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');

function migration(index: number): string {
  const match = source.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}

function schemaThrough(version: number): ExpoLikeDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= version; index += 1) adapter.raw.exec(migration(index));
  return adapter;
}

function schema27(): ExpoLikeDatabase {
  return schemaThrough(27);
}

function schema28(): ExpoLikeDatabase {
  return schemaThrough(28);
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

const endpoint = {
  originalAddress: 'Sandėlio g. 1, Šiauliai',
  geocodingQuery: 'Sandėlio g. 1, Šiauliai',
  normalizedAddress: 'Sandėlio g. 1, Šiauliai, Lietuva',
  latitude: 55.93,
  longitude: 23.31,
};

function excelPreview(id = 'excel-leftover'): ExcelImportPreview {
  const now = '2026-09-01T15:00:00.000Z';
  return {
    id,
    fileName: 'maršrutas.xlsx',
    fileHash: 'hash-leftover',
    templateId: LOGISTICS_EXCEL_V1.id,
    templateVersion: LOGISTICS_EXCEL_V1.version,
    sheets: [{ name: 'Lapas1', rowCount: 1, score: 1, selected: true }],
    selectedSheetName: 'Lapas1',
    firstDataRow: 2,
    mapping: LOGISTICS_EXCEL_V1.columns,
    mappingRecognized: true,
    selectedRouteCodes: ['R1'],
    rows: [{
      id: `${id}-row`,
      sourceImportId: id,
      sourceSheetName: 'Lapas1',
      sourceRowNumber: 2,
      orderNumber: 'S1',
      weightGrams: 40000,
      weightRaw: '40',
      deliveryTimeFrom: null,
      deliveryTimeTo: null,
      deliveryTimeRaw: null,
      supplierPrefix: null,
      recipient: 'Gavėjas',
      routeCode: 'R1',
      rawColumnD: 'Vilniaus g. 1, Šiauliai',
      rawColumnE: 'Gavėjas',
      rawRow: {},
      originalAddress: 'Vilniaus g. 1, Šiauliai',
      normalizedAddress: 'Vilniaus g. 1, Šiauliai',
      alternateAddress: null,
      manualGroupKey: null,
      issueCodes: [],
      excluded: false,
    }],
    groups: [],
    summary: {
      sourceRowCount: 1,
      includedRowCount: 1,
      uniqueOrderCount: 1,
      physicalStopCount: 1,
      unconfirmedAddressCount: 0,
      totalWeightGrams: 40000,
      unknownWeightLineCount: 0,
      routeCodes: ['R1'],
      timeWindowConflictCount: 0,
      possibleDuplicateCount: 0,
    },
    createdAt: now,
  };
}

describe('schema 28 park-memory with leftover-28 clients', () => {
  it('makes schema 28 first-class with an idempotent park-memory migration', () => {
    expect(SCHEMA_VERSION).toBe(28);
    expect(COMPATIBLE_LEGACY_SCHEMA_VERSIONS).toEqual([27]);
    expect(source).toContain('ensureParkMemorySchema');
    expect(source).toMatch(/CREATE TABLE IF NOT EXISTS location_park_memory/);
    expect(source).toContain('SCHEMA_VERSION = 28');
    expect(migration(28)).not.toContain('BEGIN IMMEDIATE');
    expect(source).toMatch(/if \(currentVersion < 28\) \{[\s\S]*ensureParkMemorySchema/);
  });

  it('opens a user_version 28 database without wiping routes or blocking import writes', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;

    await expect(migrateDatabase(db)).resolves.toBeUndefined();
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 28 });

    await new ExcelImportRepository(db).savePreview(excelPreview());
    const restored = await new ExcelImportRepository(db).getLatestReview();
    expect(restored?.preview.fileName).toBe('maršrutas.xlsx');

    const created = await new CreateDraftRouteWithStops(db).execute({
      commandId: 'import-leftover-28',
      date: '2026-09-01',
      startLocation: endpoint,
      endLocation: endpoint,
      importSource: { type: 'excel', originalText: 'preview', imageReference: null },
      stops: [{
        originalOrder: 1,
        orderNumber: 'S1',
        recipient: 'Gavėjas',
        originalAddress: 'Vilniaus g. 1, Šiauliai',
        geocodingQuery: 'Vilniaus g. 1, Šiauliai',
        normalizedAddress: 'Vilniaus g. 1, Šiauliai, Lietuva',
        addressValidationState: 'auto_confirmed',
        latitude: 55.93,
        longitude: 23.31,
        deliveryTimeFrom: null,
        deliveryTimeTo: null,
        requiredTimeWindow: false,
        weightKg: 40,
        phone: null,
        notes: null,
      }],
    });
    expect(created.stopIds).toHaveLength(1);
    expect(adapter.raw.prepare('SELECT status FROM routes WHERE id = ?').get(created.routeId))
      .toMatchObject({ status: 'draft' });
    expect(adapter.raw.prepare('PRAGMA table_info(delivery_stops)').all().map((column) => String(column.name)))
      .toEqual(expect.arrayContaining(['park_latitude', 'park_longitude', 'park_sampled_at']));
  });

  it('reuses leftover courtyard pins after migrate and can start loading', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    await new LocationParkMemoryRepository(db).save(
      'Vilniaus g. 1, Šiauliai, Lietuva',
      {
        latitude: 55.93032,
        longitude: 23.31028,
        heading: 175,
        accuracyM: 12,
        sampleCount: 1,
        lastSampledAt: '2026-09-01T15:00:00.000Z',
      },
      '2026-09-01T15:00:00.000Z',
    );
    await migrateDatabase(db);

    const created = await new CreateDraftRouteWithStops(db).execute({
      commandId: 'reuse-leftover-pin',
      id: 'route-reuse',
      date: '2026-09-01',
      startLocation: endpoint,
      endLocation: endpoint,
      stops: [{
        originalOrder: 1,
        orderNumber: 'S1',
        recipient: 'Gavėjas',
        originalAddress: 'Vilniaus g. 1, Šiauliai',
        geocodingQuery: 'Vilniaus g. 1, Šiauliai',
        normalizedAddress: 'Vilniaus g. 1, Šiauliai, Lietuva',
        addressValidationState: 'auto_confirmed',
        latitude: 55.93,
        longitude: 23.31,
        deliveryTimeFrom: null,
        deliveryTimeTo: null,
        requiredTimeWindow: false,
        weightKg: 40,
        phone: null,
        notes: null,
      }],
    });
    expect(adapter.raw.prepare('SELECT park_latitude, park_longitude FROM delivery_stops WHERE id = ?')
      .get(created.stopIds[0])).toMatchObject({
      park_latitude: 55.93032,
      park_longitude: 23.31028,
    });

    await db.runAsync("UPDATE routes SET status = 'planned' WHERE id = ?", created.routeId);
    await expect(new ActivateRoute(db).execute(created.routeId)).resolves.toEqual({ idempotent: false });
    expect(adapter.raw.prepare('SELECT status FROM routes WHERE id = ?').get(created.routeId))
      .toMatchObject({ status: 'loading' });
  });

  it('still rejects a newer unknown schema', async () => {
    const adapter = leftoverV28();
    adapter.raw.exec('PRAGMA user_version = 29');
    await expect(migrateDatabase(adapter as unknown as SQLiteDatabase)).rejects.toThrow(/29/);
  });

  it('closes a leftover open transaction from a partial migration before import', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    adapter.raw.exec('BEGIN');
    adapter.raw.exec("INSERT INTO location_park_memory (address_key, latitude, longitude, sample_count, last_sampled_at, created_at, updated_at) VALUES ('x', 55.9, 23.3, 1, '2026-09-01T15:00:00.000Z', '2026-09-01T15:00:00.000Z', '2026-09-01T15:00:00.000Z')");

    await migrateDatabase(db);
    await expect(new ExcelImportRepository(db).savePreview(excelPreview('after-orphan'))).resolves.toBeUndefined();
    expect(adapter.raw.prepare("SELECT COUNT(*) AS n FROM location_park_memory").get()).toMatchObject({ n: 0 });
  });

  it('backs up a leftover v28 database as schema 28 with park columns', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(db);
    const created = await new CreateDraftRouteWithStops(db).execute({
      commandId: 'backup-leftover-28',
      id: 'route-backup',
      date: '2026-09-01',
      startLocation: endpoint,
      endLocation: endpoint,
      stops: [{
        originalOrder: 1,
        orderNumber: 'S1',
        recipient: 'Gavėjas',
        originalAddress: 'Vilniaus g. 1, Šiauliai',
        geocodingQuery: 'Vilniaus g. 1, Šiauliai',
        normalizedAddress: 'Vilniaus g. 1, Šiauliai, Lietuva',
        addressValidationState: 'auto_confirmed',
        latitude: 55.93,
        longitude: 23.31,
        deliveryTimeFrom: null,
        deliveryTimeTo: null,
        requiredTimeWindow: false,
        weightKg: 40,
        phone: null,
        notes: null,
      }],
    });
    await db.runAsync(
      'UPDATE delivery_stops SET park_latitude = 55.9, park_longitude = 23.3 WHERE id = ?',
      created.stopIds[0],
    );

    const backup = await createPwaBackup(db, '1.0.0', new Date('2026-09-01T16:00:00Z'));
    expect(backup.schemaVersion).toBe(28);
    expect(backup.tables.delivery_stops[0]).toMatchObject({ park_latitude: 55.9, park_longitude: 23.3 });
    expect(backup.tables.location_park_memory).toEqual([]);
    expect(JSON.stringify(backup)).toContain('route-backup');
  });

  it('restores a schema-28 backup that still has leftover park columns', async () => {
    const sourceDb = leftoverV28();
    await migrateDatabase(sourceDb as unknown as SQLiteDatabase);
    const created = await new CreateDraftRouteWithStops(sourceDb as unknown as SQLiteDatabase).execute({
      commandId: 'restore-leftover-28',
      id: 'route-v28',
      date: '2026-09-01',
      startLocation: endpoint,
      endLocation: endpoint,
      stops: [{
        originalOrder: 1,
        orderNumber: 'S1',
        recipient: 'Gavėjas',
        originalAddress: 'Vilniaus g. 1, Šiauliai',
        geocodingQuery: 'Vilniaus g. 1, Šiauliai',
        normalizedAddress: 'Vilniaus g. 1, Šiauliai, Lietuva',
        addressValidationState: 'auto_confirmed',
        latitude: 55.93,
        longitude: 23.31,
        deliveryTimeFrom: null,
        deliveryTimeTo: null,
        requiredTimeWindow: false,
        weightKg: 40,
        phone: null,
        notes: null,
      }],
    });
    const backup = await createPwaBackup(sourceDb as unknown as SQLiteDatabase, '1.0.0');
    backup.schemaVersion = 28;
    backup.tables.delivery_stops[0] = {
      ...backup.tables.delivery_stops[0],
      park_latitude: 55.9,
      park_longitude: 23.3,
    };
    expect(() => parsePwaBackup(JSON.stringify(backup))).not.toThrow();

    const target = schema28();
    await restorePwaBackup(target as unknown as SQLiteDatabase, backup);
    expect(target.raw.prepare('SELECT id FROM routes').get()).toMatchObject({ id: created.routeId });
    expect(target.raw.prepare('SELECT park_latitude, park_longitude FROM delivery_stops').get())
      .toMatchObject({ park_latitude: 55.9, park_longitude: 23.3 });
  });

  it('restores a schema-27 backup onto schema 28 without requiring location_park_memory', async () => {
    const sourceDb = schema27();
    await new CreateDraftRouteWithStops(sourceDb as unknown as SQLiteDatabase).execute({
      commandId: 'restore-schema-27',
      id: 'route-v27',
      date: '2026-09-01',
      startLocation: endpoint,
      endLocation: endpoint,
      stops: [{
        originalOrder: 1,
        orderNumber: 'S1',
        recipient: 'Gavėjas',
        originalAddress: 'Vilniaus g. 1, Šiauliai',
        geocodingQuery: 'Vilniaus g. 1, Šiauliai',
        normalizedAddress: 'Vilniaus g. 1, Šiauliai, Lietuva',
        addressValidationState: 'auto_confirmed',
        latitude: 55.93,
        longitude: 23.31,
        deliveryTimeFrom: null,
        deliveryTimeTo: null,
        requiredTimeWindow: false,
        weightKg: 40,
        phone: null,
        notes: null,
      }],
    });
    const backup = await createPwaBackup(sourceDb as unknown as SQLiteDatabase, '1.0.0');
    backup.schemaVersion = 27;
    delete (backup.tables as { location_park_memory?: unknown }).location_park_memory;
    expect(() => parsePwaBackup(JSON.stringify(backup))).not.toThrow();

    const target = schema28();
    await restorePwaBackup(target as unknown as SQLiteDatabase, backup);
    expect(target.raw.prepare('SELECT id FROM routes').get()).toMatchObject({ id: 'route-v27' });
    expect(target.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='location_park_memory'").get())
      .toMatchObject({ name: 'location_park_memory' });
  });

  it('publishes courtyard park columns in a cloud snapshot', async () => {
    const adapter = leftoverV28();
    const db = adapter as unknown as SQLiteDatabase;
    await migrateDatabase(db);
    const created = await new CreateDraftRouteWithStops(db).execute({
      commandId: 'snapshot-leftover-28',
      id: 'route-sync',
      date: '2026-09-01',
      startLocation: endpoint,
      endLocation: endpoint,
      stops: [{
        originalOrder: 1,
        orderNumber: 'S1',
        recipient: 'Gavėjas',
        originalAddress: 'Vilniaus g. 1, Šiauliai',
        geocodingQuery: 'Vilniaus g. 1, Šiauliai',
        normalizedAddress: 'Vilniaus g. 1, Šiauliai, Lietuva',
        addressValidationState: 'auto_confirmed',
        latitude: 55.93,
        longitude: 23.31,
        deliveryTimeFrom: null,
        deliveryTimeTo: null,
        requiredTimeWindow: false,
        weightKg: 40,
        phone: null,
        notes: null,
      }],
    });
    await db.runAsync(
      'UPDATE delivery_stops SET park_latitude = 55.9, park_longitude = 23.3 WHERE id = ?',
      created.stopIds[0],
    );

    const snapshot = await exportRouteSnapshot(db, 'route-sync');
    expect(snapshot.stops[0]).toMatchObject({ park_latitude: 55.9, park_longitude: 23.3 });
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
