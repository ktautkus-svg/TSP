import { assessDeliveryTiming } from '@/domain/lithuanian-time';
import { uniqueRegionCodes } from '@/domain/route-code';
import type { FailureReasonCount, StatsLateDelivery, StatsRouteRow } from '@/domain/statistics';
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
): { rows: StatsRouteRow[]; failureCounts: FailureReasonCount[]; lateDeliveries: StatsLateDelivery[] } {
  const selected = assignments.filter((assignment) =>
    (driverId === 'all' || assignment.driverId === driverId)
    && (vehicleId === 'all' || assignment.vehicle?.id === vehicleId));

  const rows: StatsRouteRow[] = [];
  const failures = new Map<string, number>();
  const lateDeliveries: StatsLateDelivery[] = [];

  for (const assignment of selected) {
    const route = assignment.routeSnapshot.route;
    const status = String(route.status ?? assignment.status);
    if (!['completed', 'cancelled'].includes(status)) continue;
    const routeNumbers = uniqueRegionCodes(assignment.routeSnapshot.shipmentLines);
    const routeLabel = routeNumbers.length > 0 ? routeNumbers.join(' · ') : `Maršrutas ${assignment.routeId.slice(0, 8)}`;

    rows.push({
      routeId: assignment.routeId,
      routeLabel,
      driverName: assignment.driverName,
      vehicleRegistration: assignment.vehicle?.registrationNumber ?? null,
      startAddress: snapshotLocationAddress(route.start_location_json) ?? firstStopAddress(assignment.routeSnapshot.stops),
      endAddress: snapshotLocationAddress(route.end_location_json) ?? lastStopAddress(assignment.routeSnapshot.stops),
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
    for (const stop of assignment.routeSnapshot.stops) {
      if (stop.delivery_status !== 'delivered') continue;
      const deliveredAt = optionalText(stop.delivered_at);
      const timing = assessDeliveryTiming({
        deliveredAt,
        deliveryTimeFrom: optionalText(stop.delivery_time_from),
        deliveryTimeTo: optionalText(stop.delivery_time_to),
        plannedArrivalAt: optionalText(stop.planned_arrival_at),
        latestEstimatedArrivalAt: optionalText(stop.latest_estimated_arrival_at),
      });
      if (!deliveredAt || timing.state !== 'late' || timing.differenceMinutes === null || !timing.referenceAt) continue;
      lateDeliveries.push({
        routeId: assignment.routeId,
        date: String(route.date ?? assignment.assignedAt.slice(0, 10)),
        routeLabel,
        driverId: assignment.driverId,
        driverName: assignment.driverName,
        vehicleRegistration: assignment.vehicle?.registrationNumber ?? null,
        stopId: optionalText(stop.id) ?? `${assignment.routeId}-${lateDeliveries.length + 1}`,
        address: optionalText(stop.normalized_address) ?? optionalText(stop.original_address) ?? 'Adresas nenurodytas',
        deliveredAt,
        deadlineAt: timing.referenceAt,
        delayMinutes: timing.differenceMinutes,
      });
    }
  }

  return {
    rows,
    failureCounts: [...failures].map(([reason, count]) => ({ reason, count })),
    lateDeliveries: lateDeliveries.sort((left, right) => right.deliveredAt.localeCompare(left.deliveredAt)),
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function snapshotLocationAddress(value: unknown): string | null {
  let location = value;
  if (typeof location === 'string') {
    try { location = JSON.parse(location) as unknown; } catch { return optionalText(location); }
  }
  if (!location || typeof location !== 'object') return null;
  const record = location as Record<string, unknown>;
  return optionalText(record.address) ?? optionalText(record.label);
}

function stopAddress(stop: Record<string, unknown> | undefined): string | null {
  if (!stop) return null;
  return optionalText(stop.normalized_address) ?? optionalText(stop.original_address) ?? optionalText(stop.address);
}

function firstStopAddress(stops: Record<string, unknown>[]): string | null {
  return stopAddress(stops[0]);
}

function lastStopAddress(stops: Record<string, unknown>[]): string | null {
  return stopAddress(stops.at(-1));
}
