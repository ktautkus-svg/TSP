import type { SQLiteDatabase } from 'expo-sqlite';

import type { DeliveryStop, Route, RouteEndpoint } from '@/domain/route';

type RouteRow = {
  id: string;
  vehicle_id: string | null;
  date: string;
  status: Route['status'];
  planning_mode: Route['planningMode'];
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  total_weight_kg: number;
  remaining_weight_kg: number;
  total_stops: number;
  remaining_stops: number;
  start_odometer: number | null;
  end_odometer: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  start_location_json: string | null;
  end_location_json: string | null;
  planned_departure_at: string | null;
  selected_run_id: string | null;
  selected_candidate_id: string | null;
  estimated_duration_minutes: number | null;
  source_import_audit_id: string | null;
  unknown_weight_stops: number;
  remaining_unknown_weight_stops: number;
  cancelled_at: string | null;
  start_odometer_recorded_at: string | null;
  start_odometer_skipped_at: string | null;
  end_odometer_recorded_at: string | null;
  active_sequence_snapshot_at: string | null;
  completion_started_at: string | null;
  completion_end_odometer_draft: string | null;
  return_destination_kind: Route['returnDestinationKind'];
  return_started_at: string | null;
  return_arrived_at: string | null;
  completion_summary_json: string | null;
};

type DeliveryStopRow = {
  id: string;
  source_stop_id: string | null;
  route_id: string;
  original_order: number;
  optimized_order: number | null;
  active_order: number | null;
  order_number: string | null;
  recipient: string;
  address: string;
  original_address: string;
  geocoding_query: string | null;
  normalized_address: string | null;
  address_validation_state: DeliveryStop['addressValidationState'];
  geocoding_error: string | null;
  latitude: number | null;
  longitude: number | null;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  required_time_window: number;
  service_duration_minutes: number;
  planned_arrival_at: string | null;
  planned_departure_at: string | null;
  latest_estimated_arrival_at: string | null;
  leg_distance_km: number | null;
  leg_duration_minutes: number | null;
  eta_updated_at: string | null;
  eta_approximate: number;
  weight_kg: number | null;
  priority_first: number;
  priority_rank: number | null;
  phone: string | null;
  notes: string | null;
  loading_status: DeliveryStop['loadingStatus'];
  delivery_status: DeliveryStop['deliveryStatus'];
  failure_reason: string | null;
  failure_comment: string | null;
  loaded_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseEndpoint(value: string | null): RouteEndpoint | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as RouteEndpoint;
  } catch {
    return null;
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapRoute(row: RouteRow): Route {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.date,
    status: row.status,
    planningMode: row.planning_mode,
    estimatedDistanceKm: row.estimated_distance_km,
    actualDistanceKm: row.actual_distance_km,
    totalWeightKg: row.total_weight_kg,
    remainingWeightKg: row.remaining_weight_kg,
    totalStops: row.total_stops,
    remainingStops: row.remaining_stops,
    startOdometer: row.start_odometer,
    endOdometer: row.end_odometer,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    startLocation: parseEndpoint(row.start_location_json),
    endLocation: parseEndpoint(row.end_location_json),
    plannedDepartureAt: row.planned_departure_at,
    selectedRunId: row.selected_run_id,
    selectedCandidateId: row.selected_candidate_id,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    sourceImportAuditId: row.source_import_audit_id,
    unknownWeightStops: row.unknown_weight_stops,
    remainingUnknownWeightStops: row.remaining_unknown_weight_stops,
    cancelledAt: row.cancelled_at,
    startOdometerRecordedAt: row.start_odometer_recorded_at,
    startOdometerSkippedAt: row.start_odometer_skipped_at,
    endOdometerRecordedAt: row.end_odometer_recorded_at,
    activeSequenceSnapshotAt: row.active_sequence_snapshot_at,
    completionStartedAt: row.completion_started_at,
    completionEndOdometerDraft: row.completion_end_odometer_draft,
    returnDestinationKind: row.return_destination_kind ?? null,
    returnStartedAt: row.return_started_at ?? null,
    returnArrivedAt: row.return_arrived_at ?? null,
    completionSummary: normalizeCompletionSummary(parseJson<Route['completionSummary']>(row.completion_summary_json)),
  };
}

function normalizeCompletionSummary(
  summary: Route['completionSummary'] | null,
): Route['completionSummary'] {
  if (!summary) return null;
  return {
    ...summary,
    onTimeStops: summary.onTimeStops ?? 0,
    lateStops: summary.lateStops ?? 0,
    plannedDurationMinutes: summary.plannedDurationMinutes ?? null,
    actualDurationMinutes: summary.actualDurationMinutes ?? null,
    durationDeviationMinutes: summary.durationDeviationMinutes ?? null,
    distanceDeviationKm: summary.distanceDeviationKm ?? null,
  };
}

