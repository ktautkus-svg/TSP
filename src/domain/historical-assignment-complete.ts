import {
  completionPunctuality,
  lithuanianClockOnReferenceDay,
  lithuanianDateKey,
} from './lithuanian-time';
import { isoDateOrThrow } from './shared-validation';

const FUTURE_TOLERANCE_MS = 5 * 60_000;

export type AdminCompleteAssignmentInput = {
  startedAt?: string;
  completedAt?: string;
  markAllDelivered?: boolean;
};

export class HistoricalCompleteError extends Error {
  constructor(
    readonly code: 'INVALID_COMPLETE_TIME' | 'STARTED_AFTER_COMPLETED' | 'COMPLETE_IN_FUTURE',
    message: string,
  ) {
    super(message);
  }
}

export type AdminCompleteSnapshot = {
  route: Record<string, unknown>;
  stops: Record<string, unknown>[];
};

export type AdminCompleteResult = {
  route: Record<string, unknown>;
  stops: Record<string, unknown>[];
  summary: Record<string, unknown>;
  progress: {
    routeStatus: 'completed';
    totalStops: number;
    remainingStops: 0;
    remainingWeightKg: 0;
    lastSyncedAt: string;
  };
  startedAt: string | null;
  completedAt: string;
  updatedAt: string;
};

/**
 * Resolves optional admin timestamps for assignment completion.
 * Omitted completedAt defaults to now; omitted startedAt keeps the existing
 * snapshot value (often null) so same-day complete stays unchanged.
 */
export function resolveAdminCompleteTimestamps(
  input: AdminCompleteAssignmentInput,
  existingStartedAt: string | null,
  nowIso: string,
): { startedAt: string | null; completedAt: string } {
  const completedAt = input.completedAt === undefined
    ? nowIso
    : parseCompleteTimestamp(input.completedAt);
  const startedAt = input.startedAt === undefined
    ? existingStartedAt
    : parseCompleteTimestamp(input.startedAt);
  const nowMs = Date.parse(nowIso);
  const completedMs = Date.parse(completedAt);
  const startedMs = startedAt ? Date.parse(startedAt) : null;
  if (startedMs !== null && startedMs > completedMs) {
    throw new HistoricalCompleteError(
      'STARTED_AFTER_COMPLETED',
      'Pradžios laikas negali būti vėlesnis už užbaigimo laiką.',
    );
  }
  if (completedMs > nowMs + FUTURE_TOLERANCE_MS || (startedMs !== null && startedMs > nowMs + FUTURE_TOLERANCE_MS)) {
    throw new HistoricalCompleteError(
      'COMPLETE_IN_FUTURE',
      'Pradžios ir užbaigimo laikas negali būti ateityje.',
    );
  }
  return { startedAt, completedAt };
}

/**
 * Picks a delivered_at for historical backfill without GPS or routing spend.
 * Prefer an existing stamp, then the stop window on the work day, then planned
 * arrival clock transplanted onto that day. Interpolation is last resort.
 */
export function historicalStopDeliveredAt(
  stop: Record<string, unknown>,
  workReferenceIso: string,
  fallbackIso: string,
): string {
  const existing = optionalText(stop.delivered_at);
  if (existing && Number.isFinite(Date.parse(existing))) return new Date(Date.parse(existing)).toISOString();

  const windowFrom = clockValue(stop.delivery_time_from);
  const windowTo = clockValue(stop.delivery_time_to);
  const fromMs = windowFrom ? lithuanianClockOnReferenceDay(workReferenceIso, windowFrom) : null;
  const toMs = windowTo ? lithuanianClockOnReferenceDay(workReferenceIso, windowTo) : null;
  if (fromMs !== null && toMs !== null) {
    const endMs = toMs >= fromMs ? toMs : toMs + 24 * 60 * 60_000;
    return new Date(Math.round((fromMs + endMs) / 2)).toISOString();
  }
  if (fromMs !== null) return new Date(fromMs).toISOString();
  if (toMs !== null) return new Date(toMs).toISOString();

  const planned = optionalText(stop.latest_estimated_arrival_at) ?? optionalText(stop.planned_arrival_at);
  const plannedClock = planned ? clockValue(planned) : null;
  if (plannedClock) {
    const plannedMs = lithuanianClockOnReferenceDay(workReferenceIso, plannedClock);
    if (plannedMs !== null) return new Date(plannedMs).toISOString();
  }

  return fallbackIso;
}

