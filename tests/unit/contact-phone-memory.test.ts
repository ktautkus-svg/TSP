import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { CreateDraftRouteWithStops, UpdateStopPhone, type DraftStopInput } from '../../src/application/routes/route-commands';
import { RouteRepository } from '../../src/database/repositories/route-repository';

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

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
const version = Number(source.match(/SCHEMA_VERSION = (\d+)/)?.[1]);
function migration(index: number): string {
  const match = source.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}

function database(): { db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= version; index += 1) adapter.raw.exec(migration(index));
  return { db: adapter as unknown as SQLiteDatabase };
}

const endpoint = {
  originalAddress: 'Savanorių pr. 180, Vilnius',
  geocodingQuery: 'Savanorių pr. 180, Vilnius',
  normalizedAddress: 'Savanorių pr. 180, Vilnius',
  latitude: 54.675,
  longitude: 25.24,
};

const ADDRESS = 'Smėlynės g. 25, Panevėžys';

function stop(overrides: Partial<DraftStopInput> = {}): DraftStopInput {
  return {
    sourceStopId: 'row-1',
    originalOrder: 1,
    orderNumber: null,
    recipient: 'Klientas',
    originalAddress: ADDRESS,
    geocodingQuery: ADDRESS,
    normalizedAddress: ADDRESS,
    addressValidationState: 'auto_confirmed',
    latitude: 55.73,
    longitude: 24.36,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg: 10,
    phone: null,
    notes: null,
    ...overrides,
  };
}

let commandCounter = 0;
function createInput(stops: DraftStopInput[]) {
  commandCounter += 1;
  return {
    commandId: `command-${commandCounter}`,
    startLocation: endpoint,
    endLocation: endpoint,
    importSource: { type: 'pasted_text' as const, originalText: 'importas', imageReference: null },
    stops,
  };
}

describe('contact phone memory', () => {
  it('fills in a phone on a later import once it was entered once for that address', async () => {
    const { db } = database();
    await new CreateDraftRouteWithStops(db).execute(createInput([stop({ phone: '+37061234567' })]));

    const { routeId } = await new CreateDraftRouteWithStops(db).execute(createInput([stop({ phone: null })]));

    const stops = await new RouteRepository(db).getStops(routeId);
    expect(stops[0]?.phone).toBe('+37061234567');
  });

  it('remembers a phone entered manually via UpdateStopPhone too', async () => {
    const { db } = database();
    const { routeId, stopIds } = await new CreateDraftRouteWithStops(db).execute(createInput([stop({ phone: null })]));
    await new UpdateStopPhone(db).execute(routeId, stopIds[0]!, '061234567');

    const { routeId: nextRouteId } = await new CreateDraftRouteWithStops(db).execute(createInput([stop({ phone: null })]));
    const stops = await new RouteRepository(db).getStops(nextRouteId);
    expect(stops[0]?.phone).toBe('+37061234567');
  });

  it('leaves an unrelated address without a remembered phone', async () => {
    const { db } = database();
    await new CreateDraftRouteWithStops(db).execute(createInput([stop({ phone: '+37061234567' })]));

    const { routeId } = await new CreateDraftRouteWithStops(db).execute(createInput([
      stop({ phone: null, originalAddress: 'Kitas adresas 5, Kaunas', normalizedAddress: 'Kitas adresas 5, Kaunas' }),
    ]));

    const stops = await new RouteRepository(db).getStops(routeId);
    expect(stops[0]?.phone).toBeNull();
  });
});
