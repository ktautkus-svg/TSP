import type { SQLiteDatabase } from 'expo-sqlite';

import { buildStatisticsSnapshot, type FailureReasonCount, type StatisticsSnapshot, type StatsRouteRow } from '@/domain/statistics';
import type { RouteCompletionSummary } from '@/domain/route';

type StatsRouteQueryRow = {
  date: string;
  status: string;
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  total_stops: number;
  started_at: string | null;
  completed_at: string | null;
  completion_summary_json: string | null;
};

function parseSummary(value: string | null): RouteCompletionSummary | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as RouteCompletionSummary;
  } catch {
    return null;
  }
}

function mapRow(row: StatsRouteQueryRow): StatsRouteRow {
  return {
    date: row.date,
    status: row.status,
    estimatedDistanceKm: row.estimated_distance_km,
    actualDistanceKm: row.actual_distance_km,
    totalStops: row.total_stops,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completionSummary: parseSummary(row.completion_summary_json),
  };
}

export class StatisticsRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  /**
   * Fetches every completed/cancelled route (unbounded by date in SQL — a single
   * driver's lifetime history stays small, so the 365-day window is applied once,
   * in buildStatisticsSnapshot, rather than duplicating the cutoff computation here).
   */
  async getSnapshot(now: Date = new Date(), windowDays = 365): Promise<StatisticsSnapshot> {
    const rows = await this.db.getAllAsync<StatsRouteQueryRow>(
      `SELECT date, status, estimated_distance_km, actual_distance_km, total_stops,
              started_at, completed_at, completion_summary_json
       FROM routes WHERE status IN ('completed', 'cancelled')`,
    );
    const failureRows = await this.db.getAllAsync<{ reason: string | null; count: number }>(
      `SELECT ds.failure_reason AS reason, COUNT(*) AS count
       FROM delivery_stops ds
       JOIN routes r ON r.id = ds.route_id
       WHERE ds.delivery_status = 'failed' AND r.status IN ('completed', 'cancelled')
       GROUP BY ds.failure_reason`,
    );
    const failureCounts: FailureReasonCount[] = failureRows
      .filter((row): row is { reason: string; count: number } => row.reason !== null)
      .map((row) => ({ reason: row.reason, count: row.count }));
    return buildStatisticsSnapshot(rows.map(mapRow), failureCounts, now, windowDays);
  }
}
