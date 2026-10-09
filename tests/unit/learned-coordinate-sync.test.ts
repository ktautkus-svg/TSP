import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  setLearnedCoordinateDeviceId,
  setLearnedCoordinateSyncTransport,
  syncLearnedCoordinates,
} from '../../src/application/location/learned-coordinate-sync';
import { navigationTargetFromStop } from '../../src/application/navigation/navigation-url-builder';
import { buildOptimizationStop } from '../../src/application/routes/route-request-builder';
import {
  CreateDraftRoute,
  ReplaceDraftStops,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import {
  MarkStopDelivered,
  MarkStopLoaded,
  SaveStartOdometer,
  StartRoute,
} from '../../src/application/routes/route-workday';
import { ensureLearnedCoordinateSyncColumns } from '../../src/database/migrations';
import { LocationParkMemoryRepository } from '../../src/database/repositories/location-park-memory-repository';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import { InMemoryLearnedCoordinateStore } from '../../src/domain/learned-coordinate-sync';
import { routingCoordinates, type GpsSample } from '../../src/domain/location-park-memory';

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

const here = dirname(fileURLToPath(import.meta.url));
const migrationSource = readFileSync(resolve(here, '../../src/database/migrations.ts'), 'utf8');
const schemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)?.[1]);

function migration(index: number): string {
  const match = migrationSource.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}

async function database(): Promise<SQLiteDatabase> {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= schemaVersion; index += 1) adapter.raw.exec(migration(index));
  const db = adapter as unknown as SQLiteDatabase;
  await ensureLearnedCoordinateSyncColumns(db);
  return db;
}

const NOW = '2026-10-09T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const ADDRESS = 'Tilžės g. 1, Šiauliai';
const ENDPOINT = {
  originalAddress: 'Pramonės g. 1, Šiauliai',
  geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva',
  latitude: 55.91,
  longitude: 23.3,
};

function stopInput(): DraftStopInput {
  return {
    originalOrder: 1,
    orderNumber: 'U-1',
    recipient: 'Gavėjas',
    originalAddress: ADDRESS,
    geocodingQuery: ADDRESS,
    normalizedAddress: `${ADDRESS}, Lietuva`,
    addressValidationState: 'auto_confirmed',
    latitude: 55.93,
    longitude: 23.31,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg: 20,
    phone: null,
    notes: null,
  };
}

function gps(overrides: Partial<GpsSample> = {}): GpsSample {
  return {
    latitude: 55.93032,
    longitude: 23.31028,
    accuracyM: 8,
    heading: 90,
    capturedAtMs: NOW_MS,
    ...overrides,
  };
}

async function startedRoute(db: SQLiteDatabase, id = 'route-1') {
  await new CreateDraftRoute(db, () => NOW).execute({ id, startLocation: ENDPOINT, endLocation: ENDPOINT });
  await new ReplaceDraftStops(db, () => NOW, () => 'stop-1').execute(id, [stopInput()]);
  await db.runAsync(`UPDATE routes SET status = 'loading', estimated_distance_km = 40 WHERE id = ?`, id);
  await new MarkStopLoaded(db, () => NOW).execute(id, 'stop-1');
  await new SaveStartOdometer(db, () => NOW).execute(id, 1000);
  await new StartRoute(db, () => NOW).execute(id);
}

