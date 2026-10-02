import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * How long the driver spent loading — from pressing "Pradėti krovimą"
 * (journalled as `route_activated_for_loading`) until the route actually
 * started (`routes.started_at`, set when the morning odometer is entered).
 *
 * Uses the action journal so no schema column is needed. Returns null when
 * either end of the interval is missing (older routes, loading not started
 * through this app).
 */
export async function routeLoadingMinutes(db: SQLiteDatabase, routeId: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ started_at: string | null; loading_at: string | null }>(
    `SELECT r.started_at AS started_at,
            (SELECT MIN(j.created_at) FROM action_journal j
             WHERE j.route_id = r.id AND j.action_type = 'route_activated_for_loading') AS loading_at
     FROM routes r WHERE r.id = ?`,
    routeId,
  );
  return loadingMinutesBetween(row?.loading_at ?? null, row?.started_at ?? null);
}

export function loadingMinutesBetween(loadingStartedAt: string | null, routeStartedAt: string | null): number | null {
  if (!loadingStartedAt || !routeStartedAt) return null;
  const startMs = Date.parse(loadingStartedAt);
  const endMs = Date.parse(routeStartedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const minutes = Math.round((endMs - startMs) / 60_000);
  // A day-plus gap means the route sat overnight between loading and start —
  // not a real loading duration.
  return minutes > 12 * 60 ? null : minutes;
}

export type LoadingHistorySample = { minutes: number; weightKg: number; stops: number };

/**
 * Past loadings usable for a preliminary estimate: completed routes that have
 * both a `route_activated_for_loading` journal entry and a `started_at`, with
 * their recorded weight and stop count.
 */
export async function loadingHistorySamples(db: SQLiteDatabase, limit = 40): Promise<LoadingHistorySample[]> {
  const rows = await db.getAllAsync<{
    started_at: string | null;
    loading_at: string | null;
    total_weight_kg: number | null;
    total_stops: number | null;
  }>(
    `SELECT r.started_at AS started_at,
            r.total_weight_kg AS total_weight_kg,
            r.total_stops AS total_stops,
            (SELECT MIN(j.created_at) FROM action_journal j
             WHERE j.route_id = r.id AND j.action_type = 'route_activated_for_loading') AS loading_at
     FROM routes r
     WHERE r.status = 'completed' AND r.started_at IS NOT NULL
     ORDER BY r.started_at DESC
     LIMIT ?`,
    limit,
  );
  const samples: LoadingHistorySample[] = [];
  for (const row of rows) {
    const minutes = loadingMinutesBetween(row.loading_at ?? null, row.started_at ?? null);
    if (minutes === null) continue;
    samples.push({
      minutes,
      weightKg: row.total_weight_kg ?? 0,
      stops: row.total_stops ?? 0,
    });
  }
  return samples;
}

/**
 * Preliminary loading-time estimate for a new route, from past loadings of a
 * similar size. Weighs samples by how close their weight and stop count are;
 * falls back to the plain average, then to a 10 min/·+2 min/stop rule.
 */
export function estimateLoadingMinutes(
  history: readonly LoadingHistorySample[],
  weightKg: number,
  stops: number,
): number {
  const clean = history.filter((sample) => sample.minutes > 0 && sample.minutes <= 12 * 60);
  if (clean.length === 0) {
    return Math.max(10, Math.round(10 + stops * 2 + weightKg / 400));
  }
  let weightedSum = 0;
  let weightTotal = 0;
  for (const sample of clean) {
    const weightGap = Math.abs(sample.weightKg - weightKg) / Math.max(200, weightKg || 200);
    const stopGap = Math.abs(sample.stops - stops) / Math.max(3, stops || 3);
    const similarity = 1 / (1 + weightGap + stopGap);
    weightedSum += sample.minutes * similarity;
    weightTotal += similarity;
  }
  return Math.max(5, Math.round(weightedSum / weightTotal));
}
