import type { SQLiteDatabase } from 'expo-sqlite';

import { assessDeliveryTiming } from '@/domain/lithuanian-time';
import type { FailureReasonCount, StatsLateDelivery, StatsRouteRow } from '@/domain/statistics';
import type { RouteCompletionSummary } from '@/domain/route';

type StatsRouteQueryRow = {
  route_id: string;
  route_codes: string | null;
  start_address: string | null;
  end_address: string | null;
  date: string;
  status: string;
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  total_stops: number;
  started_at: string | null;
  completed_at: string | null;
  completion_summary_json: string | null;
};

type StatsStopQueryRow = {
  route_id: string;
  route_date: string;
  route_codes: string | null;
  stop_id: string;
  original_address: string;
  normalized_address: string | null;
  delivered_at: string;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  planned_arrival_at: string | null;
  latest_estimated_arrival_at: string | null;
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
    routeId: row.route_id,
    routeLabel: routeLabel(row.route_codes, row.route_id),
    driverName: null,
    vehicleRegistration: null,
    startAddress: row.start_address,
    endAddress: row.end_address,
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
  lateDeliveries: StatsLateDelivery[];
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
      ? `AND (r.owner_employee_id = ? OR EXISTS (
           SELECT 1 FROM route_sync_state sync
           WHERE sync.route_id = r.id AND sync.employee_id = ?
         ))`
      : '';
    const ownerParams = ownerEmployeeId ? [ownerEmployeeId, ownerEmployeeId] : [];
    const rows = await this.db.getAllAsync<StatsRouteQueryRow>(
      `SELECT r.id AS route_id, r.date, r.status, r.estimated_distance_km, r.actual_distance_km, r.total_stops,
              r.started_at, r.completed_at, r.completion_summary_json,
              (SELECT GROUP_CONCAT(DISTINCT sl.route_code) FROM shipment_lines sl WHERE sl.route_id = r.id) AS route_codes,
              (SELECT COALESCE(NULLIF(ds.normalized_address, ''), NULLIF(ds.original_address, ''), NULLIF(ds.address, ''))
               FROM delivery_stops ds WHERE ds.route_id = r.id
               ORDER BY COALESCE(ds.active_order, ds.optimized_order, ds.original_order) ASC LIMIT 1) AS start_address,
              (SELECT COALESCE(NULLIF(ds.normalized_address, ''), NULLIF(ds.original_address, ''), NULLIF(ds.address, ''))
               FROM delivery_stops ds WHERE ds.route_id = r.id
               ORDER BY COALESCE(ds.active_order, ds.optimized_order, ds.original_order) DESC LIMIT 1) AS end_address
       FROM routes r WHERE r.status IN ('completed', 'cancelled') AND r.date >= ? ${ownerClause}`,
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
    const deliveredRows = await this.db.getAllAsync<StatsStopQueryRow>(
      `SELECT r.id AS route_id, r.date AS route_date,
              (SELECT GROUP_CONCAT(DISTINCT sl.route_code) FROM shipment_lines sl WHERE sl.route_id = r.id) AS route_codes,
              ds.id AS stop_id, ds.original_address, ds.normalized_address,
              ds.delivered_at, ds.delivery_time_from, ds.delivery_time_to,
              ds.planned_arrival_at, ds.latest_estimated_arrival_at
       FROM delivery_stops ds
       JOIN routes r ON r.id = ds.route_id
       WHERE ds.delivery_status = 'delivered' AND ds.delivered_at IS NOT NULL
         AND r.status IN ('completed', 'cancelled') AND r.date >= ?
       ${ownerEmployeeId ? `AND (r.owner_employee_id = ? OR EXISTS (
         SELECT 1 FROM route_sync_state sync WHERE sync.route_id = r.id AND sync.employee_id = ?
       ))` : ''}
       ORDER BY ds.delivered_at DESC`,
      windowStartKey,
      ...ownerParams,
    );
    const lateDeliveries = deliveredRows.flatMap((row): StatsLateDelivery[] => {
      const timing = assessDeliveryTiming({
        deliveredAt: row.delivered_at,
        deliveryTimeFrom: row.delivery_time_from,
        deliveryTimeTo: row.delivery_time_to,
        plannedArrivalAt: row.planned_arrival_at,
        latestEstimatedArrivalAt: row.latest_estimated_arrival_at,
      });
      if (timing.state !== 'late' || timing.differenceMinutes === null || !timing.referenceAt) return [];
      return [{
        routeId: row.route_id,
        date: row.route_date,
        routeLabel: routeLabel(row.route_codes, row.route_id),
        driverId: null,
        driverName: null,
        vehicleRegistration: null,
        stopId: row.stop_id,
        address: row.normalized_address ?? row.original_address,
        deliveredAt: row.delivered_at,
        deadlineAt: timing.referenceAt,
        delayMinutes: timing.differenceMinutes,
      }];
    });
    return { rows: rows.map(mapRow), failureCounts, lateDeliveries };
  }
}

function routeLabel(value: string | null, routeId: string): string {
  if (value) {
    try {
      const codes = JSON.parse(value) as unknown;
      if (Array.isArray(codes)) {
        const label = codes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).join(' · ');
        if (label) return label;
      }
    } catch {
      const codes = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (codes.length > 0) return codes.join(' · ');
    }
  }
  return `Maršrutas ${routeId.slice(0, 8)}`;
}
