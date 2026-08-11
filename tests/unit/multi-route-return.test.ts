import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { CreateDraftRoute } from '../../src/application/routes/route-commands';
import { ConfirmRouteReturnArrival, StartRouteReturn } from '../../src/application/routes/route-workday';

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

function database(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= version; index += 1) adapter.raw.exec(migration(index));
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const endpoint = {
  originalAddress: 'Savanorių pr. 180, Vilnius',
  geocodingQuery: 'Savanorių pr. 180, Vilnius',
  normalizedAddress: 'Savanorių pr. 180, Vilnius',
  latitude: 54.675,
  longitude: 25.24,
};

describe('several planned routes and durable return stage', () => {
  it('keeps several planned routes but only one physically worked route', async () => {
    const { adapter, db } = database();
    await new CreateDraftRoute(db).execute({ id: 'route-one', startLocation: endpoint, endLocation: endpoint });
    await db.runAsync("UPDATE routes SET status = 'planned' WHERE id = 'route-one'");
    await new CreateDraftRoute(db).execute({ id: 'route-two', startLocation: endpoint, endLocation: endpoint });
    await db.runAsync("UPDATE routes SET status = 'planned' WHERE id = 'route-two'");
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM routes WHERE status = 'planned'").get()).toMatchObject({ count: 2 });

    await db.runAsync("UPDATE routes SET status = 'in_progress', remaining_stops = 0 WHERE id = 'route-one'");
    expect(() => adapter.raw.prepare("UPDATE routes SET status = 'loading' WHERE id = 'route-two'").run()).toThrow();
  });

  it('persists return destination, arrival and odometer-ready state separately', async () => {
    const { adapter, db } = database();
    await new CreateDraftRoute(db).execute({ id: 'route-return', startLocation: endpoint, endLocation: endpoint });
    await db.runAsync("UPDATE routes SET status = 'in_progress', remaining_stops = 0 WHERE id = 'route-return'");
    await new StartRouteReturn(db, () => '2026-08-11T18:00:00.000Z').execute('route-return', 'warehouse', endpoint);
    expect(adapter.raw.prepare("SELECT return_destination_kind, return_started_at, return_arrived_at FROM routes WHERE id = 'route-return'").get()).toMatchObject({
      return_destination_kind: 'warehouse',
      return_started_at: '2026-08-11T18:00:00.000Z',
      return_arrived_at: null,
    });
    await new ConfirmRouteReturnArrival(db, () => '2026-08-11T18:20:00.000Z').execute('route-return');
    expect(adapter.raw.prepare("SELECT return_arrived_at, completion_started_at, status FROM routes WHERE id = 'route-return'").get()).toMatchObject({
      return_arrived_at: '2026-08-11T18:20:00.000Z',
      completion_started_at: '2026-08-11T18:20:00.000Z',
      status: 'in_progress',
    });
  });
});
