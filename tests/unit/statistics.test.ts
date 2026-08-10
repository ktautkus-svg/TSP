import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { buildStatisticsSnapshot, type StatsRouteRow } from '../../src/domain/statistics';
import { StatisticsRepository } from '../../src/database/repositories/statistics-repository';
import type { RouteCompletionSummary } from '../../src/domain/route';

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

function migration(name: string): string {
  const match = migrationSource.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}

function createDb(through = 12): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= through; version += 1) adapter.raw.exec(migration(`migrationV${version}`));
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

function baseRow(overrides: Partial<StatsRouteRow> = {}): StatsRouteRow {
  return {
    date: '2026-08-01',
    status: 'completed',
    estimatedDistanceKm: null,
    actualDistanceKm: null,
    totalStops: 0,
    startedAt: null,
    completedAt: null,
    completionSummary: null,
    ...overrides,
  };
}

function summary(overrides: Partial<RouteCompletionSummary> = {}): RouteCompletionSummary {
  return {
    totalStops: 0,
    deliveredStops: 0,
    failedStops: 0,
    unmarkedStops: 0,
    deliveredKnownWeightKg: 0,
    undeliveredKnownWeightKg: 0,
    unknownWeightStops: 0,
    plannedDistanceKm: null,
    actualDistanceKm: null,
    onTimeStops: 0,
    lateStops: 0,
    plannedDurationMinutes: null,
    actualDurationMinutes: null,
    durationDeviationMinutes: null,
    distanceDeviationKm: null,
    ...overrides,
  };
}

const NOW = new Date('2026-08-05T12:00:00.000Z');

describe('buildStatisticsSnapshot (pure)', () => {
  it('returns zeroed totals and null averages for no data, no NaN/Infinity anywhere', () => {
    const snapshot = buildStatisticsSnapshot([], [], NOW);
    expect(snapshot.allTime.routeCount).toBe(0);
    expect(snapshot.allTime.totalKm).toBe(0);
    expect(snapshot.allTime.totalKmSource).toBe('none');
    expect(snapshot.bestDay).toBeNull();
    expect(snapshot.averageKmPerStop).toBeNull();
    expect(snapshot.averageStopsPerRoute).toBeNull();
    expect(snapshot.averageRouteDurationMinutes).toBeNull();
    expect(snapshot.dailySeries).toHaveLength(30);
    expect(snapshot.monthlySeries).toHaveLength(12);
  });

  it('falls back to estimated distance when actual is null, and flags the source', () => {
    const rows = [baseRow({ date: '2026-08-05', actualDistanceKm: null, estimatedDistanceKm: 42, totalStops: 3 })];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    expect(snapshot.allTime.totalKm).toBe(42);
    expect(snapshot.allTime.totalKmSource).toBe('estimated');
    const today = snapshot.dailySeries.find((day) => day.date === '2026-08-05');
    expect(today?.km).toBe(42);
    expect(today?.kmIsActual).toBe(false);
  });

  it('excludes a route with no distance at all from the km sum (not counted as 0)', () => {
    const rows = [
      baseRow({ date: '2026-08-05', actualDistanceKm: 10, estimatedDistanceKm: null }),
      baseRow({ date: '2026-08-05', actualDistanceKm: null, estimatedDistanceKm: null, status: 'cancelled' }),
    ];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    expect(snapshot.allTime.totalKm).toBe(10);
    expect(snapshot.allTime.totalKmSource).toBe('actual');
    expect(snapshot.allTime.routeCount).toBe(2);
  });

  it('excludes cancelled routes from the route-duration average', () => {
    const rows = [
      baseRow({ date: '2026-08-04', status: 'completed', startedAt: '2026-08-04T08:00:00.000Z', completedAt: '2026-08-04T09:30:00.000Z' }),
      baseRow({ date: '2026-08-04', status: 'cancelled', startedAt: '2026-08-04T08:00:00.000Z', completedAt: null }),
    ];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    expect(snapshot.averageRouteDurationMinutes).toBe(90);
  });

  it('sums two routes on the same date into a single daily bucket', () => {
    const rows = [
      baseRow({ date: '2026-08-05', actualDistanceKm: 10, totalStops: 2 }),
      baseRow({ date: '2026-08-05', actualDistanceKm: 15, totalStops: 3 }),
    ];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    const day = snapshot.dailySeries.find((item) => item.date === '2026-08-05');
    expect(day?.km).toBe(25);
    expect(day?.stops).toBe(5);
  });

  it('buckets routes spanning a month boundary into distinct monthly entries', () => {
    const rows = [
      baseRow({ date: '2026-07-31', actualDistanceKm: 5 }),
      baseRow({ date: '2026-08-01', actualDistanceKm: 7 }),
    ];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    const july = snapshot.monthlySeries.find((item) => item.month === '2026-07');
    const august = snapshot.monthlySeries.find((item) => item.month === '2026-08');
    expect(july?.km).toBe(5);
    expect(august?.km).toBe(7);
  });

  it('excludes routes older than the window while including the boundary date', () => {
    const rows = [
      baseRow({ date: '2025-08-05', actualDistanceKm: 100 }), // exactly 365 days before NOW
      baseRow({ date: '2025-08-01', actualDistanceKm: 200 }), // older than the window
    ];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW, 365);
    expect(snapshot.allTime.totalKm).toBe(100);
    expect(snapshot.allTime.routeCount).toBe(1);
  });

  it('sorts failure reasons by count descending', () => {
    const snapshot = buildStatisticsSnapshot(
      [],
      [{ reason: 'Kita', count: 2 }, { reason: 'Nedirba', count: 5 }],
      NOW,
    );
    expect(snapshot.failureReasons.map((item) => item.reason)).toEqual(['Nedirba', 'Kita']);
  });

  it('finds the highest-km day as bestDay, ignoring zero-km days', () => {
    const rows = [
      baseRow({ date: '2026-08-03', actualDistanceKm: 12 }),
      baseRow({ date: '2026-08-04', actualDistanceKm: 40 }),
    ];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    expect(snapshot.bestDay?.date).toBe('2026-08-04');
    expect(snapshot.bestDay?.km).toBe(40);
  });

  it('pulls delivered/failed/unmarked and weight from completionSummary when present', () => {
    const rows = [baseRow({ date: '2026-08-05', completionSummary: summary({ deliveredStops: 3, failedStops: 1, unmarkedStops: 0, deliveredKnownWeightKg: 12.5 }) })];
    const snapshot = buildStatisticsSnapshot(rows, [], NOW);
    expect(snapshot.allTime.deliveredStops).toBe(3);
    expect(snapshot.allTime.failedStops).toBe(1);
    expect(snapshot.allTime.totalDeliveredWeightKg).toBe(12.5);
  });
});