function mapStop(row: DeliveryStopRow): DeliveryStop {
  return {
    id: row.id,
    sourceStopId: row.source_stop_id,
    routeId: row.route_id,
    originalOrder: row.original_order,
    optimizedOrder: row.optimized_order,
    activeOrder: row.active_order,
    orderNumber: row.order_number,
    recipient: row.recipient,
    address: row.address,
    originalAddress: row.original_address,
    geocodingQuery: row.geocoding_query,
    normalizedAddress: row.normalized_address,
    addressValidationState: row.address_validation_state,
    geocodingError: row.geocoding_error,
    latitude: row.latitude,
    longitude: row.longitude,
    deliveryTimeFrom: row.delivery_time_from,
    deliveryTimeTo: row.delivery_time_to,
    requiredTimeWindow: row.required_time_window === 1,
    serviceDurationMinutes: row.service_duration_minutes,
    plannedArrivalAt: row.planned_arrival_at,
    plannedDepartureAt: row.planned_departure_at,
    latestEstimatedArrivalAt: row.latest_estimated_arrival_at,
    legDistanceKm: row.leg_distance_km,
    legDurationMinutes: row.leg_duration_minutes,
    etaUpdatedAt: row.eta_updated_at,
    etaApproximate: row.eta_approximate === 1,
    weightKg: row.weight_kg,
    priorityFirst: row.priority_first === 1,
    // Old cloud snapshots may still contain only priority_first. Preserve
    // their deterministic order until the next explicit priority edit.
    priorityRank: row.priority_rank ?? (row.priority_first === 1 ? row.original_order : null),
    phone: row.phone,
    notes: row.notes,
    loadingStatus: row.loading_status,
    deliveryStatus: row.delivery_status,
    failureReason: row.failure_reason,
    failureComment: row.failure_comment,
    loadedAt: row.loaded_at,
    deliveredAt: row.delivered_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RouteRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getActive(): Promise<Route | null> {
    const row = await this.db.getFirstAsync<RouteRow>(
      `SELECT * FROM routes
       WHERE status NOT IN ('completed', 'cancelled')
       ORDER BY CASE status
         WHEN 'in_progress' THEN 0 WHEN 'loaded' THEN 1 WHEN 'loading' THEN 2
         WHEN 'planned' THEN 3 ELSE 4 END,
         date, created_at DESC LIMIT 1`,
    );
    return row ? mapRoute(row) : null;
  }

  async listOperational(ownerEmployeeId?: string | null): Promise<Route[]> {
    const ownerClause = ownerEmployeeId
      ? `AND (owner_employee_id = ? OR EXISTS (
           SELECT 1 FROM route_sync_state sync
           WHERE sync.route_id = routes.id AND sync.employee_id = ?
         ))`
      : '';
    const rows = await this.db.getAllAsync<RouteRow>(
      `SELECT * FROM routes
       WHERE status NOT IN ('completed', 'cancelled') ${ownerClause}
       ORDER BY date,
         CASE status WHEN 'in_progress' THEN 0 WHEN 'loaded' THEN 1 WHEN 'loading' THEN 2 ELSE 3 END,
         created_at DESC,
         id`,
      ...(ownerEmployeeId ? [ownerEmployeeId, ownerEmployeeId] : []),
    );
    return rows.map(mapRoute);
  }

  async getById(routeId: string): Promise<Route | null> {
    const row = await this.db.getFirstAsync<RouteRow>(
      'SELECT * FROM routes WHERE id = ?',
      routeId,
    );
    return row ? mapRoute(row) : null;
  }

  async getStops(routeId: string, direction: 'forward' | 'loading' = 'forward'): Promise<DeliveryStop[]> {
    const order = direction === 'loading'
      ? 'COALESCE(active_order, optimized_order, original_order) DESC'
      : 'COALESCE(active_order, optimized_order, original_order) ASC';
    const rows = await this.db.getAllAsync<DeliveryStopRow>(
      `SELECT * FROM delivery_stops WHERE route_id = ? ORDER BY ${order}`,
      routeId,
    );
    return rows.map(mapStop);
  }

  async getWithStops(routeId: string): Promise<{ route: Route; stops: DeliveryStop[] } | null> {
    const route = await this.getById(routeId);
    if (!route) return null;
    return { route, stops: await this.getStops(routeId) };
  }

  async listHistory(limit = 50, ownerEmployeeId?: string | null): Promise<Route[]> {
    const ownerClause = ownerEmployeeId
      ? `AND (owner_employee_id = ? OR EXISTS (
           SELECT 1 FROM route_sync_state sync
           WHERE sync.route_id = routes.id AND sync.employee_id = ?
         ))`
      : '';
    const rows = await this.db.getAllAsync<RouteRow>(
      `SELECT * FROM routes
       WHERE status IN ('completed', 'cancelled')
       ${ownerClause}
       ORDER BY COALESCE(completed_at, cancelled_at, created_at) DESC, id LIMIT ?`,
      ...(ownerEmployeeId ? [ownerEmployeeId, ownerEmployeeId] : []),
      limit,
    );
    return rows.map(mapRoute);
  }

  async listAudit(routeId: string): Promise<Array<{
    id: string;
    stopId: string | null;
    actionType: string;
    before: unknown;
    after: unknown;
    createdAt: string;
    undoExpiresAt: string | null;
    undoneAt: string | null;
  }>> {
    const rows = await this.db.getAllAsync<{
      id: string;
      stop_id: string | null;
      action_type: string;
      before_json: string;
      after_json: string;
      created_at: string;
      undo_expires_at: string | null;
      undone_at: string | null;
    }>('SELECT * FROM action_journal WHERE route_id = ? ORDER BY created_at, id', routeId);
    return rows.map((row) => ({
      id: row.id,
      stopId: row.stop_id,
      actionType: row.action_type,
      before: parseJson<unknown>(row.before_json),
      after: parseJson<unknown>(row.after_json),
      createdAt: row.created_at,
      undoExpiresAt: row.undo_expires_at,
      undoneAt: row.undone_at,
    }));
  }
}
