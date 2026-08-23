import type { FailureReasonCount, StatsRouteRow } from '@/domain/statistics';
import type { RouteCompletionSummary } from '@/domain/route';
import type { ServerRouteAssignment } from '@/infrastructure/auth/employee-session';

function nullableMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSummary(value: unknown): RouteCompletionSummary | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as RouteCompletionSummary;
  } catch {
    return null;
  }
}

/**
 * Org-wide assignments (from /api/admin/assignments, admin/dispatcher only)
 * turned into the same StatsRouteRow shape the local SQLite path produces, so
 * both feed the same domain math. Filtered here by driver/vehicle because the
 * source list is already the full org and the screen only ever wants one
 * filtered view of it at a time.
 */
export function assignmentsToStatsRows(
  assignments: readonly ServerRouteAssignment[],
  driverId: string,
  vehicleId: string,
): { rows: StatsRouteRow[]; failureCounts: FailureReasonCount[] } {
  const selected = assignments.filter((assignment) =>
    (driverId === 'all' || assignment.driverId === driverId)
    && (vehicleId === 'all' || assignment.vehicle?.id === vehicleId));

  const rows: StatsRouteRow[] = [];
  const failures = new Map<string, number>();

  for (const assignment of selected) {
    const route = assignment.routeSnapshot.route;
    const status = String(route.status ?? assignment.status);
    if (!['completed', 'cancelled'].includes(status)) continue;

    rows.push({
      date: String(route.date ?? assignment.assignedAt.slice(0, 10)),
      status,
      estimatedDistanceKm: nullableMetric(route.estimated_distance_km),
      actualDistanceKm: nullableMetric(route.actual_distance_km),
      totalStops: Number(route.total_stops ?? assignment.routeSnapshot.stops.length),
      startedAt: typeof route.started_at === 'string' ? route.started_at : null,
      completedAt: typeof route.completed_at === 'string' ? route.completed_at : null,
      completionSummary: parseSummary(route.completion_summary_json),
      vehicleMaxPayloadKg: assignment.vehicle?.maximumPayloadKg ?? null,
    });

    for (const stop of assignment.routeSnapshot.stops) {
      if (stop.delivery_status !== 'failed' || typeof stop.failure_reason !== 'string') continue;
      failures.set(stop.failure_reason, (failures.get(stop.failure_reason) ?? 0) + 1);
    }
  }

  return {
    rows,
    failureCounts: [...failures].map(([reason, count]) => ({ reason, count })),
  };
}
