import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  bestPoint,
  buildStatsSeries,
  computeEarningsMetrics,
  computePeriodMetrics,
  percentChange,
  periodForPreset,
  previousPeriod,
  type StatsRouteRow,
} from '../../src/domain/statistics';
import { toEarningsRows } from '../../src/application/statistics/earnings';
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
    vehicleMaxPayloadKg: null,
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

const NOW = new Date('2026-08-05T12:00:00.000Z'); // Wednesday

describe('period presets (pure)', () => {
  it('today is a single-day range ending on now', () => {
    expect(periodForPreset('today', NOW)).toEqual({ fromKey: '2026-08-05', toKey: '2026-08-05' });
  });

  it('week starts on Monday, in UTC, even in a timezone ahead of it', () => {
    // 2026-08-05 is a Wednesday; the Monday of that ISO week is 2026-08-03.
    expect(periodForPreset('week', NOW)).toEqual({ fromKey: '2026-08-03', toKey: '2026-08-05' });
  });

  it('month starts on the 1st of the current calendar month', () => {
    expect(periodForPreset('month', NOW)).toEqual({ fromKey: '2026-08-01', toKey: '2026-08-05' });
  });

  it('year is the trailing 365 days ending on now', () => {
    expect(periodForPreset('year', NOW)).toEqual({ fromKey: '2025-08-06', toKey: '2026-08-05' });
  });

  it('custom uses the given range, swapped if reversed', () => {
    expect(periodForPreset('custom', NOW, { fromKey: '2026-01-01', toKey: '2026-01-31' }))
      .toEqual({ fromKey: '2026-01-01', toKey: '2026-01-31' });
    expect(periodForPreset('custom', NOW, { fromKey: '2026-01-31', toKey: '2026-01-01' }))
      .toEqual({ fromKey: '2026-01-01', toKey: '2026-01-31' });
  });

  it('previousPeriod is the same-length window immediately before', () => {
    expect(previousPeriod({ fromKey: '2026-08-03', toKey: '2026-08-05' }))
      .toEqual({ fromKey: '2026-07-31', toKey: '2026-08-02' });
    // A single day compares against the single day before it.
    expect(previousPeriod({ fromKey: '2026-08-05', toKey: '2026-08-05' }))
      .toEqual({ fromKey: '2026-08-04', toKey: '2026-08-04' });
  });
});

describe('percentChange', () => {
  it('computes a relative change', () => {
    expect(percentChange(112, 100)).toBeCloseTo(12, 5);
    expect(percentChange(88, 100)).toBeCloseTo(-12, 5);
  });
  it('is null when there is nothing to compare against (and not 0 or Infinity)', () => {
    expect(percentChange(10, 0)).toBeNull();
  });
  it('is 0 when both periods are exactly zero', () => {
    expect(percentChange(0, 0)).toBe(0);
  });
});

