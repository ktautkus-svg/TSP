import type { SQLiteDatabase } from 'expo-sqlite';

import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import type { CandidateLeg, CandidateStopSchedule } from '@/domain/routing/models';

export type EtaScheduleState = 'on_time' | 'late' | 'early' | 'unavailable';

export function etaScheduleState(stop: DeliveryStop): { state: EtaScheduleState; differenceMinutes: number | null } {
  if (!stop.plannedArrivalAt || !stop.latestEstimatedArrivalAt) {
    return { state: 'unavailable', differenceMinutes: null };
  }
  const differenceMinutes = Math.round(
    (Date.parse(stop.latestEstimatedArrivalAt) - Date.parse(stop.plannedArrivalAt)) / 60_000,
  );
  if (Math.abs(differenceMinutes) <= 5) return { state: 'on_time', differenceMinutes };
  return { state: differenceMinutes > 0 ? 'late' : 'early', differenceMinutes };
}

export function nextPendingStop(stops: DeliveryStop[]): DeliveryStop | null {
  return stops.find((stop) => stop.deliveryStatus === 'pending') ?? null;
}

export async function persistCandidateEtas(
  db: SQLiteDatabase,
  routeId: string,
  schedules: CandidateStopSchedule[],
  legs: CandidateLeg[],
  options: { setOriginalPlan: boolean; updatedAt: string; approximate: boolean },
): Promise<void> {
  const schedulesByStop = new Map(schedules.map((schedule) => [schedule.stopId, schedule]));
  const legsByStop = new Map(legs.map((leg) => [leg.toId, leg]));
  for (const [stopId, schedule] of schedulesByStop) {
    const leg = legsByStop.get(stopId);
    if (options.setOriginalPlan) {
      await db.runAsync(
        `UPDATE delivery_stops SET planned_arrival_at = ?, planned_departure_at = ?,
         latest_estimated_arrival_at = ?, leg_distance_km = ?, leg_duration_minutes = ?,
         eta_updated_at = ?, eta_approximate = ?, updated_at = ?
         WHERE route_id = ? AND id = ?`,
        schedule.arrivalAt,
        schedule.departureAt,
        schedule.arrivalAt,
        leg?.distanceKm ?? null,
        leg?.durationMinutes ?? null,
        options.updatedAt,
        options.approximate ? 1 : 0,
        options.updatedAt,
        routeId,
        stopId,
      );
    } else {
      await db.runAsync(
        `UPDATE delivery_stops SET latest_estimated_arrival_at = ?, leg_distance_km = ?,
         leg_duration_minutes = ?, eta_updated_at = ?, eta_approximate = ?, updated_at = ?
         WHERE route_id = ? AND id = ?`,
        schedule.arrivalAt,
        leg?.distanceKm ?? null,
        leg?.durationMinutes ?? null,
        options.updatedAt,
        options.approximate ? 1 : 0,
        options.updatedAt,
        routeId,
        stopId,
      );
    }
  }
}

/**
 * Recalculates remaining ETAs without a network call. Persisted leg durations
 * are deliberately used so losing gateway access never blocks the workday.
 */
export class RefreshRouteEtas {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly clock = () => new Date().toISOString(),
  ) {}

  async execute(routeId: string): Promise<{ updated: number; approximate: boolean }> {
    const repository = new RouteRepository(this.db);
    const persisted = await repository.getWithStops(routeId);
    if (!persisted || persisted.route.status !== 'in_progress') return { updated: 0, approximate: false };

    const now = this.clock();
    const updates = calculateRemainingEtas(persisted.route, persisted.stops, now);
    // ETA values are a reproducible local projection, not the authoritative
    // delivery state. Keeping this refresh outside a broad transaction avoids
    // overlapping Expo SQLite web transactions when focus/interval refreshes
    // meet a delivery action. A partial refresh is safely recomputed on the
    // next load, while delivery commands retain their atomic transactions.
    for (const update of updates) {
      await this.db.runAsync(
        `UPDATE delivery_stops SET latest_estimated_arrival_at = ?, eta_updated_at = ?,
         eta_approximate = 1, updated_at = ? WHERE route_id = ? AND id = ?`,
        update.arrivalAt,
        now,
        now,
        routeId,
        update.stopId,
      );
    }
    return { updated: updates.length, approximate: updates.length > 0 };
  }
}

export function calculateRemainingEtas(
  route: Pick<Route, 'planningMode'>,
  stops: DeliveryStop[],
  currentTime: string,
): Array<{ stopId: string; arrivalAt: string }> {
  let cursor = Date.parse(currentTime);
  if (!Number.isFinite(cursor)) throw new Error('Dabartinis laikas netinkamas ETA skaičiavimui.');

  return stops
    .filter((stop) => stop.deliveryStatus === 'pending')
    .sort((left, right) => orderOf(left) - orderOf(right))
    .map((stop) => {
      cursor += Math.max(0, stop.legDurationMinutes ?? 0) * 60_000;
      const arrivalAt = new Date(cursor).toISOString();
      if (route.planningMode === 'with_time_windows' && stop.deliveryTimeFrom) {
        cursor = Math.max(cursor, timeOnSameWorkday(stop.deliveryTimeFrom, currentTime));
      }
      cursor += Math.max(0, stop.serviceDurationMinutes) * 60_000;
      return { stopId: stop.id, arrivalAt };
    });
}

function orderOf(stop: DeliveryStop): number {
  return stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder;
}

function timeOnSameWorkday(value: string, reference: string): number {
  const result = new Date(reference);
  const [hours, minutes] = value.split(':').map(Number);
  result.setHours(hours, minutes, 0, 0);
  return result.getTime();
}
