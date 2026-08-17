import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

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

const migrationSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
function migration(name: string): string {
  const match = migrationSource.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}
function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= 12; version += 1) adapter.raw.exec(migration(`migrationV${version}`));
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

function insertCompletedRoute(adapter: ExpoLikeDatabase, input: {
  id: string;
  date: string;
  plannedKm: number;
  actualKm: number;
  startOdometer: number;
  endOdometer: number;
  startedAt: string;
  completedAt: string;
}) {
  const start = JSON.stringify({ originalAddress: 'Sandėlio g. 1, Šiauliai', latitude: 55.9, longitude: 23.3 });
  const end = JSON.stringify({ originalAddress: 'Namų g. 2, Šiauliai', latitude: 55.91, longitude: 23.31 });
  adapter.raw.prepare(
    `INSERT INTO routes (
       id, date, status, planning_mode, estimated_distance_km, actual_distance_km,
       total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
       start_odometer, end_odometer, created_at, updated_at, started_at, completed_at,
       start_location_json, end_location_json, estimated_duration_minutes
     ) VALUES (?, ?, 'completed', 'ignore_time_windows', ?, ?, 100, 0, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, 60)`,
  ).run(
    input.id, input.date, input.plannedKm, input.actualKm, input.startOdometer, input.endOdometer,
    input.startedAt, input.completedAt, input.startedAt, input.completedAt, start, end,
  );
  adapter.raw.prepare(
    `INSERT INTO delivery_stops (
       id, route_id, original_order, recipient, address, original_address,
       address_validation_state, weight_kg, loading_status, delivery_status,
       loaded_at, delivered_at, created_at, updated_at
     ) VALUES (?, ?, 1, 'Gavėjas', 'Tilžės g. 1', 'Tilžės g. 1', 'auto_confirmed', 100, 'loaded', 'delivered', ?, ?, ?, ?)`,
  ).run(`stop-${input.id}`, input.id, input.startedAt, input.completedAt, input.startedAt, input.completedAt);
}

describe('trip sheet repository', () => {
  it('builds one idempotent daily sheet from completed routes', async () => {
    const { adapter, db } = createDb();
    insertCompletedRoute(adapter, {
      id: 'route-1', date: '2026-08-09', plannedKm: 42, actualKm: 45,
      startOdometer: 1000, endOdometer: 1045,
      startedAt: '2026-08-09T06:00:00.000Z', completedAt: '2026-08-09T08:00:00.000Z',
    });
    insertCompletedRoute(adapter, {
      id: 'route-2', date: '2026-08-09', plannedKm: 20, actualKm: 22,
      startOdometer: 1045, endOdometer: 1067,
      startedAt: '2026-08-09T09:00:00.000Z', completedAt: '2026-08-09T10:00:00.000Z',
    });

    const repository = new TripSheetRepository(db);
    const first = await repository.syncCompletedDate('2026-08-09', '2026-08-09T10:05:00.000Z');
    const second = await repository.syncCompletedDate('2026-08-09', '2026-08-09T10:06:00.000Z');

    expect(second.id).toBe(first.id);
    expect(second.routeIds).toEqual(['route-1', 'route-2']);
    expect(second.plannedDistanceKm).toBe(62);
    expect(second.actualDistanceKm).toBe(67);
    expect(second.startOdometer).toBe(1000);
    expect(second.endOdometer).toBe(1067);
    expect(second.actualDurationMinutes).toBe(240);
    expect(second.totalDeliveredWeightKg).toBe(200);
    expect(second.totalStops).toBe(2);
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM trip_sheets').get()).toMatchObject({ count: 1 });
  });

  it('persists the primary vehicle used by trip sheets', async () => {
    const { db } = createDb();
    const repository = new TripSheetRepository(db);
    await repository.saveVehicle({ name: 'Šaldytuvas', registrationNumber: 'ABC123', fuelType: 'diesel' });
    await expect(repository.getVehicle()).resolves.toMatchObject({
      name: 'Šaldytuvas', registrationNumber: 'ABC123', fuelType: 'diesel',
    });
  });

  it('persists a fuel refill against the concrete trip sheet', async () => {
    const { adapter, db } = createDb();
    insertCompletedRoute(adapter, {
      id: 'route-fuel', date: '2026-08-10', plannedKm: 50, actualKm: 52,
      startOdometer: 2000, endOdometer: 2052,
      startedAt: '2026-08-10T06:00:00.000Z', completedAt: '2026-08-10T10:00:00.000Z',
    });
    const repository = new TripSheetRepository(db);
    const sheet = await repository.syncCompletedDate('2026-08-10');
    const entry = await repository.saveFuelEntry({
      tripSheetId: sheet.id,
      filledAt: '2026-08-10T08:30:00.000Z',
      odometer: 2025,
      liters: 40.5,
      pricePerLiter: 1.499,
      station: 'TSP degalinė',
      notes: null,
    });

    expect(entry).toMatchObject({ tripSheetId: sheet.id, odometer: 2025, liters: 40.5, totalCost: 60.71, station: 'TSP degalinė' });
    await expect(repository.listFuelEntries()).resolves.toHaveLength(1);
  });
});
