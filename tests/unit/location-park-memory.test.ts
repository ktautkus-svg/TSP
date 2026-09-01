import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { navigationTargetFromStop, buildNavigationUrls } from '../../src/application/navigation/navigation-url-builder';
import { estimateFirstPendingLeg } from '../../src/application/routes/route-eta';
import { CreateDraftRoute, CreateDraftRouteWithStops, ReplaceDraftStops, type DraftStopInput } from '../../src/application/routes/route-commands';
import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
import {
  MarkStopDelivered,
  MarkStopFailed,
  MarkStopLoaded,
  SaveStartOdometer,
  StartRoute,
} from '../../src/application/routes/route-workday';
import { LocationParkMemoryRepository } from '../../src/database/repositories/location-park-memory-repository';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import {
  evaluateParkSample,
  mergeParkPin,
  PARK_PIN_MAX_ACCURACY_M,
  routingCoordinates,
  type GpsSample,
} from '../../src/domain/location-park-memory';

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
const source = (path: string) => readFileSync(resolve(here, '../../', path), 'utf8');
const migrationSource = source('src/database/migrations.ts');
const schemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)?.[1]);

function migration(index: number): string {
  const match = migrationSource.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}

function database(): { db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= schemaVersion; index += 1) adapter.raw.exec(migration(index));
  return { db: adapter as unknown as SQLiteDatabase };
}

const NOW = '2026-09-01T10:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const GEOCODE = { latitude: 55.93, longitude: 23.31 };
const COURTYARD = { latitude: 55.93032, longitude: 23.31028 };

const endpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai',
  geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva',
  latitude: 55.91,
  longitude: 23.30,
};

const ADDRESS = 'Tilžės g. 1, Šiauliai';

function gps(overrides: Partial<GpsSample> = {}): GpsSample {
  return {
    latitude: COURTYARD.latitude,
    longitude: COURTYARD.longitude,
    accuracyM: 12,
    heading: 175,
    capturedAtMs: NOW_MS,
    ...overrides,
  };
}

function stopInput(overrides: Partial<DraftStopInput> = {}): DraftStopInput {
  return {
    originalOrder: 1,
    orderNumber: 'U-1',
    recipient: 'Gavėjas',
    originalAddress: ADDRESS,
    geocodingQuery: ADDRESS,
    normalizedAddress: `${ADDRESS}, Lietuva`,
    addressValidationState: 'auto_confirmed',
    latitude: GEOCODE.latitude,
    longitude: GEOCODE.longitude,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg: 20,
    phone: null,
    notes: null,
    ...overrides,
  };
}

async function startedRoute(db: SQLiteDatabase, stops: DraftStopInput[] = [stopInput()]) {
  await new CreateDraftRoute(db, () => NOW).execute({ id: 'route-1', startLocation: endpoint, endLocation: endpoint });
  let index = 0;
  await new ReplaceDraftStops(db, () => NOW, (prefix) => prefix === 'stop' ? `stop-${++index}` : `${prefix}-x`)
    .execute('route-1', stops);
  await db.runAsync("UPDATE routes SET status = 'loading', estimated_distance_km = 40 WHERE id = 'route-1'");
  for (const item of await new RouteRepository(db).getStops('route-1')) {
    await new MarkStopLoaded(db, () => NOW).execute('route-1', item.id);
  }
  await new SaveStartOdometer(db, () => NOW).execute('route-1', 1000);
  await new StartRoute(db, () => NOW).execute('route-1');
}

