import type { RouteCompletionSummary } from '@/domain/route';

export type StatsRouteRow = {
  routeId?: string | null;
  routeLabel?: string | null;
  driverName?: string | null;
  vehicleRegistration?: string | null;
  startAddress?: string | null;
  endAddress?: string | null;
  date: string;
  status: string;
  estimatedDistanceKm: number | null;
  actualDistanceKm: number | null;
  totalStops: number;
  startedAt: string | null;
  completedAt: string | null;
  completionSummary: RouteCompletionSummary | null;
  /**
   * The van's stated payload capacity for this route, when known. Only the
   * server's assignment data carries it (a vehicle join); the local SQLite
   * path — a driver's own device history — has no vehicle table to join
   * against, so this stays null there and the weight tab says so rather than
   * guessing a capacity.
   */
  vehicleMaxPayloadKg?: number | null;
};

export type FailureReasonCount = { reason: string; count: number };

export type StatsLateDelivery = {
  routeId: string;
  date: string;
  routeLabel: string;
  driverId: string | null;
  driverName: string | null;
  vehicleRegistration: string | null;
  stopId: string;
  address: string;
  deliveredAt: string;
  deadlineAt: string;
  delayMinutes: number;
};

export const PERIOD_PRESETS = ['today', 'week', 'month', 'year', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export type StatsPeriod = {
  /** Inclusive UTC date keys (YYYY-MM-DD), matching how route dates are stored. */
  fromKey: string;
  toKey: string;
};

/**
 * One bucket of a chart series. Every field is populated regardless of which
 * tab is asking, so a single series powers all five tabs' charts and "best
 * day" records — the caller just picks the field it cares about.
 */
export type StatsPoint = {
  key: string;
  km: number;
  kmIsActual: boolean;
  stops: number;
  deliveredStops: number;
  weightKg: number;
  onTimeStops: number;
  lateStops: number;
};

export type StatsSeries = {
  granularity: 'day' | 'month';
  points: StatsPoint[];
};

/**
 * The chart for a multi-month period would be 200+ daily bars, which is not
 * readable on a phone, so the series switches to monthly bars past this many
 * days. A week or a month always renders as days; the year preset (and any
 * longer custom range) renders as months.
 */
const DAILY_SERIES_MAX_DAYS = 62;

export type PeriodMetrics = {
  period: StatsPeriod;
  dayCount: number;

  routeCount: number;
  completedRouteCount: number;
  cancelledRouteCount: number;

  // Kilometrai
  totalKm: number;
  totalKmSource: 'actual' | 'mixed' | 'estimated' | 'none';
  averageKmPerDay: number | null;
  averageKmPerStop: number | null;
  averageKmPerRoute: number | null;

  // Taškai
  totalStops: number;
  deliveredStops: number;
  failedStops: number;
  unmarkedStops: number;
  failureReasons: FailureReasonCount[];
  averageStopsPerRoute: number | null;
  averageStopsPerDay: number | null;

  // Svoris
  totalWeightKg: number;
  averageWeightKgPerRoute: number | null;
  averageWeightKgPerStop: number | null;
  /** null when no route in the period carried a known vehicle capacity. */
  averageLoadPercent: number | null;

  // Kokybė
  onTimeStops: number;
  lateStops: number;
  /** Share of stops with a known outcome that were on time; null with no evaluated stops. */
  onTimeWindowPercent: number | null;
  /** Routes with at least one late stop vs. routes where every evaluated stop was on time. */
  routesWithLateStop: number;
  routesFullyOnTime: number;
  plannedKm: number;
  actualKmForQuality: number;
  plannedDurationMinutes: number;
  actualDurationMinutes: number;
  averageRouteDurationMinutes: number | null;
};

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toMonthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Monday of the current week, in UTC.
 *
 * Route dates are stored as UTC date keys (route-commands.ts writes
 * now.slice(0, 10) of an ISO timestamp), and toDateKey reads them back the same
 * way. Walking the week in local time and handing the result to a UTC
 * toDateKey used to shift "this week" a day early for any timezone ahead of
 * UTC — Lithuania is +2/+3 — so this stays in UTC end to end, matching what is
 * actually stored.
 */
function startOfIsoWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diffToMonday);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00.000Z`);
  const to = Date.parse(`${toKey}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000) + 1;
}

