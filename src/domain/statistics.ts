import type { RouteCompletionSummary } from '@/domain/route';

export type StatsRouteRow = {
  date: string;
  status: string;
  estimatedDistanceKm: number | null;
  actualDistanceKm: number | null;
  totalStops: number;
  startedAt: string | null;
  completedAt: string | null;
  completionSummary: RouteCompletionSummary | null;
};

export type StatisticsPeriodTotals = {
  routeCount: number;
  completedRouteCount: number;
  cancelledRouteCount: number;
  totalKm: number;
  totalKmSource: 'actual' | 'mixed' | 'estimated' | 'none';
  totalStops: number;
  deliveredStops: number;
  failedStops: number;
  unmarkedStops: number;
  totalDeliveredWeightKg: number;
};

export type DailyStat = {
  date: string;
  km: number;
  kmIsActual: boolean;
  stops: number;
  deliveredStops: number;
};

export type MonthlyStat = {
  month: string;
  km: number;
  routeCount: number;
  deliveredStops: number;
  failedStops: number;
};

export type FailureReasonCount = { reason: string; count: number };

export type StatisticsSnapshot = {
  windowStartDate: string;
  today: StatisticsPeriodTotals;
  thisWeek: StatisticsPeriodTotals;
  thisMonth: StatisticsPeriodTotals;
  allTime: StatisticsPeriodTotals;
  dailySeries: DailyStat[];
  monthlySeries: MonthlyStat[];
  failureReasons: FailureReasonCount[];
  bestDay: DailyStat | null;
  averageKmPerStop: number | null;
  averageStopsPerRoute: number | null;
  averageRouteDurationMinutes: number | null;
};

const DAILY_SERIES_DAYS = 30;
const MONTHLY_SERIES_MONTHS = 12;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toMonthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

/** Monday-based ISO week start for the date containing `date`. */
function startOfIsoWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function routeKm(row: StatsRouteRow): { km: number | null; isActual: boolean } {
  if (row.actualDistanceKm !== null) return { km: row.actualDistanceKm, isActual: true };
  if (row.estimatedDistanceKm !== null) return { km: row.estimatedDistanceKm, isActual: false };
  return { km: null, isActual: false };
}

function emptyTotals(): StatisticsPeriodTotals {
  return {
    routeCount: 0,
    completedRouteCount: 0,
    cancelledRouteCount: 0,
    totalKm: 0,
    totalKmSource: 'none',
    totalStops: 0,
    deliveredStops: 0,
    failedStops: 0,
    unmarkedStops: 0,
    totalDeliveredWeightKg: 0,
  };
}

function accumulateTotals(rows: StatsRouteRow[]): StatisticsPeriodTotals {
  const totals = emptyTotals();
  let sawActual = false;
  let sawEstimated = false;
  for (const row of rows) {
    totals.routeCount += 1;
    if (row.status === 'completed') totals.completedRouteCount += 1;
    if (row.status === 'cancelled') totals.cancelledRouteCount += 1;
    const { km, isActual } = routeKm(row);
    if (km !== null) {
      totals.totalKm += km;
      if (isActual) sawActual = true;
      else sawEstimated = true;
    }
    totals.totalStops += row.totalStops;
    const summary = row.completionSummary;
    if (summary) {
      totals.deliveredStops += summary.deliveredStops;
      totals.failedStops += summary.failedStops;
      totals.unmarkedStops += summary.unmarkedStops;
      totals.totalDeliveredWeightKg += summary.deliveredKnownWeightKg;
    }
  }
  totals.totalKmSource = sawActual && sawEstimated ? 'mixed' : sawActual ? 'actual' : sawEstimated ? 'estimated' : 'none';
  return totals;
}