describe('StatisticsRepository.getSnapshot (integration)', () => {
  it('returns a zeroed snapshot for an empty database without throwing', async () => {
    const { db } = createDb();
    const snapshot = await new StatisticsRepository(db).getSnapshot(NOW);
    expect(snapshot.allTime.routeCount).toBe(0);
  });

  it('aggregates a mix of completed/cancelled routes and failure reasons from real SQL', async () => {
    const { adapter, db } = createDb();
    const now = new Date().toISOString();
    adapter.raw.prepare(
      `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
        created_at, updated_at, unknown_weight_stops, remaining_unknown_weight_stops,
        actual_distance_km, estimated_distance_km, started_at, completed_at, completion_summary_json)
       VALUES ('r1','2026-08-05','completed',0,0,2,0,?,?,0,0,25.5,26,?,?,?)`,
    ).run(now, now, now, now, JSON.stringify(summary({ deliveredStops: 2, failedStops: 0 })));
    adapter.raw.prepare(
      `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
        created_at, updated_at, unknown_weight_stops, remaining_unknown_weight_stops)
       VALUES ('r2','2026-08-04','cancelled',0,0,1,1,?,?,0,0)`,
    ).run(now, now);
    adapter.raw.prepare(
      `INSERT INTO delivery_stops (id, route_id, original_order, delivery_status, failure_reason, created_at, updated_at)
       VALUES ('s1','r1',1,'failed','Nedirba',?,?)`,
    ).run(now, now);

    const snapshot = await new StatisticsRepository(db).getSnapshot(new Date());
    expect(snapshot.allTime.routeCount).toBe(2);
    expect(snapshot.allTime.completedRouteCount).toBe(1);
    expect(snapshot.allTime.cancelledRouteCount).toBe(1);
    expect(snapshot.allTime.totalKm).toBe(25.5);
    expect(snapshot.failureReasons).toEqual([{ reason: 'Nedirba', count: 1 }]);
  });

  it('never includes draft/in_progress routes in the snapshot', async () => {
    const { adapter, db } = createDb();
    const now = new Date().toISOString();
    adapter.raw.prepare(
      `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
        created_at, updated_at, unknown_weight_stops, remaining_unknown_weight_stops)
       VALUES ('r3','2026-08-05','in_progress',0,0,1,1,?,?,0,0)`,
    ).run(now, now);
    const snapshot = await new StatisticsRepository(db).getSnapshot(new Date());
    expect(snapshot.allTime.routeCount).toBe(0);
  });
});