/** The requested preset as an inclusive [fromKey, toKey] range ending today. */
export function periodForPreset(preset: PeriodPreset, now: Date, custom?: StatsPeriod): StatsPeriod {
  const todayKey = toDateKey(now);
  switch (preset) {
    case 'today':
      return { fromKey: todayKey, toKey: todayKey };
    case 'week':
      return { fromKey: toDateKey(startOfIsoWeek(now)), toKey: todayKey };
    case 'month':
      return { fromKey: `${toMonthKey(todayKey)}-01`, toKey: todayKey };
    case 'year':
      return { fromKey: toDateKey(addDays(now, -364)), toKey: todayKey };
    case 'custom':
      if (!custom) throw new Error('Pasirinktam laikotarpiui reikia datų.');
      return custom.fromKey <= custom.toKey ? custom : { fromKey: custom.toKey, toKey: custom.fromKey };
    default:
      return { fromKey: todayKey, toKey: todayKey };
  }
}

/**
 * The same-length window immediately before `period`, for the "+12% vs
 * previous period" comparison. A 7-day period compares against the 7 days
 * before it; a calendar month compares against the same number of days
 * before its start, not the previous calendar month, so the two spans are
 * always exactly comparable in length.
 */
export function previousPeriod(period: StatsPeriod): StatsPeriod {
  const length = daysBetween(period.fromKey, period.toKey);
  const from = addDays(new Date(`${period.fromKey}T00:00:00.000Z`), -length);
  const to = addDays(new Date(`${period.fromKey}T00:00:00.000Z`), -1);
  return { fromKey: toDateKey(from), toKey: toDateKey(to) };
}

/** null when there is nothing to compare against, so the UI can say "—" instead of a false 0%. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function routeKm(row: StatsRouteRow): { km: number | null; isActual: boolean } {
  if (row.actualDistanceKm !== null) return { km: row.actualDistanceKm, isActual: true };
  if (row.estimatedDistanceKm !== null) return { km: row.estimatedDistanceKm, isActual: false };
  return { km: null, isActual: false };
}

/** Delivered plus undelivered known weight, i.e. everything that was actually loaded. */
function routeWeightKg(row: StatsRouteRow): number {
  const summary = row.completionSummary;
  return summary ? summary.deliveredKnownWeightKg + summary.undeliveredKnownWeightKg : 0;
}

function inRange(row: StatsRouteRow, period: StatsPeriod): boolean {
  return row.date >= period.fromKey && row.date <= period.toKey;
}

