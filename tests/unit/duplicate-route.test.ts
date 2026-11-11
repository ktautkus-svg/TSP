import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { duplicateRouteToDate } from '../../src/application/routes/duplicate-route';
import { migrateDatabase } from '../../src/database/migrations';

class MemoryDatabase {
  readonly raw = new DatabaseSync(':memory:');
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

describe('duplicateRouteToDate', () => {
  it('copies the manual stop order to a fresh planned route and leaves the original untouched', async () => {
    const db = new MemoryDatabase();
    await migrateDatabase(db as never);
    const now = '2026-11-11T05:00:00.000Z';
    db.raw.prepare(`INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops, created_at, updated_at, start_odometer, started_at)
      VALUES ('r1', '2026-11-11', 'in_progress', 100, 40, 2, 1, ?, ?, 1000, ?)`).run(now, now, now);
    const insertStop = db.raw.prepare(`INSERT INTO delivery_stops (id, route_id, original_order, optimized_order, active_order, recipient, address, loading_status, delivery_status, delivered_at, created_at, updated_at)
      VALUES (?, 'r1', ?, ?, ?, ?, ?, 'loaded', ?, ?, ?, ?)`);
    // Manual order: stop B (original 2) goes first.
    insertStop.run('s1', 1, 1, 2, 'A', 'Adresas A', 'delivered', now, now, now);
    insertStop.run('s2', 2, 2, 1, 'B', 'Adresas B', 'pending', null, now, now);

    const copyId = await duplicateRouteToDate(db as never, 'r1', '2026-11-12');

    const copy = db.raw.prepare('SELECT * FROM routes WHERE id = ?').get(copyId) as Record<string, unknown>;
    expect(copy).toMatchObject({ date: '2026-11-12', status: 'planned', start_odometer: null, started_at: null, remaining_stops: 2, remaining_weight_kg: 100 });
    const copiedStops = db.raw.prepare('SELECT recipient, active_order, loading_status, delivery_status, delivered_at FROM delivery_stops WHERE route_id = ? ORDER BY active_order').all(copyId);
    expect(copiedStops.map((row) => ({ ...row }))).toEqual([
      { recipient: 'B', active_order: 1, loading_status: 'pending', delivery_status: 'pending', delivered_at: null },
      { recipient: 'A', active_order: 2, loading_status: 'pending', delivery_status: 'pending', delivered_at: null },
    ]);
    const original = db.raw.prepare("SELECT status, date, start_odometer FROM routes WHERE id = 'r1'").get();
    expect({ ...original }).toEqual({ status: 'in_progress', date: '2026-11-11', start_odometer: 1000 });
    expect({ ...db.raw.prepare("SELECT COUNT(*) AS n FROM delivery_stops WHERE route_id = 'r1'").get() }).toEqual({ n: 2 });
  });

  it('rejects a malformed date', async () => {
    const db = new MemoryDatabase();
    await expect(duplicateRouteToDate(db as never, 'r1', '12-11')).rejects.toThrow();
  });
});
