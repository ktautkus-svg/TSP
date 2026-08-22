import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { ActivateRoute, CreateDraftRoute, ReplaceDraftStops, type DraftStopInput } from '../../src/application/routes/route-commands';
import { MarkStopLoaded, SaveStartOdometer, StartRoute } from '../../src/application/routes/route-workday';
import { TripSheetRepository } from '../../src/database/repositories/trip-sheet-repository';

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
const schemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)?.[1]);

function createDb(): SQLiteDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= schemaVersion; version += 1) {
    const match = migrationSource.match(new RegExp(`const migrationV${version} = \`([\\s\\S]*?)\`;`));
    if (!match) throw new Error(`Missing migrationV${version}`);
    adapter.raw.exec(match[1]);
  }
  return adapter as unknown as SQLiteDatabase;
}

const endpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai', geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva', latitude: 55.93, longitude: 23.31,
};

function stop(id: string, order: number): DraftStopInput {
  return {
    id, originalOrder: order, orderNumber: `U-${order}`, recipient: `Gavėjas ${order}`,
    originalAddress: `Tilžės g. ${order}, Šiauliai`, geocodingQuery: `Tilžės g. ${order}, Šiauliai`,
    normalizedAddress: `Tilžės g. ${order}, Šiauliai, Lietuva`, addressValidationState: 'auto_confirmed',
    latitude: 55.93 + order / 1000, longitude: 23.31 + order / 1000,
    deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false,
    weightKg: 10, phone: null, notes: null,
  };
}

async function loadedRoute(db: SQLiteDatabase) {
  await new CreateDraftRoute(db).execute({ id: 'route-1', startLocation: endpoint, endLocation: endpoint });
  await new ReplaceDraftStops(db, undefined, (prefix) => prefix === 'stop' ? 'stop-1' : `${prefix}-x`)
    .execute('route-1', [stop('stop-1', 1)]);
  await db.runAsync("UPDATE routes SET status = 'planned' WHERE id = 'route-1'");
  await new ActivateRoute(db).execute('route-1');
  await new MarkStopLoaded(db).execute('route-1', 'stop-1');
  await new SaveStartOdometer(db).execute('route-1', 1000);
}

describe('operational gates do not interrupt unfinished setup', () => {
  it('starts a route on schema v23 when vehicle, contacts and phones are still empty', async () => {
    const db = createDb();
    await loadedRoute(db);
    await expect(new StartRoute(db).execute('route-1')).resolves.toMatchObject({ idempotent: false });
  });

  it('blocks start only after an entered inspection date has expired', async () => {
    const db = createDb();
    await new TripSheetRepository(db).saveVehicle({
      name: 'Darbinis',
      registrationNumber: 'ABC123',
      fuelType: 'diesel',
      technicalInspectionDueOn: '2026-01-01',
      roadTaxDueOn: '2027-12-31',
      nextServiceDueOn: '2027-12-31',
    }, '2026-08-22T12:00:00.000Z');
    await loadedRoute(db);
    await expect(new StartRoute(db, () => '2026-08-22T12:00:00.000Z').execute('route-1')).rejects.toMatchObject({
      code: 'DEPARTURE_BLOCKED',
    });
  });

  it('keeps the loading and delivery screens callable without required phones', () => {
    const loading = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/route/[id]/loading.tsx'), 'utf8');
    const delivery = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/route/[id]/delivery.tsx'), 'utf8');
    const contacts = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/contacts.tsx'), 'utf8');
    expect(loading).toContain('skambinti iš maršruto galėsite, kai įrašysite');
    expect(loading).not.toContain('be jo važiuoti negalima');
    expect(delivery).toContain('testID="call-next-stop"');
    expect(delivery).toContain('testID="emergency-contacts-card"');
    expect(contacts).toContain('Kol jo nėra, maršrutą vis tiek galima vykdyti');
  });
});