describe('learned coordinate sync between two devices', () => {
  afterEach(() => {
    setLearnedCoordinateSyncTransport(null);
    setLearnedCoordinateDeviceId(null);
  });

  it('publishes a delivery pin, lets the other device navigate with it, and rejects an older overwrite', async () => {
    const server = new InMemoryLearnedCoordinateStore();
    setLearnedCoordinateSyncTransport({
      push: async (pins) => ({
        results: pins.map((pin) => server.upsert(pin, pin.deviceId ?? 'device')).filter((item): item is NonNullable<typeof item> => item !== null),
      }),
      pull: async () => ({ pins: server.list() }),
    });

    const deviceA = await database();
    setLearnedCoordinateDeviceId('device-a');
    await startedRoute(deviceA);
    await new MarkStopDelivered(deviceA, () => NOW).execute('route-1', 'stop-1', { gpsFix: gps() });
    await syncLearnedCoordinates(deviceA);

    const published = server.list();
    expect(published).toHaveLength(1);
    expect(published[0]?.address).toBe(ADDRESS);
    expect(published[0]?.learnedLatitude).toBeCloseTo(55.93032, 5);
    expect(published[0]?.sampleCount).toBe(1);
    expect(published[0]?.lastSampledAt).toBe(NOW);
    expect(published[0]?.accuracyM).toBe(8);

    await syncLearnedCoordinates(deviceA);
    expect(server.list()[0]?.sampleCount).toBe(1);

    setLearnedCoordinateDeviceId('device-b');
    const deviceB = await database();
    await startedRoute(deviceB, 'route-b');
    const pulled = await syncLearnedCoordinates(deviceB);
    expect(pulled.pulled).toBe(1);
    const stops = await new RouteRepository(deviceB).getStops('route-b');
    const stop = stops[0];
    if (!stop) throw new Error('Įrenginys B negavo sustojimo.');
    const target = navigationTargetFromStop(stop);
    expect(target.latitude).toBeCloseTo(55.93032, 5);
    expect(routingCoordinates(stop)?.latitude).toBeCloseTo(55.93032, 5);
    const requestStop = buildOptimizationStop(stop, { planningMode: 'ignore_time_windows' }, NOW);
    expect(requestStop.location.latitude).toBeCloseTo(55.93032, 5);
    expect(requestStop.location.longitude).toBeCloseTo(23.31028, 5);

    setLearnedCoordinateDeviceId('device-a-stale');
    const stale = await database();
    await ensureLearnedCoordinateSyncColumns(stale);
    await new LocationParkMemoryRepository(stale).save(ADDRESS, {
      latitude: 55.929,
      longitude: 23.309,
      heading: null,
      accuracyM: 40,
      sampleCount: 1,
      lastSampledAt: '2026-10-08T08:00:00.000Z',
    }, '2026-10-08T08:00:00.000Z', {
      originalAddress: ADDRESS,
      normalizedAddress: `${ADDRESS}, Lietuva`,
      geocodeLatitude: 55.93,
      geocodeLongitude: 23.31,
      syncStatus: 'pending',
    });
    await syncLearnedCoordinates(stale);
    const kept = server.list()[0]!;
    expect(kept.learnedLatitude).toBeCloseTo(55.93032, 5);
    expect(kept.sampleCount).toBe(1);
    expect(kept.lastSampledAt).toBe(NOW);
    const localStillThere = await new LocationParkMemoryRepository(stale).find(ADDRESS);
    expect(localStillThere?.latitude).toBeCloseTo(55.929, 5);
  });

  it('migrates an old local pin once and does not duplicate it on the next launch', async () => {
    const server = new InMemoryLearnedCoordinateStore();
    setLearnedCoordinateSyncTransport({
      push: async (pins) => ({
        results: pins.map((pin) => server.upsert(pin, 'migrated-device')).filter((item): item is NonNullable<typeof item> => item !== null),
      }),
      pull: async () => ({ pins: server.list() }),
    });
    const db = await database();
    await db.runAsync(
      `INSERT INTO location_park_memory (
         address_key, latitude, longitude, heading, accuracy_m, sample_count, last_sampled_at, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, 2, ?, ?, ?)`,
      'tilzes g. 1, siauliai',
      55.9301,
      23.3101,
      15,
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T09:00:00.000Z',
    );
    const first = await syncLearnedCoordinates(db);
    expect(first.uploaded).toBe(1);
    expect(server.list()).toHaveLength(1);
    expect(server.list()[0]?.sampleCount).toBe(2);
    const stillLocal = await new LocationParkMemoryRepository(db).find('tilzes g. 1, siauliai');
    expect(stillLocal).not.toBeNull();
    const second = await syncLearnedCoordinates(db);
    expect(second.uploaded).toBe(0);
    expect(server.list()).toHaveLength(1);
    expect(server.list()[0]?.sampleCount).toBe(2);
  });
});