export function buildStatisticsSnapshot(
  rows: StatsRouteRow[],
  failureCounts: FailureReasonCount[],
  now: Date = new Date(),
  windowDays = 365,
): StatisticsSnapshot {
  const windowStart = addDays(now, -windowDays);
  const windowStartDate = toDateKey(windowStart);
  const inWindow = rows.filter((row) => row.date >= windowStartDate);

  const todayKey = toDateKey(now);
  const weekStartKey = toDateKey(startOfIsoWeek(now));
  const monthStartKey = `${toMonthKey(todayKey)}-01`;

  const today = accumulateTotals(inWindow.filter((row) => row.date === todayKey));
  const thisWeek = accumulateTotals(inWindow.filter((row) => row.date >= weekStartKey));
  const thisMonth = accumulateTotals(inWindow.filter((row) => row.date >= monthStartKey));
  const allTime = accumulateTotals(inWindow);

  const dailyBuckets = new Map<string, { km: number; allActual: boolean; hasKm: boolean; stops: number; deliveredStops: number }>();
  const monthlyBuckets = new Map<string, { km: number; routeCount: number; deliveredStops: number; failedStops: number }>();
  for (const row of inWindow) {
    const { km, isActual } = routeKm(row);
    const dayBucket = dailyBuckets.get(row.date) ?? { km: 0, allActual: true, hasKm: false, stops: 0, deliveredStops: 0 };
    if (km !== null) {
      dayBucket.km += km;
      dayBucket.hasKm = true;
      if (!isActual) dayBucket.allActual = false;
    }
    dayBucket.stops += row.totalStops;
    dayBucket.deliveredStops += row.completionSummary?.deliveredStops ?? 0;
    dailyBuckets.set(row.date, dayBucket);

    const monthKey = toMonthKey(row.date);
    const monthBucket = monthlyBuckets.get(monthKey) ?? { km: 0, routeCount: 0, deliveredStops: 0, failedStops: 0 };
    if (km !== null) monthBucket.km += km;
    monthBucket.routeCount += 1;
    monthBucket.deliveredStops += row.completionSummary?.deliveredStops ?? 0;
    monthBucket.failedStops += row.completionSummary?.failedStops ?? 0;
    monthlyBuckets.set(monthKey, monthBucket);
  }

  const dailySeries: DailyStat[] = [];
  for (let offset = DAILY_SERIES_DAYS - 1; offset >= 0; offset -= 1) {
    const date = toDateKey(addDays(now, -offset));
    const bucket = dailyBuckets.get(date);
    dailySeries.push({
      date,
      km: bucket?.km ?? 0,
      kmIsActual: bucket?.allActual ?? true,
      stops: bucket?.stops ?? 0,
      deliveredStops: bucket?.deliveredStops ?? 0,
    });
  }

  const monthlySeries: MonthlyStat[] = [];
  for (let offset = MONTHLY_SERIES_MONTHS - 1; offset >= 0; offset -= 1) {
    const month = toMonthKey(toDateKey(addMonths(now, -offset)));
    const bucket = monthlyBuckets.get(month);
    monthlySeries.push({
      month,
      km: bucket?.km ?? 0,
      routeCount: bucket?.routeCount ?? 0,
      deliveredStops: bucket?.deliveredStops ?? 0,
      failedStops: bucket?.failedStops ?? 0,
    });
  }

  const failureReasons = [...failureCounts].sort((a, b) => b.count - a.count);

  const bestDay = dailySeries.reduce<DailyStat | null>((best, day) => {
    if (day.km <= 0) return best;
    if (!best || day.km > best.km) return day;
    return best;
  }, null);

  const routesWithDuration = inWindow.filter(
    (row) => row.status === 'completed' && row.startedAt !== null && row.completedAt !== null,
  );
  const averageRouteDurationMinutes = routesWithDuration.length === 0 ? null : (
    routesWithDuration.reduce((sum, row) => sum + (Date.parse(row.completedAt!) - Date.parse(row.startedAt!)) / 60_000, 0) /
    routesWithDuration.length
  );

  return {
    windowStartDate,
    today,
    thisWeek,
    thisMonth,
    allTime,
    dailySeries,
    monthlySeries,
    failureReasons,
    bestDay,
    averageKmPerStop: allTime.totalStops === 0 ? null : allTime.totalKm / allTime.totalStops,
    averageStopsPerRoute: allTime.routeCount === 0 ? null : allTime.totalStops / allTime.routeCount,
    averageRouteDurationMinutes,
  };
}