describe('computePeriodMetrics (pure)', () => {
  it('returns zeroed totals and null averages for no data, no NaN/Infinity anywhere', () => {
    const metrics = computePeriodMetrics([], [], { fromKey: '2026-08-01', toKey: '2026-08-05' });
    expect(metrics.routeCount).toBe(0);
    expect(metrics.totalKm).toBe(0);
    expect(metrics.totalKmSource).toBe('none');
    expect(metrics.averageKmPerStop).toBeNull();
    expect(metrics.averageStopsPerRoute).toBeNull();
    expect(metrics.averageRouteDurationMinutes).toBeNull();
    expect(metrics.averageLoadPercent).toBeNull();
    expect(metrics.onTimeWindowPercent).toBeNull();
  });

  it('falls back to estimated distance when actual is null, and flags the source', () => {
    const rows = [baseRow({ date: '2026-08-05', actualDistanceKm: null, estimatedDistanceKm: 42, totalStops: 3 })];
    const metrics = computePeriodMetrics(rows, [], { fromKey: '2026-08-05', toKey: '2026-08-05' });
    expect(metrics.totalKm).toBe(42);
    expect(metrics.totalKmSource).toBe('estimated');
  });

  it('excludes a route with no distance at all from the km sum (not counted as 0)', () => {
    const rows = [
      baseRow({ date: '2026-08-05', actualDistanceKm: 10, estimatedDistanceKm: null }),
      baseRow({ date: '2026-08-05', actualDistanceKm: null, estimatedDistanceKm: null, status: 'cancelled' }),
    ];
    const metrics = computePeriodMetrics(rows, [], { fromKey: '2026-08-05', toKey: '2026-08-05' });
    expect(metrics.totalKm).toBe(10);
    expect(metrics.totalKmSource).toBe('actual');
    expect(metrics.routeCount).toBe(2);
  });

  it('excludes cancelled routes from the route-duration average', () => {
    const rows = [
      baseRow({ date: '2026-08-04', status: 'completed', startedAt: '2026-08-04T08:00:00.000Z', completedAt: '2026-08-04T09:30:00.000Z' }),
      baseRow({ date: '2026-08-04', status: 'cancelled', startedAt: '2026-08-04T08:00:00.000Z', completedAt: null }),
    ];
    const metrics = computePeriodMetrics(rows, [], { fromKey: '2026-08-04', toKey: '2026-08-04' });
    expect(metrics.averageRouteDurationMinutes).toBe(90);
  });

  it('excludes rows outside the period', () => {
    const rows = [
      baseRow({ date: '2026-08-01', actualDistanceKm: 100 }),
      baseRow({ date: '2026-07-31', actualDistanceKm: 200 }),
    ];
    const metrics = computePeriodMetrics(rows, [], { fromKey: '2026-08-01', toKey: '2026-08-05' });
    expect(metrics.totalKm).toBe(100);
    expect(metrics.routeCount).toBe(1);
  });

  it('sorts failure reasons by count descending', () => {
    const metrics = computePeriodMetrics(
      [],
      [{ reason: 'Kita', count: 2 }, { reason: 'Nedirba', count: 5 }],
      { fromKey: '2026-08-01', toKey: '2026-08-05' },
    );
    expect(metrics.failureReasons.map((item) => item.reason)).toEqual(['Nedirba', 'Kita']);
  });

  it('pulls delivered/failed/unmarked, weight, and on-time/late from completionSummary', () => {
    const rows = [baseRow({
      date: '2026-08-05',
      completionSummary: summary({
        deliveredStops: 3, failedStops: 1, unmarkedStops: 0,
        deliveredKnownWeightKg: 10, undeliveredKnownWeightKg: 2.5,
        onTimeStops: 2, lateStops: 1,
      }),
    })];
    const metrics = computePeriodMetrics(rows, [], { fromKey: '2026-08-05', toKey: '2026-08-05' });
    expect(metrics.deliveredStops).toBe(3);
    expect(metrics.failedStops).toBe(1);
    expect(metrics.totalWeightKg).toBe(12.5);
    expect(metrics.onTimeStops).toBe(2);
    expect(metrics.lateStops).toBe(1);
    expect(metrics.onTimeWindowPercent).toBeCloseTo((2 / 3) * 100, 5);
    expect(metrics.routesWithLateStop).toBe(1);
    expect(metrics.routesFullyOnTime).toBe(0);
  });

  it('averages load percent only across routes with a known vehicle capacity', () => {
    const rows = [
      baseRow({ date: '2026-08-01', completionSummary: summary({ deliveredKnownWeightKg: 300 }), vehicleMaxPayloadKg: 1_500 }), // 20%
      baseRow({ date: '2026-08-02', completionSummary: summary({ deliveredKnownWeightKg: 900 }), vehicleMaxPayloadKg: null }), // ignored
    ];
    const metrics = computePeriodMetrics(rows, [], { fromKey: '2026-08-01', toKey: '2026-08-05' });
    expect(metrics.averageLoadPercent).toBeCloseTo(20, 5);
  });
});

describe('buildStatsSeries (pure)', () => {
  it('sums two routes on the same date into a single daily bucket', () => {
    const rows = [
      baseRow({ date: '2026-08-05', actualDistanceKm: 10, totalStops: 2 }),
      baseRow({ date: '2026-08-05', actualDistanceKm: 15, totalStops: 3 }),
    ];
    const series = buildStatsSeries(rows, { fromKey: '2026-08-05', toKey: '2026-08-05' });
    expect(series.granularity).toBe('day');
    expect(series.points[0]!.km).toBe(25);
    expect(series.points[0]!.stops).toBe(5);
  });

  it('switches to monthly buckets past the daily-chart threshold (the year preset)', () => {
    const rows = [
      baseRow({ date: '2026-07-31', actualDistanceKm: 5 }),
      baseRow({ date: '2026-08-01', actualDistanceKm: 7 }),
    ];
    const period = periodForPreset('year', NOW);
    const series = buildStatsSeries(rows, period);
    expect(series.granularity).toBe('month');
    const july = series.points.find((point) => point.key === '2026-07');
    const august = series.points.find((point) => point.key === '2026-08');
    expect(july?.km).toBe(5);
    expect(august?.km).toBe(7);
  });

  it('fills every day in range even with no data (zero, not missing)', () => {
    const series = buildStatsSeries([], { fromKey: '2026-08-01', toKey: '2026-08-05' });
    expect(series.points).toHaveLength(5);
    expect(series.points.every((point) => point.km === 0)).toBe(true);
  });
});