export function computePeriodMetrics(
  rows: StatsRouteRow[],
  failureCounts: FailureReasonCount[],
  period: StatsPeriod,
): PeriodMetrics {
  const inWindow = rows.filter((row) => inRange(row, period));
  const dayCount = daysBetween(period.fromKey, period.toKey);

  let routeCount = 0;
  let completedRouteCount = 0;
  let cancelledRouteCount = 0;
  let totalKm = 0;
  let sawActualKm = false;
  let sawEstimatedKm = false;
  let totalStops = 0;
  let deliveredStops = 0;
  let failedStops = 0;
  let unmarkedStops = 0;
  let totalWeightKg = 0;
  let loadPercentSum = 0;
  let loadPercentCount = 0;
  let onTimeStops = 0;
  let lateStops = 0;
  let routesWithLateStop = 0;
  let routesFullyOnTime = 0;
  let plannedKm = 0;
  let actualKmForQuality = 0;
  let plannedDurationMinutes = 0;
  let actualDurationMinutes = 0;
  let durationSampleMinutes = 0;
  let durationSampleCount = 0;

  for (const row of inWindow) {
    routeCount += 1;
    if (row.status === 'completed') completedRouteCount += 1;
    if (row.status === 'cancelled') cancelledRouteCount += 1;

    const { km, isActual } = routeKm(row);
    if (km !== null) {
      totalKm += km;
      if (isActual) sawActualKm = true;
      else sawEstimatedKm = true;
    }
    totalStops += row.totalStops;

    const summary = row.completionSummary;
    if (summary) {
      deliveredStops += summary.deliveredStops;
      failedStops += summary.failedStops;
      unmarkedStops += summary.unmarkedStops;
      onTimeStops += summary.onTimeStops;
      lateStops += summary.lateStops;
      if (summary.onTimeStops + summary.lateStops > 0) {
        if (summary.lateStops > 0) routesWithLateStop += 1;
        else routesFullyOnTime += 1;
      }
      if (summary.plannedDistanceKm !== null) plannedKm += summary.plannedDistanceKm;
      if (summary.actualDistanceKm !== null) actualKmForQuality += summary.actualDistanceKm;
      if (summary.plannedDurationMinutes !== null) plannedDurationMinutes += summary.plannedDurationMinutes;
      if (summary.actualDurationMinutes !== null) actualDurationMinutes += summary.actualDurationMinutes;
    }

    const weightKg = routeWeightKg(row);
    totalWeightKg += weightKg;
    if (row.vehicleMaxPayloadKg !== null && row.vehicleMaxPayloadKg !== undefined && row.vehicleMaxPayloadKg > 0) {
      loadPercentSum += (weightKg / row.vehicleMaxPayloadKg) * 100;
      loadPercentCount += 1;
    }

    if (row.status === 'completed' && row.startedAt !== null && row.completedAt !== null) {
      const minutes = (Date.parse(row.completedAt) - Date.parse(row.startedAt)) / 60_000;
      if (Number.isFinite(minutes)) {
        durationSampleMinutes += minutes;
        durationSampleCount += 1;
      }
    }
  }

  const totalKmSource: PeriodMetrics['totalKmSource'] = sawActualKm && sawEstimatedKm
    ? 'mixed'
    : sawActualKm ? 'actual' : sawEstimatedKm ? 'estimated' : 'none';

  // Failure counts are not date-scoped at the source (the SQL query behind
  // them returns one aggregate count per reason, not per route), so they are
  // shown as-is for whatever range the caller already filtered them to,
  // rather than pretending to filter them again here.
  const failureReasons = [...failureCounts].sort((a, b) => b.count - a.count);

  return {
    period,
    dayCount,
    routeCount,
    completedRouteCount,
    cancelledRouteCount,
    totalKm,
    totalKmSource,
    averageKmPerDay: dayCount === 0 ? null : totalKm / dayCount,
    averageKmPerStop: totalStops === 0 ? null : totalKm / totalStops,
    averageKmPerRoute: routeCount === 0 ? null : totalKm / routeCount,
    totalStops,
    deliveredStops,
    failedStops,
    unmarkedStops,
    failureReasons,
    averageStopsPerRoute: routeCount === 0 ? null : totalStops / routeCount,
    averageStopsPerDay: dayCount === 0 ? null : totalStops / dayCount,
    totalWeightKg,
    averageWeightKgPerRoute: routeCount === 0 ? null : totalWeightKg / routeCount,
    averageWeightKgPerStop: totalStops === 0 ? null : totalWeightKg / totalStops,
    averageLoadPercent: loadPercentCount === 0 ? null : loadPercentSum / loadPercentCount,
    onTimeStops,
    lateStops,
    onTimeWindowPercent: onTimeStops + lateStops === 0 ? null : (onTimeStops / (onTimeStops + lateStops)) * 100,
    routesWithLateStop,
    routesFullyOnTime,
    plannedKm,
    actualKmForQuality,
    plannedDurationMinutes,
    actualDurationMinutes,
    averageRouteDurationMinutes: durationSampleCount === 0 ? null : durationSampleMinutes / durationSampleCount,
  };
}

/**
 * The chart series for a period, at the granularity that stays readable: days
 * up to DAILY_SERIES_MAX_DAYS, months beyond that (the year preset and any
 * long custom range). Every point carries every metric, so one series powers
 * every tab's chart and "best day" record.
 */