describe('last-mile courtyard park memory', () => {
  it('writes a learned pin on ATLIKTA when GPS is accurate and nearby', async () => {
    const { db } = database();
    await startedRoute(db);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', { gpsFix: gps() });

    const persisted = await new RouteRepository(db).getStops('route-1');
    const stop = persisted[0]!;
    expect(stop.latitude).toBe(GEOCODE.latitude);
    expect(stop.longitude).toBe(GEOCODE.longitude);
    expect(stop.parkLatitude).toBeCloseTo(COURTYARD.latitude, 6);
    expect(stop.parkLongitude).toBeCloseTo(COURTYARD.longitude, 6);
    expect(stop.parkSampleCount).toBe(1);

    const memory = await new LocationParkMemoryRepository(db).find(ADDRESS);
    expect(memory).toMatchObject({ sampleCount: 1, heading: 175 });
    expect(memory?.latitude).toBeCloseTo(COURTYARD.latitude, 6);
  });

  it('ignores a GPS fix that is too inaccurate', async () => {
    const { db } = database();
    await startedRoute(db);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', {
      gpsFix: gps({ accuracyM: PARK_PIN_MAX_ACCURACY_M + 20 }),
    });

    const stop = (await new RouteRepository(db).getStops('route-1'))[0]!;
    expect(stop.deliveryStatus).toBe('delivered');
    expect(stop.parkLatitude).toBeNull();
    expect(await new LocationParkMemoryRepository(db).find(ADDRESS)).toBeNull();
  });

  it('ignores a GPS fix that is clearly nowhere near the stop', async () => {
    const { db } = database();
    await startedRoute(db);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', {
      gpsFix: gps({ latitude: 55.98, longitude: 23.40 }),
    });
    expect(await new LocationParkMemoryRepository(db).find(ADDRESS)).toBeNull();
  });

  it('does not learn from NEATLIKTA', async () => {
    const { db } = database();
    await startedRoute(db);
    await new MarkStopFailed(db, () => NOW).execute('route-1', 'stop-1', { reason: 'Nedirba', comment: '' });
    expect(await new LocationParkMemoryRepository(db).find(ADDRESS)).toBeNull();
  });

  it('uses the learned courtyard coordinates in Naviguoti URLs, not the rooftop geocode', async () => {
    const { db } = database();
    await startedRoute(db);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', { gpsFix: gps() });
    const stop = (await new RouteRepository(db).getStops('route-1'))[0]!;
    const target = navigationTargetFromStop(stop);
    expect(target.latitude).toBeCloseTo(COURTYARD.latitude, 6);
    expect(target.longitude).toBeCloseTo(COURTYARD.longitude, 6);
    expect(target.normalizedAddress).toContain('Tilžės g. 1');
    const urls = buildNavigationUrls(target, 'web');
    expect(urls.waze).toContain(`${COURTYARD.latitude},${COURTYARD.longitude}`);
    expect(urls.waze).not.toContain(`${GEOCODE.latitude},${GEOCODE.longitude}`);
  });

  it('feeds the learned courtyard into the next planning request for the same address', async () => {
    const { db } = database();
    await startedRoute(db);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', { gpsFix: gps() });

    const created = await new CreateDraftRouteWithStops(db, () => NOW, (prefix) => `${prefix}-next`).execute({
      commandId: 'next-visit',
      startLocation: endpoint,
      endLocation: endpoint,
      importSource: { type: 'excel', originalText: ADDRESS, imageReference: null },
      stops: [stopInput()],
    });
    const persisted = await new RouteRepository(db).getWithStops(created.routeId);
    expect(persisted?.stops[0]?.latitude).toBe(GEOCODE.latitude);
    expect(persisted?.stops[0]?.parkLatitude).toBeCloseTo(COURTYARD.latitude, 6);

    const request = buildOptimizationRequestFromRoute(persisted!.route, persisted!.stops);
    expect(request.stops[0]?.location.latitude).toBeCloseTo(COURTYARD.latitude, 6);
    expect(request.stops[0]?.location.longitude).toBeCloseTo(COURTYARD.longitude, 6);
    expect(request.stops[0]?.location.address).toContain('Tilžės g. 1');
  });

  it('does not invoke a geocoding or routing provider module when marking ATLIKTA', async () => {
    const remember = source('src/application/location/remember-park-pin.ts');
    const domain = source('src/domain/location-park-memory.ts');
    const repository = source('src/database/repositories/location-park-memory-repository.ts');
    const workday = source('src/application/routes/route-workday.ts');
    for (const text of [remember, domain, repository]) {
      expect(text).not.toMatch(/geocode/i);
      expect(text).not.toMatch(/google/i);
      expect(text).not.toMatch(/here\.com/i);
      expect(text).not.toMatch(/Distance Matrix/i);
      expect(text).not.toMatch(/GatewayGeocoding/i);
    }
    expect(workday).toContain('rememberParkPinFromGps');
    expect(workday).not.toContain('GatewayGeocodingProvider');
    expect(workday).not.toContain('GoogleTravelCostProvider');
  });

  it('averages later samples so one weird tap does not jump the courtyard', () => {
    const first = mergeParkPin(null, gps());
    const drifted = mergeParkPin(first, gps({ latitude: 55.9305, longitude: 23.3105 }));
    expect(drifted.sampleCount).toBe(2);
    expect(drifted.latitude).toBeCloseTo((COURTYARD.latitude + 55.9305) / 2, 6);
    expect(evaluateParkSample({
      sample: gps({ accuracyM: 12 }),
      geocode: GEOCODE,
      previous: first,
      nowMs: NOW_MS,
    }).accepted).toBe(true);
  });

  it('copies the same courtyard onto duplicate stops so they still collapse', async () => {
    const { db } = database();
    await startedRoute(db, [stopInput(), stopInput({ originalOrder: 2, orderNumber: 'U-2' })]);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', { gpsFix: gps() });
    const stops = await new RouteRepository(db).getStops('route-1');
    expect(stops).toHaveLength(2);
    expect(stops[0]?.parkLatitude).toBeCloseTo(COURTYARD.latitude, 6);
    expect(stops[1]?.parkLatitude).toBeCloseTo(COURTYARD.latitude, 6);
    expect(routingCoordinates(stops[0]!)).toEqual(routingCoordinates(stops[1]!));
  });

  it('rebases remaining-route ETA origin onto the learned pin after ATLIKTA', async () => {
    const { db } = database();
    await startedRoute(db, [
      stopInput(),
      stopInput({
        originalOrder: 2,
        orderNumber: 'U-2',
        originalAddress: 'Vilniaus g. 10, Šiauliai',
        geocodingQuery: 'Vilniaus g. 10, Šiauliai',
        normalizedAddress: 'Vilniaus g. 10, Šiauliai, Lietuva',
        latitude: 55.94,
        longitude: 23.32,
      }),
    ]);
    await new MarkStopDelivered(db, () => NOW).execute('route-1', 'stop-1', { gpsFix: gps() });
    const persisted = await new RouteRepository(db).getWithStops('route-1');
    const fromGeocode = estimateFirstPendingLeg(
      persisted!.route,
      persisted!.stops.map((stop) => (stop.id === 'stop-1' ? { ...stop, parkLatitude: null, parkLongitude: null } : stop)),
    );
    const fromPark = estimateFirstPendingLeg(persisted!.route, persisted!.stops);
    expect(fromPark?.stopId).toBe('stop-2');
    expect(fromPark?.distanceKm).not.toBe(fromGeocode?.distanceKm);
  });
});
