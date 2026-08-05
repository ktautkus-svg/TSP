import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  CancelDraftRoute,
  CreateDraftRoute,
  CreateDraftRouteWithStops,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import { RouteRepository } from '../../src/database/repositories/route-repository';

class ExpoLikeDatabase {
  failSourceStopId: string | null = null;
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) {
    if (sql.includes('INSERT INTO delivery_stops') && params[1] === this.failSourceStopId) {
      throw new Error(`forced stop insert failure: ${String(params[1])}`);
    }
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
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
  for (let version = 1; version <= 10; version += 1) {
    const match = source.match(new RegExp(`const migrationV${version} = \`([\\s\\S]*?)\`;`));
    if (!match) throw new Error(`Missing migrationV${version}`);
    adapter.raw.exec(match[1]);
  }
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const endpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai',
  geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva',
  latitude: 55.93,
  longitude: 23.31,
};

function stop(sourceStopId: string, order: number, address = `Tilžės g. ${order}, Šiauliai`): DraftStopInput {
  return {
    sourceStopId,
    originalOrder: order,
    orderNumber: null,
    recipient: null,
    originalAddress: address,
    geocodingQuery: address,
    normalizedAddress: address,
    addressValidationState: 'auto_confirmed',
    latitude: 55.93,
    longitude: 23.31,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg: null,
    phone: null,
    notes: null,
  };
}

function uniqueFactory(label: string) {
  let index = 0;
  return (prefix: string) => `${label}-${prefix}-${++index}`;
}

function createInput(commandId: string, stops = [stop('delivery-1', 1), stop('delivery-2', 2)]) {
  return {
    commandId,
    startLocation: endpoint,
    endLocation: endpoint,
    importSource: { type: 'pasted_text' as const, originalText: 'tas pats importas', imageReference: null },
    stops,
  };
}