describe('bestPoint', () => {
  it('finds the highest-km point, ignoring zero-km points', () => {
    const rows = [
      baseRow({ date: '2026-08-03', actualDistanceKm: 12 }),
      baseRow({ date: '2026-08-04', actualDistanceKm: 40 }),
    ];
    const series = buildStatsSeries(rows, { fromKey: '2026-08-01', toKey: '2026-08-05' });
    const record = bestPoint(series.points, (point) => point.km);
    expect(record?.key).toBe('2026-08-04');
    expect(record?.km).toBe(40);
  });

  it('returns null when every point is zero', () => {
    const series = buildStatsSeries([], { fromKey: '2026-08-01', toKey: '2026-08-05' });
    expect(bestPoint(series.points, (point) => point.km)).toBeNull();
  });
});

describe('atlygis (earnings)', () => {
  it('dedupes same driver+date compensation instead of summing it twice', () => {
    // Two routes for the same driver on the same day share ONE compensation
    // figure (attachDailyCompensation on the server) — summing per sheet would
    // double it.
    const rows = toEarningsRows([
      { driverId: 'd1', date: '2026-08-05', compensation: { totalNetEur: 45 } },
      { driverId: 'd1', date: '2026-08-05', compensation: { totalNetEur: 45 } },
      { driverId: 'd2', date: '2026-08-05', compensation: { totalNetEur: 30 } },
    ]);
    expect(rows).toHaveLength(2);
    const metrics = computeEarningsMetrics(rows, { fromKey: '2026-08-05', toKey: '2026-08-05' });
    expect(metrics.totalEur).toBe(75);
  });

  it('skips sheets with no compensation attached', () => {
    const rows = toEarningsRows([{ driverId: 'd1', date: '2026-08-05', compensation: null }]);
    expect(rows).toHaveLength(0);
  });

  it('finds the best earnings day', () => {
    const rows = toEarningsRows([
      { driverId: 'd1', date: '2026-08-01', compensation: { totalNetEur: 20 } },
      { driverId: 'd1', date: '2026-08-02', compensation: { totalNetEur: 80 } },
    ]);
    const metrics = computeEarningsMetrics(rows, { fromKey: '2026-08-01', toKey: '2026-08-05' });
    expect(metrics.bestDay?.key).toBe('2026-08-02');
    expect(metrics.bestDay?.eur).toBe(80);
  });
});

describe('StatisticsRepository.getRows (integration)', () => {
  it('returns empty rows for an empty database without throwing', async () => {
    const { db } = createDb();
    const { rows } = await new StatisticsRepository(db).getRows(NOW);
    expect(rows).toHaveLength(0);
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

    const { rows, failureCounts } = await new StatisticsRepository(db).getRows(new Date());
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.date === '2026-08-05')?.actualDistanceKm).toBe(25.5);
    expect(failureCounts).toEqual([{ reason: 'Nedirba', count: 1 }]);
  });

  it('never includes draft/in_progress routes', async () => {
    const { adapter, db } = createDb();
    const now = new Date().toISOString();
    adapter.raw.prepare(
      `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
        created_at, updated_at, unknown_weight_stops, remaining_unknown_weight_stops)
       VALUES ('r3','2026-08-05','in_progress',0,0,1,1,?,?,0,0)`,
    ).run(now, now);
    const { rows } = await new StatisticsRepository(db).getRows(new Date());
    expect(rows).toHaveLength(0);
  });

  it('every local row has a null vehicle capacity (no vehicle join available offline)', async () => {
    const { adapter, db } = createDb();
    const now = new Date().toISOString();
    adapter.raw.prepare(
      `INSERT INTO routes (id, date, status, total_weight_kg, remaining_weight_kg, total_stops, remaining_stops,
        created_at, updated_at, unknown_weight_stops, remaining_unknown_weight_stops)
       VALUES ('r4','2026-08-05','completed',0,0,1,0,?,?,0,0)`,
    ).run(now, now);
    const { rows } = await new StatisticsRepository(db).getRows(new Date());
    expect(rows[0]!.vehicleMaxPayloadKg).toBeNull();
  });
});