export function applyAdminAssignmentComplete(
  snapshot: AdminCompleteSnapshot,
  input: AdminCompleteAssignmentInput,
  nowIso: string,
): AdminCompleteResult {
  const existingStartedAt = optionalText(snapshot.route.started_at);
  const { startedAt, completedAt } = resolveAdminCompleteTimestamps(input, existingStartedAt, nowIso);
  const workReference = startedAt ?? completedAt;
  const stops = input.markAllDelivered
    ? snapshot.stops.map((stop, index) => markStopDeliveredHistorically(
      stop,
      workReference,
      interpolatedFallback(index, snapshot.stops.length, startedAt, completedAt),
      nowIso,
      startedAt ?? workReference,
    ))
    : snapshot.stops;

  const delivered = stops.filter((stop) => stop.delivery_status === 'delivered');
  const failed = stops.filter((stop) => stop.delivery_status === 'failed');
  const pending = stops.filter((stop) => stop.delivery_status !== 'delivered' && stop.delivery_status !== 'failed');
  let onTimeStops = 0;
  let lateStops = 0;
  for (const stop of delivered) {
    const punctuality = completionPunctuality({
      deliveredAt: optionalText(stop.delivered_at),
      deliveryTimeFrom: optionalText(stop.delivery_time_from),
      deliveryTimeTo: optionalText(stop.delivery_time_to),
      plannedArrivalAt: optionalText(stop.planned_arrival_at),
      latestEstimatedArrivalAt: optionalText(stop.latest_estimated_arrival_at),
    });
    if (punctuality === 'on_time') onTimeStops += 1;
    if (punctuality === 'late') lateStops += 1;
  }

  const actualDurationMinutes = startedAt
    ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 60_000))
    : null;
  const plannedDurationMinutes = nullableNumber(snapshot.route.estimated_duration_minutes);
  const summary = {
    totalStops: stops.length,
    deliveredStops: delivered.length,
    failedStops: failed.length,
    unmarkedStops: pending.length,
    deliveredKnownWeightKg: delivered.reduce((sum, stop) => sum + finiteNumber(stop.weight_kg, 0), 0),
    undeliveredKnownWeightKg: [...failed, ...pending].reduce((sum, stop) => sum + finiteNumber(stop.weight_kg, 0), 0),
    unknownWeightStops: stops.filter((stop) => stop.weight_kg == null).length,
    plannedDistanceKm: nullableNumber(snapshot.route.estimated_distance_km),
    actualDistanceKm: nullableNumber(snapshot.route.actual_distance_km),
    onTimeStops,
    lateStops,
    plannedDurationMinutes,
    actualDurationMinutes,
    durationDeviationMinutes:
      plannedDurationMinutes === null || actualDurationMinutes === null
        ? null
        : actualDurationMinutes - plannedDurationMinutes,
    distanceDeviationKm: null,
  };

  return {
    route: {
      ...snapshot.route,
      status: 'completed',
      remaining_stops: 0,
      remaining_weight_kg: 0,
      remaining_unknown_weight_stops: 0,
      ...(startedAt ? { started_at: startedAt } : {}),
      completed_at: completedAt,
      updated_at: nowIso,
      completion_summary_json: JSON.stringify(summary),
    },
    stops,
    summary,
    progress: {
      routeStatus: 'completed',
      totalStops: finiteNumber(snapshot.route.total_stops, stops.length),
      remainingStops: 0,
      remainingWeightKg: 0,
      lastSyncedAt: nowIso,
    },
    startedAt,
    completedAt,
    updatedAt: nowIso,
  };
}

function markStopDeliveredHistorically(
  stop: Record<string, unknown>,
  workReferenceIso: string,
  fallbackIso: string,
  nowIso: string,
  loadedAtFallback: string,
): Record<string, unknown> {
  if (stop.delivery_status === 'delivered' && optionalText(stop.delivered_at)) {
    return stop;
  }
  const deliveredAt = historicalStopDeliveredAt(stop, workReferenceIso, fallbackIso);
  return {
    ...stop,
    delivery_status: 'delivered',
    delivered_at: deliveredAt,
    failed_at: null,
    failure_reason: null,
    failure_comment: null,
    loading_status: 'loaded',
    loaded_at: optionalText(stop.loaded_at) ?? loadedAtFallback,
    updated_at: nowIso,
  };
}

function interpolatedFallback(
  index: number,
  total: number,
  startedAt: string | null,
  completedAt: string,
): string {
  const startMs = Date.parse(startedAt ?? completedAt);
  const endMs = Date.parse(completedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || total <= 0) return completedAt;
  if (total === 1 || endMs <= startMs) return new Date(startMs).toISOString();
  const t = (index + 1) / (total + 1);
  return new Date(Math.round(startMs + (endMs - startMs) * t)).toISOString();
}

function parseCompleteTimestamp(value: string): string {
  try {
    return isoDateOrThrow(value);
  } catch {
    throw new HistoricalCompleteError('INVALID_COMPLETE_TIME', 'Neteisingas pradžios arba užbaigimo laikas.');
  }
}

function clockValue(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  if (/^\d{1,2}:\d{2}$/.test(text)) return text;
  if (!Number.isFinite(Date.parse(text))) return null;
  const parts = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Vilnius',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(text)).map((part) => [part.type, part.value]),
  );
  const hour = parts.get('hour');
  const minute = parts.get('minute');
  return hour && minute ? `${hour}:${minute}` : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return value !== null && value !== '' && Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return nullableNumber(value) ?? fallback;
}
