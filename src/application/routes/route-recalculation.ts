import type { SQLiteDatabase } from 'expo-sqlite';

import { hydrateStopParkPins } from '@/application/location/remember-park-pin';
import { normalizeProviderDepartureAt } from '@/application/parsing/text-parser';
import { routingCoordinates } from '@/domain/location-park-memory';
import { buildOptimizationStop } from '@/application/routes/route-request-builder';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { CandidateLeg, CandidateStopSchedule, RouteOptimizationRequest } from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { createPlanningTravelProvider } from '@/application/routing/planning-travel-provider';
import { persistCandidateEtas, RefreshRouteEtas } from './route-eta';

export type RouteRecalculationProposal = {
  id: string;
  newRunId: string;
  candidateId: string;
  orderBefore: string[];
  orderAfter: string[];
  timeDeltaMinutes: number | null;
  distanceDeltaKm: number | null;
};

export class ProposeRemainingRouteRecalculation {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly clock = () => new Date().toISOString(),
    private readonly idFactory = () => `recalc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ) {}

  async execute(routeId: string, currentStopId: string): Promise<RouteRecalculationProposal> {
    const repository = new RouteRepository(this.db);
    const persisted = await repository.getWithStops(routeId);
    if (!persisted || persisted.route.status !== 'in_progress' || !persisted.route.selectedRunId) {
      throw new Error('Perskaičiuoti galima tik vykdomą, anksčiau optimizuotą maršrutą.');
    }
    const row = await this.db.getFirstAsync<{ request_json: string }>(
      'SELECT request_json FROM routing_engine_runs WHERE id = ? AND route_id = ?',
      persisted.route.selectedRunId,
      routeId,
    );
    if (!row) throw new Error('Pirminio maršruto skaičiavimo auditas nerastas.');
    const original = JSON.parse(row.request_json) as RouteOptimizationRequest;
    const stops = await hydrateStopParkPins(this.db, persisted.stops);
    const currentStop = stops.find((stop) => stop.id === currentStopId);
    const origin = currentStop ? routingCoordinates(currentStop) : null;
    if (!currentStop || !origin) {
      throw new Error('Dabartinė vieta neturi patvirtintų koordinačių. Esama seka nekeičiama.');
    }
    const completedIds = stops.filter((stop) => stop.deliveryStatus !== 'pending').map((stop) => stop.id);
    const remainingStops = stops.filter((stop) => stop.deliveryStatus === 'pending');
    const remainingIds = remainingStops.map((stop) => stop.id);
    const plannedDepartureAt = normalizeProviderDepartureAt(this.clock());
    const priorityOrdered = remainingStops
      .filter((stop) => stop.priorityFirst)
      .sort((left, right) =>
        (left.priorityRank ?? Number.MAX_SAFE_INTEGER) - (right.priorityRank ?? Number.MAX_SAFE_INTEGER)
        || left.originalOrder - right.originalOrder
        || left.id.localeCompare(right.id));
    const priorityRankById = new Map(priorityOrdered.map((stop, index) => [stop.id, index + 1]));
    const nextPriorityIdById = new Map(
      priorityOrdered
        .map((stop, index) => [stop.id, priorityOrdered[index + 1]?.id] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
        .map(([id, nextId]) => [id, [nextId]]),
    );
    // Built from the CURRENT persisted stops (not the frozen `original.stops`
    // snapshot) so a stop added after the route already started — via
    // AddStopDuringDelivery — is included in the re-optimized remaining route.
    const request: RouteOptimizationRequest = {
      ...original,
      routeId,
      plannedDepartureAt,
      // Prefer the courtyard / last GPS pin over the rooftop geocode so the
      // remaining-route origin is where the driver actually is. Uses the same
      // already-purchased (or haversine) planning path — no extra matrix.
      startLocation: {
        id: `current-${currentStop.id}`,
        label: 'Dabartinė vieta',
        latitude: origin.latitude,
        longitude: origin.longitude,
      },
      // Ranks are rebuilt here, not carried over: mid-route the priority stops
      // already delivered are gone, so the chain has to be re-formed over what
      // is actually left. Calling buildOptimizationStop without them dropped
      // deliverBefore entirely and let the remaining priority stops drift apart.
      stops: remainingStops.map((stop) =>
        buildOptimizationStop(stop, persisted.route, plannedDepartureAt, {
          priorityRank: priorityRankById.get(stop.id) ?? 0,
          deliverBeforeStopIds: nextPriorityIdById.get(stop.id) ?? [],
        }),
      ),
      initialLoadKg: remainingStops.reduce((sum, stop) => sum + (stop.weightKg ?? 0), 0),
    };
    // Same rule mid-route as when planning: one recalculation buys one matrix,
    // and repeated taps on "recalculate" cannot each start their own.
    const provider = createPlanningTravelProvider();
    const result = await new RoutingEngine(provider).optimize(request);
    const next = result.recommended;
    if (!next) throw new Error('Naujas įvykdomas variantas nerastas. Esama seka nekeičiama.');
    const previousShare = persisted.route.totalStops === 0 ? 0 : remainingIds.length / persisted.route.totalStops;
    const previousDistance = persisted.route.estimatedDistanceKm === null ? null : persisted.route.estimatedDistanceKm * previousShare;
    const previousMinutes = persisted.route.estimatedDurationMinutes === null ? null : persisted.route.estimatedDurationMinutes * previousShare;
    const proposal: RouteRecalculationProposal = {
      id: this.idFactory(),
      newRunId: result.requestId,
      candidateId: next.id,
      orderBefore: remainingIds,
      orderAfter: next.stopSequence,
      timeDeltaMinutes: previousMinutes === null ? null : next.totalWorkMinutes - previousMinutes,
      distanceDeltaKm: previousDistance === null ? null : next.totalDistanceKm - previousDistance,
    };
    const audit = new SQLiteRoutingAuditRepository(this.db);
    await audit.saveOptimizationRun(routeId, request, result);
    await audit.saveRecalculation({
      id: proposal.id,
      routeId,
      previousRunId: persisted.route.selectedRunId,
      newRunId: proposal.newRunId,
      triggerType: 'failed_stop',
      completedStopIds: completedIds,
      orderBefore: proposal.orderBefore,
      orderAfter: proposal.orderAfter,
      timeDeltaMinutes: proposal.timeDeltaMinutes,
      distanceDeltaKm: proposal.distanceDeltaKm,
      changedStopIds: proposal.orderAfter.filter((id, index) => proposal.orderBefore[index] !== id),
      accepted: null,
      createdAt: this.clock(),
    });
    return proposal;
  }
}

export class ResolveRouteRecalculation {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly clock = () => new Date().toISOString(),
    private readonly idFactory = () => `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ) {}

  async execute(routeId: string, recalculationId: string, accept: boolean): Promise<{ idempotent: boolean }> {
    const row = await this.db.getFirstAsync<{
      accepted: number | null; new_run_id: string; order_before_json: string; order_after_json: string;
    }>('SELECT accepted, new_run_id, order_before_json, order_after_json FROM routing_recalculations WHERE id = ? AND route_id = ?', recalculationId, routeId);
    if (!row) throw new Error('Perskaičiavimo pasiūlymas nerastas.');
    if (row.accepted !== null) return { idempotent: true };
    const route = await new RouteRepository(this.db).getById(routeId);
    if (!route || route.status !== 'in_progress') throw new Error('Maršruto būsena pasikeitė. Esama seka palikta.');
    const after = JSON.parse(row.order_after_json) as string[];
    const candidate = await this.db.getFirstAsync<{
      id: string;
      schedules_json: string;
      legs_json: string;
      matrix_fetched_at: string;
      provider_execution_mode: string;
    }>(
      `SELECT c.id, c.schedules_json, c.legs_json,
              r.matrix_fetched_at, r.provider_execution_mode
       FROM routing_engine_candidates c
       JOIN routing_engine_runs r ON r.id = c.run_id
       WHERE c.run_id = ? ORDER BY c.recommended DESC, c.rank ASC LIMIT 1`,
      row.new_run_id,
    );
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      if (accept) {
        if (!candidate) throw new Error('Perskaičiuotas kandidatas nerastas.');
        const deliveredRows = await this.db.getAllAsync<{ active_order: number }>(
          "SELECT active_order FROM delivery_stops WHERE route_id = ? AND delivery_status <> 'pending' AND active_order IS NOT NULL",
          routeId,
        );
        const used = new Set(deliveredRows.map((item) => item.active_order));
        const available = Array.from({ length: route.totalStops }, (_, index) => index + 1).filter((order) => !used.has(order));
        await this.db.runAsync(
          "UPDATE delivery_stops SET active_order = active_order + 1000000 WHERE route_id = ? AND delivery_status = 'pending'",
          routeId,
        );
        for (const [index, stopId] of after.entries()) {
          await this.db.runAsync(
            'UPDATE delivery_stops SET active_order = ?, updated_at = ? WHERE id = ? AND route_id = ?',
            available[index],
            now,
            stopId,
            routeId,
          );
        }
        await this.db.runAsync(
          `UPDATE routes SET selected_run_id = ?, selected_candidate_id = ?, updated_at = ? WHERE id = ?`,
          row.new_run_id,
          candidate.id,
          now,
          routeId,
        );
        await this.db.runAsync(
          `INSERT INTO route_order_snapshots (id, route_id, kind, ordered_stop_ids_json, created_at)
           VALUES (?, ?, 'optimized', ?, ?)`,
          `snapshot-${this.idFactory()}`,
          routeId,
          JSON.stringify(after),
          now,
        );
        await persistCandidateEtas(
          this.db,
          routeId,
          JSON.parse(candidate.schedules_json) as CandidateStopSchedule[],
          JSON.parse(candidate.legs_json) as CandidateLeg[],
          {
            setOriginalPlan: false,
            updatedAt: candidate.matrix_fetched_at || now,
            approximate: candidate.provider_execution_mode !== 'real',
          },
        );
      }
      await this.db.runAsync('UPDATE routing_recalculations SET accepted = ? WHERE id = ? AND accepted IS NULL', accept ? 1 : 0, recalculationId);
      await this.db.runAsync(
        `INSERT INTO action_journal (id, route_id, action_type, before_json, after_json, created_at)
         VALUES (?, ?, 'route_recalculation_resolved', ?, ?, ?)`,
        this.idFactory(),
        routeId,
        row.order_before_json,
        JSON.stringify({ accepted: accept, order: accept ? after : JSON.parse(row.order_before_json) }),
        now,
      );
    });
    if (!accept) await new RefreshRouteEtas(this.db, this.clock).execute(routeId);
    return { idempotent: false };
  }
}
