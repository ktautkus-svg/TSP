import type { SQLiteDatabase } from 'expo-sqlite';

import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { lithuanianClockOnReferenceDay } from '@/domain/lithuanian-time';
import { haversineKm } from '@/domain/routing/evaluation/geo';
import type { CandidateLeg, CandidateStopSchedule } from '@/domain/routing/models';

export type EtaScheduleState = 'on_time' | 'late' | 'early' | 'unavailable';

const APPROXIMATE_ROAD_FACTOR = 1.18;
const APPROXIMATE_ROAD_SPEED_KMH = 65;

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
    const rebasedFirstLeg = estimateFirstPendingLeg(persisted.route, persisted.stops);
    const stops = rebasedFirstLeg
      ? persisted.stops.map((stop) => stop.id === rebasedFirstLeg.stopId
        ? { ...stop, legDistanceKm: rebasedFirstLeg.distanceKm, legDurationMinutes: rebasedFirstLeg.durationMinutes }
        : stop)
      : persisted.stops;
    const firstLegDepartureAt = latestResolvedAt(stops) ?? persisted.route.startedAt ?? now;
    const updates = calculateRemainingEtas(persisted.route, stops, now, firstLegDepartureAt);
    // ETA values are a reproducible local projection, not the authoritative
    // delivery state. Keeping this refresh outside a broad transaction avoids
    // overlapping Expo SQLite web transactions when focus/interval refreshes
    // meet a delivery action. A partial refresh is safely recomputed on the
    // next load, while delivery commands retain their atomic transactions.
    if (rebasedFirstLeg) {
      await this.db.runAsync(
        `UPDATE delivery_stops SET leg_distance_km = ?, leg_duration_minutes = ?,
         eta_approximate = 1, updated_at = ? WHERE route_id = ? AND id = ?`,
        rebasedFirstLeg.distanceKm,
        rebasedFirstLeg.durationMinutes,
        now,
        routeId,
        rebasedFirstLeg.stopId,
      );
    }
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
  firstLegDepartureAt: string = currentTime,
): { stopId: string; arrivalAt: string }[] {
  let cursor = Date.parse(firstLegDepartureAt);
  const now = Date.parse(currentTime);
  if (!Number.isFinite(cursor) || !Number.isFinite(now)) throw new Error('Dabartinis laikas netinkamas ETA skaičiavimui.');

  return stops
    .filter((stop) => stop.deliveryStatus === 'pending')
    .sort((left, right) => orderOf(left) - orderOf(right))
    .map((stop, index) => {
      cursor += Math.max(0, stop.legDurationMinutes ?? 0) * 60_000;
      if (index === 0) cursor = Math.max(cursor, now);
      const arrivalAt = new Date(cursor).toISOString();
      if (route.planningMode === 'with_time_windows' && stop.deliveryTimeFrom) {
        const windowStart = lithuanianClockOnReferenceDay(currentTime, stop.deliveryTimeFrom);
        if (windowStart !== null) cursor = Math.max(cursor, windowStart);
      }
      cursor += Math.max(0, stop.serviceDurationMinutes) * 60_000;
      return { stopId: stop.id, arrivalAt };
    });
}

export function estimateFirstPendingLeg(
  route: Pick<Route, 'startLocation'>,
  stops: DeliveryStop[],
): { stopId: string; distanceKm: number; durationMinutes: number } | null {
  const ordered = [...stops].sort((left, right) => orderOf(left) - orderOf(right));
  const nextIndex = ordered.findIndex((stop) => stop.deliveryStatus === 'pending');
  if (nextIndex < 0) return null;

  const next = ordered[nextIndex]!;
  const plannedPrevious = nextIndex > 0 ? ordered[nextIndex - 1] : null;
  const latestResolved = latestResolvedStop(ordered);
  const origin = latestResolved ?? route.startLocation;

  if (!latestResolved && nextIndex === 0) return null;
  if (!origin || (plannedPrevious && latestResolved?.id === plannedPrevious.id)) return null;
  if (!hasCoordinates(origin) || !hasCoordinates(next)) return null;

  const directDistanceKm = haversineKm(origin, next);
  const distanceKm = roundToTenth(directDistanceKm * APPROXIMATE_ROAD_FACTOR);
  const durationMinutes = Math.max(1, Math.round(distanceKm / APPROXIMATE_ROAD_SPEED_KMH * 60));
  return { stopId: next.id, distanceKm, durationMinutes };
}

function orderOf(stop: DeliveryStop): number {
  return stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder;
}

function latestResolvedAt(stops: DeliveryStop[]): string | null {
  const stop = latestResolvedStop(stops);
  return stop ? resolvedAt(stop) : null;
}

function latestResolvedStop(stops: DeliveryStop[]): DeliveryStop | null {
  return stops
    .filter((stop) => stop.deliveryStatus !== 'pending' && resolvedAt(stop))
    .sort((left, right) => resolvedAt(right).localeCompare(resolvedAt(left)))[0] ?? null;
}

function resolvedAt(stop: DeliveryStop): string {
  return stop.deliveredAt ?? stop.failedAt ?? '';
}

function hasCoordinates(value: { latitude: number | null; longitude: number | null }): value is { latitude: number; longitude: number } {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
