import { lithuanianDateKey, lithuanianDateTimeToIso } from '@/domain/lithuanian-time';
import { calculateRouteMetrics } from '@/domain/metrics';

export type WorkQualityStop = {
  status: 'pending' | 'delivered' | 'failed';
  deliveredAt: string | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  weightKg?: number | null;
};

export type StopPunctuality = 'on_time' | 'late' | 'unscored';

export type OperationsRoute = {
  totalWeightKg?: number | null;
  stops: readonly WorkQualityStop[];
};

export type OperationsSummary = {
  routeCount: number;
  stopCount: number;
  /** Null when a stop weight is missing and the route total must not be guessed into the sum. */
  cargoWeightKg: number | null;
  deliveredStops: number;
  /** Null when a delivered stop has no weight. Failed and pending kilograms are never included. */
  deliveredWeightKg: number | null;
  /** Null when a still-pending stop has no weight. */
  remainingWeightKg: number | null;
  pendingStops: number;
  failedStops: number;
  onTimeStops: number;
  lateStops: number;
  scoredStops: number;
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * Punctuality uses the "Pristatyta" timestamp and the stop deadline only.
 * A window's end is the deadline. Early is on time. No grace period.
 * Route completion time is not an input.
 */
export function stopPunctuality(stop: WorkQualityStop): StopPunctuality {
  if (stop.status !== 'delivered' || !stop.deliveredAt) return 'unscored';
  const deliveredMs = Date.parse(stop.deliveredAt);
  const deadlineMs = punctualityDeadlineMs(stop.deliveredAt, stop.deliveryTimeFrom, stop.deliveryTimeTo);
  if (!Number.isFinite(deliveredMs) || deadlineMs === null) return 'unscored';
  const lateMinutes = Math.round((deliveredMs - deadlineMs) / 60_000);
  return lateMinutes > 0 ? 'late' : 'on_time';
}

export function minutesAfterDeadline(stop: WorkQualityStop): number | null {
  if (stop.status !== 'delivered' || !stop.deliveredAt) return null;
  const deliveredMs = Date.parse(stop.deliveredAt);
  const deadlineMs = punctualityDeadlineMs(stop.deliveredAt, stop.deliveryTimeFrom, stop.deliveryTimeTo);
  if (!Number.isFinite(deliveredMs) || deadlineMs === null) return null;
  return Math.round((deliveredMs - deadlineMs) / 60_000);
}

export function summarizeOperations(routes: readonly OperationsRoute[]): OperationsSummary {
  const stops = routes.flatMap((route) => route.stops);
  let cargoWeightKg = 0;
  let deliveredWeightKg = 0;
  let remainingWeightKg = 0;
  let cargoKnown = true;
  let deliveredKnown = true;
  let remainingKnown = true;
  let onTimeStops = 0;
  let lateStops = 0;
  let deliveredStops = 0;
  let pendingStops = 0;
  let failedStops = 0;

  for (const route of routes) {
    const weight = routeWeight(route);
    if (weight.cargoWeightKg === null) cargoKnown = false;
    else cargoWeightKg += weight.cargoWeightKg;
    if (weight.deliveredWeightKg === null) deliveredKnown = false;
    else deliveredWeightKg += weight.deliveredWeightKg;
    if (weight.remainingWeightKg === null) remainingKnown = false;
    else remainingWeightKg += weight.remainingWeightKg;
  }

  for (const stop of stops) {
    if (stop.status === 'delivered') deliveredStops += 1;
    else if (stop.status === 'failed') failedStops += 1;
    else pendingStops += 1;
    const punctuality = stopPunctuality(stop);
    if (punctuality === 'on_time') onTimeStops += 1;
    if (punctuality === 'late') lateStops += 1;
  }

  return {
    routeCount: routes.length,
    stopCount: stops.length,
    cargoWeightKg: cargoKnown ? cargoWeightKg : null,
    deliveredStops,
    deliveredWeightKg: deliveredKnown ? deliveredWeightKg : null,
    remainingWeightKg: remainingKnown ? remainingWeightKg : null,
    pendingStops,
    failedStops,
    onTimeStops,
    lateStops,
    scoredStops: onTimeStops + lateStops,
  };
}

/**
 * Same split the driver phone uses in calculateRouteMetrics / GetRouteProgress:
 * delivered kilograms are only stops marked delivered, remaining kilograms are
 * only stops still pending. A missing stop weight is a gap, not a share of the
 * route total. Each stop is counted once.
 */
function routeWeight(route: OperationsRoute): {
  cargoWeightKg: number | null;
  deliveredWeightKg: number | null;
  remainingWeightKg: number | null;
} {
  if (route.stops.length > 0 && route.stops.every((stop) => knownStopWeight(stop.weightKg) !== null)) {
    const metrics = calculateRouteMetrics(route.stops.map((stop) => ({
      deliveryStatus: stop.status,
      weightKg: knownStopWeight(stop.weightKg) ?? 0,
    })));
    return {
      cargoWeightKg: metrics.totalWeightKg,
      deliveredWeightKg: metrics.deliveredWeightKg,
      remainingWeightKg: metrics.remainingWeightKg,
    };
  }

  let knownCargo = 0;
  let delivered = 0;
  let remaining = 0;
  let anyKnown = false;
  let missingDelivered = false;
  let missingPending = false;
  let missingFailed = false;
  for (const stop of route.stops) {
    const weight = knownStopWeight(stop.weightKg);
    if (weight === null) {
      if (stop.status === 'delivered') missingDelivered = true;
      else if (stop.status === 'pending') missingPending = true;
      else missingFailed = true;
      continue;
    }
    anyKnown = true;
    knownCargo += weight;
    if (stop.status === 'delivered') delivered += weight;
    else if (stop.status === 'pending') remaining += weight;
  }

  if (!anyKnown) {
    const routeCargo = finiteWeight(route.totalWeightKg);
    const untouched = route.stops.every((stop) => stop.status === 'pending');
    return {
      cargoWeightKg: routeCargo,
      deliveredWeightKg: missingDelivered ? null : 0,
      remainingWeightKg: untouched ? routeCargo : (missingPending ? null : 0),
    };
  }

  return {
    cargoWeightKg: missingDelivered || missingPending || missingFailed ? null : knownCargo,
    deliveredWeightKg: missingDelivered ? null : delivered,
    remainingWeightKg: missingPending ? null : remaining,
  };
}

/** Null when the denominator is empty, so the screen can say there is no data. */
export function sharePercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

export function formatShare(part: number, whole: number): string {
  const percent = sharePercent(part, whole);
  if (percent === null) return 'Nėra duomenų';
  return `${formatCount(part)} / ${formatCount(whole)} (${percent} %)`;
}

export function lateDeliveredStops<T extends WorkQualityStop>(stops: readonly T[]): T[] {
  return stops.filter((stop) => stopPunctuality(stop) === 'late');
}

function punctualityDeadlineMs(
  deliveredAt: string,
  deliveryTimeFrom: string | null,
  deliveryTimeTo: string | null,
): number | null {
  const endClock = clockOf(deliveryTimeTo) ?? clockOf(deliveryTimeFrom);
  if (!endClock) return null;
  const day = lithuanianDateKey(deliveredAt);
  if (!day) return null;
  const startClock = clockOf(deliveryTimeFrom);
  const endMinutes = clockMinutes(endClock);
  const startMinutes = startClock ? clockMinutes(startClock) : null;
  let deadlineDay = day;
  if (deliveryTimeTo && startMinutes !== null && endMinutes !== null && startMinutes > endMinutes) {
    const deliveredMinutes = vilniusMinutes(deliveredAt);
    if (deliveredMinutes === null) return null;
    if (deliveredMinutes > endMinutes) deadlineDay = addDays(day, 1);
  }
  const iso = lithuanianDateTimeToIso(deadlineDay, endClock);
  return iso === null ? null : Date.parse(iso);
}

function vilniusMinutes(iso: string): number | null {
  const ms = Date.parse(iso);
  const day = lithuanianDateKey(iso);
  if (!day || !Number.isFinite(ms)) return null;
  const start = lithuanianDateTimeToIso(day, '00:00');
  if (!start) return null;
  const minutes = Math.round((ms - Date.parse(start)) / 60_000);
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function addDays(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const stamp = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return stamp.toISOString().slice(0, 10);
}

function clockOf(value: string | null): string | null {
  if (!value) return null;
  const match = /(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockMinutes(clock: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function knownStopWeight(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function finiteWeight(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 }).format(value);
}