export function buildStatsSeries(rows: StatsRouteRow[], period: StatsPeriod): StatsSeries {
  const dayCount = daysBetween(period.fromKey, period.toKey);
  const inWindow = rows.filter((row) => inRange(row, period));
  const granularity: StatsSeries['granularity'] = dayCount <= DAILY_SERIES_MAX_DAYS ? 'day' : 'month';
  const keyOf = (dateKey: string) => (granularity === 'day' ? dateKey : toMonthKey(dateKey));

  const buckets = new Map<string, StatsPoint>();
  const emptyPoint = (key: string): StatsPoint => ({
    key, km: 0, kmIsActual: true, stops: 0, deliveredStops: 0, weightKg: 0, onTimeStops: 0, lateStops: 0,
  });

  for (const row of inWindow) {
    const key = keyOf(row.date);
    const point = buckets.get(key) ?? emptyPoint(key);
    const { km, isActual } = routeKm(row);
    if (km !== null) {
      point.km += km;
      if (!isActual) point.kmIsActual = false;
    }
    point.stops += row.totalStops;
    point.weightKg += routeWeightKg(row);
    const summary = row.completionSummary;
    if (summary) {
      point.deliveredStops += summary.deliveredStops;
      point.onTimeStops += summary.onTimeStops;
      point.lateStops += summary.lateStops;
    }
    buckets.set(key, point);
  }

  const points: StatsPoint[] = [];
  if (granularity === 'day') {
    for (let offset = 0; offset < dayCount; offset += 1) {
      const key = toDateKey(addDays(new Date(`${period.fromKey}T00:00:00.000Z`), offset));
      points.push(buckets.get(key) ?? emptyPoint(key));
    }
  } else {
    const monthCount = Math.ceil(dayCount / 28) + 1;
    const cursorStart = new Date(`${toMonthKey(period.fromKey)}-01T00:00:00.000Z`);
    for (let offset = 0; offset < monthCount; offset += 1) {
      const cursor = new Date(cursorStart);
      cursor.setUTCMonth(cursor.getUTCMonth() + offset);
      const key = toMonthKey(toDateKey(cursor));
      if (key > toMonthKey(period.toKey)) break;
      points.push(buckets.get(key) ?? emptyPoint(key));
    }
  }
  return { granularity, points };
}

/** The point with the highest value for `metric`, ignoring zero/empty points; null if none qualify. */
export function bestPoint(points: StatsPoint[], metric: (point: StatsPoint) => number): StatsPoint | null {
  return points.reduce<StatsPoint | null>((best, point) => {
    const value = metric(point);
    if (value <= 0) return best;
    if (!best || value > metric(best)) return point;
    return best;
  }, null);
}

// ---------------------------------------------------------------------------
// Atlygis (earnings)
//
// Compensation is a per-driver-per-day figure (attachDailyCompensation on the
// server), not a per-route one, so it lives outside StatsRouteRow entirely and
// is summed from trip sheets by the caller — see
// src/application/statistics/earnings.ts for the ServerTripSheet -> EarningsRow
// transform, which also handles the one real trap here: several routes on the
// same day share the SAME compensation figure, so summing per sheet would
// double it.
// ---------------------------------------------------------------------------

export type EarningsRow = { date: string; totalNetEur: number };

export type EarningsMetrics = {
  totalEur: number;
  series: { granularity: 'day' | 'month'; points: { key: string; eur: number }[] };
  bestDay: { key: string; eur: number } | null;
};

export function computeEarningsMetrics(rows: EarningsRow[], period: StatsPeriod): EarningsMetrics {
  const dayCount = daysBetween(period.fromKey, period.toKey);
  const inWindow = rows.filter((row) => row.date >= period.fromKey && row.date <= period.toKey);
  const granularity: EarningsMetrics['series']['granularity'] = dayCount <= DAILY_SERIES_MAX_DAYS ? 'day' : 'month';
  const keyOf = (dateKey: string) => (granularity === 'day' ? dateKey : toMonthKey(dateKey));

  const buckets = new Map<string, number>();
  let totalEur = 0;
  for (const row of inWindow) {
    totalEur += row.totalNetEur;
    const key = keyOf(row.date);
    buckets.set(key, (buckets.get(key) ?? 0) + row.totalNetEur);
  }

  const points: { key: string; eur: number }[] = [];
  if (granularity === 'day') {
    for (let offset = 0; offset < dayCount; offset += 1) {
      const key = toDateKey(addDays(new Date(`${period.fromKey}T00:00:00.000Z`), offset));
      points.push({ key, eur: buckets.get(key) ?? 0 });
    }
  } else {
    const monthCount = Math.ceil(dayCount / 28) + 1;
    const cursorStart = new Date(`${toMonthKey(period.fromKey)}-01T00:00:00.000Z`);
    for (let offset = 0; offset < monthCount; offset += 1) {
      const cursor = new Date(cursorStart);
      cursor.setUTCMonth(cursor.getUTCMonth() + offset);
      const key = toMonthKey(toDateKey(cursor));
      if (key > toMonthKey(period.toKey)) break;
      points.push({ key, eur: buckets.get(key) ?? 0 });
    }
  }

  const bestDay = points.reduce<{ key: string; eur: number } | null>((best, point) => {
    if (point.eur <= 0) return best;
    if (!best || point.eur > best.eur) return point;
    return best;
  }, null);

  return { totalEur, series: { granularity, points }, bestDay };
}
