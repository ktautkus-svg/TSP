import type { SQLiteDatabase } from 'expo-sqlite';

import type { FailureReasonCount, StatsRouteRow } from '@/domain/statistics';
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
    // The local schema has no vehicle join, so a driver's own device history
    // never knows the van's capacity; the weight tab's load-percent figure
    // says so rather than guessing one.
    vehicleMaxPayloadKg: null,
  };
}

export type StatisticsRows = {
  rows: StatsRouteRow[];
  failureCounts: FailureReasonCount[];
};

export class StatisticsRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  /**
   * Every completed/cancelled route within `windowDays` of `now`, plus a count
   * of failure reasons across that same set. Unbounded in SQL — a single
   * driver's lifetime history stays small on a phone — and cut down to the
   * window here instead, so the caller can slice the same rows into whatever
   * period it is currently displaying without a second query.
   */
  async getRows(now: Date = new Date(), windowDays = 365, ownerEmployeeId?: string | null): Promise<StatisticsRows> {
    const windowStartDate = new Date(now);
    windowStartDate.setUTCDate(windowStartDate.getUTCDate() - windowDays);
    const windowStartKey = windowStartDate.toISOString().slice(0, 10);

    const ownerClause = ownerEmployeeId
      ? `AND (owner_employee_id = ? OR EXISTS (
           SELECT 1 FROM route_sync_state sync
           WHERE sync.route_id = routes.id AND sync.employee_id = ?
         ))`
      : '';
    const ownerParams = ownerEmployeeId ? [ownerEmployeeId, ownerEmployeeId] : [];
    const rows = await this.db.getAllAsync<StatsRouteQueryRow>(
      `SELECT date, status, estimated_distance_km, actual_distance_km, total_stops,
              started_at, completed_at, completion_summary_json
       FROM routes WHERE status IN ('completed', 'cancelled') AND date >= ? ${ownerClause}`,
      windowStartKey,
      ...ownerParams,
    );
    const failureRows = await this.db.getAllAsync<{ reason: string | null; count: number }>(
      `SELECT ds.failure_reason AS reason, COUNT(*) AS count
       FROM delivery_stops ds
       JOIN routes r ON r.id = ds.route_id
       WHERE ds.delivery_status = 'failed' AND r.status IN ('completed', 'cancelled') AND r.date >= ?
       ${ownerEmployeeId ? `AND (r.owner_employee_id = ? OR EXISTS (
         SELECT 1 FROM route_sync_state sync WHERE sync.route_id = r.id AND sync.employee_id = ?
       ))` : ''}
       GROUP BY ds.failure_reason`,
      windowStartKey,
      ...ownerParams,
    );
    const failureCounts: FailureReasonCount[] = failureRows
      .filter((row): row is { reason: string; count: number } => row.reason !== null)
      .map((row) => ({ reason: row.reason, count: row.count }));
    return { rows: rows.map(mapRow), failureCounts };
  }
}