describe('persisted DeliveryStop identity and atomic route creation', () => {
  it('uses the same import twice for different routes without reusing persisted IDs', async () => {
    const { db } = createDb();
    const first = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('first')).execute(createInput('command-1'));
    await new CancelDraftRoute(db).execute(first.routeId);
    const second = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('second')).execute(createInput('command-2'));
    const firstStops = await new RouteRepository(db).getStops(first.routeId);
    const secondStops = await new RouteRepository(db).getStops(second.routeId);
    expect(firstStops.map((item) => item.sourceStopId)).toEqual(['delivery-1', 'delivery-2']);
    expect(secondStops.map((item) => item.sourceStopId)).toEqual(['delivery-1', 'delivery-2']);
    expect(secondStops.map((item) => item.id)).not.toEqual(firstStops.map((item) => item.id));
  });

  it('allows duplicate addresses and duplicate source identities inside one route', async () => {
    const { db } = createDb();
    const created = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('same')).execute(
      createInput('same-command', [stop('same-source', 1, 'Dvaro g. 1'), stop('same-source', 2, 'Dvaro g. 1')]),
    );
    const stops = await new RouteRepository(db).getStops(created.routeId);
    expect(new Set(stops.map((item) => item.id)).size).toBe(2);
    expect(stops.every((item) => item.sourceStopId === 'same-source')).toBe(true);
  });

  it('returns the existing route for a repeated command and for two concurrent requests', async () => {
    const { adapter, db } = createDb();
    const command = new CreateDraftRouteWithStops(db, undefined, uniqueFactory('idem'));
    const [first, second] = await Promise.all([
      command.execute(createInput('same-command')),
      command.execute(createInput('same-command')),
    ]);
    const third = await command.execute(createInput('same-command'));
    expect(second.routeId).toBe(first.routeId);
    expect(third).toMatchObject({ routeId: first.routeId, idempotent: true });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 1 });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM delivery_stops').get()).toMatchObject({ count: 2 });
  });

  it('serializes two concurrent CreateDraftRoute commands by command ID', async () => {
    const { adapter, db } = createDb();
    const command = new CreateDraftRoute(db, undefined, uniqueFactory('draft'));
    const [first, second] = await Promise.all([
      command.execute({ commandId: 'draft-command', startLocation: endpoint }),
      command.execute({ commandId: 'draft-command', startLocation: endpoint }),
    ]);
    expect(second.routeId).toBe(first.routeId);
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 1 });
  });

  it('rolls back the route and every stop when the middle stop fails, then retries safely', async () => {
    const { adapter, db } = createDb();
    adapter.failSourceStopId = 'delivery-2';
    const command = new CreateDraftRouteWithStops(db, undefined, uniqueFactory('rollback'));
    await expect(command.execute(createInput('rollback-command', [
      stop('delivery-1', 1), stop('delivery-2', 2), stop('delivery-3', 3),
    ]))).rejects.toMatchObject({ code: 'ROUTE_CREATION_FAILED' });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 0 });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM delivery_stops').get()).toMatchObject({ count: 0 });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM route_creation_commands').get()).toMatchObject({ count: 0 });
    adapter.failSourceStopId = null;
    await expect(command.execute(createInput('rollback-command', [
      stop('delivery-1', 1), stop('delivery-2', 2), stop('delivery-3', 3),
    ]))).resolves.toMatchObject({ idempotent: false });
  });

  it('does not collide with an old DB row whose primary key equals the import ID', async () => {
    const { adapter, db } = createDb();
    let legacyId = 0;
    const legacy = await new CreateDraftRouteWithStops(db, undefined, (prefix) =>
      prefix === 'stop' ? 'delivery-1' : `legacy-${prefix}-${++legacyId}`,
    ).execute(createInput('legacy-command', [stop('delivery-1', 1)]));
    adapter.raw.prepare("UPDATE routes SET status='completed', completed_at='2026-08-03T10:00:00Z' WHERE id=?").run(legacy.routeId);
    const current = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('current'))
      .execute(createInput('current-command', [stop('delivery-1', 1)]));
    expect((await new RouteRepository(db).getStops(current.routeId))[0]).toMatchObject({ sourceStopId: 'delivery-1' });
    expect((await new RouteRepository(db).getStops(current.routeId))[0]!.id).not.toBe('delivery-1');
  });

  it.each(['cancelled', 'completed'] as const)('reuses an import after a %s route', async (terminalStatus) => {
    const { adapter, db } = createDb();
    const first = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory(`old-${terminalStatus}`)).execute(createInput('old-command'));
    if (terminalStatus === 'cancelled') await new CancelDraftRoute(db).execute(first.routeId);
    else adapter.raw.prepare("UPDATE routes SET status='completed', completed_at='now' WHERE id=?").run(first.routeId);
    await expect(new CreateDraftRouteWithStops(db, undefined, uniqueFactory(`new-${terminalStatus}`))
      .execute(createInput('new-command'))).resolves.toMatchObject({ idempotent: false });
  });

  it('recovers the old two-transaction empty draft without deleting route history', async () => {
    const { adapter, db } = createDb();
    const legacy = await new CreateDraftRoute(db, undefined, uniqueFactory('legacy-empty')).execute({
      startLocation: endpoint,
      importSource: { type: 'pasted_text', originalText: 'tas pats importas', imageReference: null },
    });
    const recovered = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('recovered'))
      .execute(createInput('recovery-command'));
    expect(recovered).toMatchObject({ routeId: legacy.routeId, recoveredIncompleteDraft: true });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 1 });
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM delivery_stops').get()).toMatchObject({ count: 2 });
  });

  it('retries idempotently from a new command instance after a process restart', async () => {
    const { db } = createDb();
    const first = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('before-restart')).execute(createInput('restart-command'));
    const afterRestart = await new CreateDraftRouteWithStops(db, undefined, uniqueFactory('after-restart')).execute(createInput('restart-command'));
    expect(afterRestart).toMatchObject({ routeId: first.routeId, idempotent: true });
  });

  it('exposes the current schema required by the SDK 54 physical pilot', () => {
    const { adapter } = createDb();
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 10 });
    const columns = adapter.raw.prepare('PRAGMA table_info(delivery_stops)').all();
    expect(columns).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'source_stop_id' })]));
    expect(adapter.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='route_creation_commands'").get()).toBeTruthy();
    expect(adapter.raw.prepare('PRAGMA table_info(routes)').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'completion_started_at' }),
      expect.objectContaining({ name: 'completion_end_odometer_draft' }),
    ]));
  });
});
