import type { SQLiteDatabase } from 'expo-sqlite';

import { RouteRepository } from '@/database/repositories/route-repository';
import type {
  AddressValidationState,
  DeliveryStop,
  ImportSourceType,
  PlanningMode,
  Route,
  RouteEndpoint,
} from '@/domain/route';
import { serviceMinutesForWeight } from '@/domain/service-time';
import { assertRouteTransition } from '@/domain/transitions';
import type { DraftShipmentLineInput } from '@/domain/shipment-line';
import type { CandidateLeg, CandidateStopSchedule } from '@/domain/routing/models';
import { persistCandidateEtas } from './route-eta';

export type RouteCommandErrorCode =
  | 'ACTIVE_ROUTE_EXISTS'
  | 'ROUTE_NOT_FOUND'
  | 'INVALID_ROUTE_STATE'
  | 'INVALID_STOP'
  | 'STOP_NOT_FOUND'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_STOP_MISMATCH'
  | 'ROUTE_CREATION_FAILED'
  | 'PERSISTED_STOP_ID_CONFLICT'
  | 'NO_CONFIRMED_STOPS';

export class RouteCommandError extends Error {
  constructor(
    public readonly code: RouteCommandErrorCode,
    message: string,
    public readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'RouteCommandError';
  }
}

export type DraftStopInput = {
  /** Legacy import/parser identity. Never used as the persisted primary key. */
  id?: string;
  /** Stable import identity retained for audit and source traceability. */
  sourceStopId?: string | null;
  originalOrder: number;
  orderNumber: string | null;
  recipient: string | null;
  originalAddress: string;
  geocodingQuery: string | null;
  normalizedAddress: string | null;
  addressValidationState: AddressValidationState;
  geocodingError?: string | null;
  latitude: number | null;
  longitude: number | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
  requiredTimeWindow: boolean;
  weightKg: number | null;
  phone: string | null;
  notes: string | null;
  /** Original Excel order rows that compose this physical stop. */
  shipmentLines?: DraftShipmentLineInput[];
};

export type CreateDraftRouteInput = {
  id?: string;
  commandId?: string;
  date?: string;
  planningMode?: PlanningMode | null;
  plannedDepartureAt?: string | null;
  startLocation: RouteEndpoint;
  endLocation?: RouteEndpoint;
  sourceImportAuditId?: string | null;
  importSource?: {
    type: ImportSourceType;
    originalText: string | null;
    imageReference: string | null;
  };
};

export type CreateDraftRouteWithStopsInput = CreateDraftRouteInput & {
  commandId: string;
  stops: DraftStopInput[];
};

type Clock = () => string;
type IdFactory = (prefix: string) => string;

const defaultClock: Clock = () => new Date().toISOString();
const defaultIdFactory: IdFactory = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const routeCreationQueues = new WeakMap<object, Promise<void>>();

async function serializeRouteCreation<T>(db: SQLiteDatabase, operation: () => Promise<T>): Promise<T> {
  const key = db as object;
  const previous = routeCreationQueues.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  routeCreationQueues.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (routeCreationQueues.get(key) === current) routeCreationQueues.delete(key);
  }
}

abstract class RouteCommandBase {
  protected readonly routes: RouteRepository;

  constructor(
    protected readonly db: SQLiteDatabase,
    protected readonly clock: Clock = defaultClock,
    protected readonly idFactory: IdFactory = defaultIdFactory,
  ) {
    this.routes = new RouteRepository(db);
  }

  protected async requireRoute(routeId: string): Promise<Route> {
    const route = await this.routes.getById(routeId);
    if (!route) {
      throw new RouteCommandError('ROUTE_NOT_FOUND', 'Maršrutas nerastas.', { routeId });
    }
    return route;
  }

  protected async requireDraft(routeId: string): Promise<Route> {
    const route = await this.requireRoute(routeId);
    if (route.status !== 'draft') {
      throw new RouteCommandError(
        'INVALID_ROUTE_STATE',
        'Keisti pristatymo taškus galima tik ruošiamame maršrute.',
        { routeId, status: route.status },
      );
    }
    return route;
  }

  protected async audit(
    routeId: string,
    actionType: string,
    before: unknown,
    after: unknown,
    stopId: string | null = null,
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO action_journal (
        id, route_id, stop_id, action_type, before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      this.idFactory('action'),
      routeId,
      stopId,
      actionType,
      JSON.stringify(before),
      JSON.stringify(after),
      this.clock(),
    );
  }
}

export class CreateDraftRoute extends RouteCommandBase {
  async execute(input: CreateDraftRouteInput): Promise<{ routeId: string }> {
    return serializeRouteCreation(this.db, async () => {
      const now = this.clock();
      let routeId = input.id ?? this.idFactory('route');
      try {
        await this.db.withTransactionAsync(async () => {
          if (input.commandId) {
            const existing = await this.db.getFirstAsync<{ route_id: string }>(
              'SELECT route_id FROM route_creation_commands WHERE command_id = ?',
              input.commandId,
            );
            if (existing) {
              routeId = existing.route_id;
              return;
            }
          }
          await insertDraftRoute(this.db, routeId, input, now);
          if (input.importSource) await insertImportSource(this.db, routeId, input.importSource, now, this.idFactory);
          if (input.sourceImportAuditId) {
            await this.db.runAsync(
              'UPDATE import_audits SET final_route_id = ?, completed_at = ? WHERE id = ?',
              routeId,
              now,
              input.sourceImportAuditId,
            );
          }
          await this.audit(routeId, 'draft_route_created', {}, {
            routeId,
            status: 'draft',
            planningMode: input.planningMode ?? null,
          });
          if (input.commandId) {
            await this.db.runAsync(
              'INSERT INTO route_creation_commands (command_id, route_id, created_at) VALUES (?, ?, ?)',
              input.commandId,
              routeId,
              now,
            );
          }
        });
      } catch (error) {
        throw error;
      }
      return { routeId };
    });
  }
}

/** Persists the Route and all DeliveryStops in one rollback-safe transaction. */
export class CreateDraftRouteWithStops extends RouteCommandBase {
  async execute(input: CreateDraftRouteWithStopsInput): Promise<{
    routeId: string;
    stopIds: string[];
    idempotent: boolean;
    recoveredIncompleteDraft: boolean;
  }> {
    validateStops(input.stops);
    if (input.stops.length === 0) {
      throw new RouteCommandError(
        'NO_CONFIRMED_STOPS',
        'Nerasta jokių patvirtintų pristatymo taškų. Patikrinkite adresus ir bandykite dar kartą.',
      );
    }
    return serializeRouteCreation(this.db, async () => {
      const now = this.clock();
      const generatedRouteId = input.id ?? this.idFactory('route');
      const generatedStopIds = input.stops.map(() => this.idFactory('stop'));
      let result = {
        routeId: generatedRouteId,
        stopIds: generatedStopIds,
        idempotent: false,
        recoveredIncompleteDraft: false,
      };
      try {
        await this.db.withTransactionAsync(async () => {
          const existing = await this.db.getFirstAsync<{ route_id: string }>(
            'SELECT route_id FROM route_creation_commands WHERE command_id = ?',
            input.commandId,
          );
          if (existing) {
            const rows = await this.db.getAllAsync<{ id: string }>(
              'SELECT id FROM delivery_stops WHERE route_id = ? ORDER BY original_order',
              existing.route_id,
            );
            result = {
              routeId: existing.route_id,
              stopIds: rows.map((row) => row.id),
              idempotent: true,
              recoveredIncompleteDraft: false,
            };
            return;
          }

          const draftRows = await this.db.getAllAsync<{ id: string }>(
            "SELECT id FROM routes WHERE status = 'draft' ORDER BY created_at DESC",
          );
          let recoverableDraft: Route | null = null;
          for (const row of draftRows) {
            const draft = await this.routes.getById(row.id);
            if (draft && await isRecoverableIncompleteDraft(this.db, draft, input)) {
              recoverableDraft = draft;
              break;
            }
          }
          const recoverable = recoverableDraft !== null;
          const routeId = recoverableDraft?.id ?? generatedRouteId;
          result = { ...result, routeId, recoveredIncompleteDraft: recoverable };

          if (!recoverable) {
            await insertDraftRoute(this.db, routeId, input, now);
            if (input.importSource) await insertImportSource(this.db, routeId, input.importSource, now, this.idFactory);
            await this.audit(routeId, 'draft_route_created', {}, {
              routeId,
              status: 'draft',
              planningMode: input.planningMode ?? null,
            });
          }
          for (const [index, stop] of input.stops.entries()) {
            await insertStop(this.db, routeId, generatedStopIds[index]!, stop, now, this.idFactory);
          }
          await updateRouteTotals(this.db, routeId, now);
          await this.db.runAsync(
            `INSERT INTO route_order_snapshots (
              id, route_id, kind, ordered_stop_ids_json, created_at
            ) VALUES (?, ?, 'original', ?, ?)`,
            this.idFactory('snapshot'),
            routeId,
            JSON.stringify(generatedStopIds),
            now,
          );
          await this.audit(
            routeId,
            recoverable ? 'incomplete_draft_recovered' : 'draft_stops_created',
            recoverable ? { totalStops: 0 } : {},
            { stopIds: generatedStopIds, sourceStopIds: input.stops.map(sourceStopIdentity) },
          );
          if (input.sourceImportAuditId) {
            await this.db.runAsync(
              'UPDATE import_audits SET final_route_id = ?, completed_at = ? WHERE id = ?',
              routeId,
              now,
              input.sourceImportAuditId,
            );
          }
          await this.db.runAsync(
            'INSERT INTO route_creation_commands (command_id, route_id, created_at) VALUES (?, ?, ?)',
            input.commandId,
            routeId,
            now,
          );
        });
      } catch (error) {
        if (String(error).includes('delivery_stops.id')) {
          throw new RouteCommandError(
            'PERSISTED_STOP_ID_CONFLICT',
            'Nepavyko sukurti unikalių pristatymo taškų. Visa operacija atšaukta; bandykite dar kartą.',
            { routeId: result.routeId, sourceStopIds: input.stops.map(sourceStopIdentity).filter(Boolean).join(',') },
          );
        }
        if (error instanceof RouteCommandError) throw error;
        throw new RouteCommandError(
          'ROUTE_CREATION_FAILED',
          'Maršrutas neišsaugotas. Duomenų bazėje nepalikta dalinio maršruto.',
          { routeId: result.routeId },
        );
      }
      return result;
    });
  }
}

export class ReplaceDraftStops extends RouteCommandBase {
  async execute(routeId: string, stops: DraftStopInput[]): Promise<{ stopIds: string[] }> {
    await this.requireDraft(routeId);
    validateStops(stops);
    const now = this.clock();
    const stopIds = stops.map(() => this.idFactory('stop'));
    await this.db.withTransactionAsync(async () => {
      const before = await this.routes.getStops(routeId);
      await this.db.runAsync('DELETE FROM delivery_stops WHERE route_id = ?', routeId);
      for (const [index, stop] of stops.entries()) {
        await insertStop(this.db, routeId, stopIds[index]!, stop, now, this.idFactory);
      }
      await updateRouteTotals(this.db, routeId, now);
      await this.db.runAsync(
        `INSERT INTO route_order_snapshots (
          id, route_id, kind, ordered_stop_ids_json, created_at
        ) VALUES (?, ?, 'original', ?, ?)`,
        this.idFactory('snapshot'),
        routeId,
        JSON.stringify(stopIds),
        now,
      );
      await this.audit(routeId, 'draft_stops_replaced', before, {
        stopIds,
        sourceStopIds: stops.map(sourceStopIdentity),
      });
    });
    return { stopIds };
  }
}

export class UpdateDraftStop extends RouteCommandBase {
  async execute(routeId: string, stopId: string, patch: Partial<DraftStopInput>): Promise<void> {
    await this.requireDraft(routeId);
    const current = (await this.routes.getStops(routeId)).find((stop) => stop.id === stopId);
    if (!current) throw new RouteCommandError('STOP_NOT_FOUND', 'Pristatymo taškas nerastas.', { stopId });
    const next = mergeStop(current, patch);
    validateStops([next]);
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE delivery_stops SET
          order_number = ?, recipient = ?, address = ?, original_address = ?,
          geocoding_query = ?, normalized_address = ?, address_validation_state = ?,
          geocoding_error = ?, latitude = ?, longitude = ?, delivery_time_from = ?,
          delivery_time_to = ?, required_time_window = ?, weight_kg = ?, phone = ?,
          notes = ?, updated_at = ?
        WHERE id = ? AND route_id = ?`,
        next.orderNumber,
        next.recipient ?? '',
        next.normalizedAddress ?? next.originalAddress,
        next.originalAddress,
        next.geocodingQuery,
        next.normalizedAddress,
        next.addressValidationState,
        next.geocodingError ?? null,
        next.latitude,
        next.longitude,
        next.deliveryTimeFrom,
        next.deliveryTimeTo,
        next.requiredTimeWindow ? 1 : 0,
        next.weightKg,
        next.phone,
        next.notes,
        now,
        stopId,
        routeId,
      );
      await updateRouteTotals(this.db, routeId, now);
      await this.audit(routeId, 'draft_stop_updated', current, next, stopId);
    });
  }
}

export class SetStopPriority extends RouteCommandBase {
  /** Multiple priority stops are allowed; optimizer keeps their relative order along the way. */
  async execute(routeId: string, stopId: string, priorityFirst: boolean): Promise<void> {
    await this.requireDraft(routeId);
    const stops = await this.routes.getStops(routeId);
    const current = stops.find((stop) => stop.id === stopId);
    if (!current) throw new RouteCommandError('STOP_NOT_FOUND', 'Pristatymo taškas nerastas.', { stopId });
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        'UPDATE delivery_stops SET priority_first = ?, updated_at = ? WHERE id = ? AND route_id = ?',
        priorityFirst ? 1 : 0,
        now,
        stopId,
        routeId,
      );
      await this.db.runAsync('UPDATE routes SET updated_at = ? WHERE id = ?', now, routeId);
      await this.audit(
        routeId,
        'draft_stop_priority_set',
        { priorityFirst: current.priorityFirst },
        { priorityFirst },
        stopId,
      );
    });
  }
}

export class DeleteDraftStop extends RouteCommandBase {
  async execute(routeId: string, stopId: string): Promise<void> {
    await this.requireDraft(routeId);
    const stops = await this.routes.getStops(routeId);
    const current = stops.find((stop) => stop.id === stopId);
    if (!current) throw new RouteCommandError('STOP_NOT_FOUND', 'Pristatymo taškas nerastas.', { stopId });
    const remaining = stops.filter((stop) => stop.id !== stopId);
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('DELETE FROM delivery_stops WHERE id = ? AND route_id = ?', stopId, routeId);
      await rewriteOriginalOrder(this.db, routeId, remaining.map((stop) => stop.id));
      await updateRouteTotals(this.db, routeId, this.clock());
      await this.audit(routeId, 'draft_stop_deleted', current, {});
    });
  }
}

export class ReorderDraftStops extends RouteCommandBase {
  async execute(routeId: string, orderedStopIds: string[]): Promise<void> {
    await this.requireDraft(routeId);
    const stops = await this.routes.getStops(routeId);
    const existing = stops.map((stop) => stop.id).sort();
    const requested = [...orderedStopIds].sort();
    if (existing.length !== requested.length || existing.some((id, index) => id !== requested[index])) {
      throw new RouteCommandError('INVALID_STOP', 'Naujoje eilėje turi būti visi ir tik šio maršruto taškai.');
    }
    await this.db.withTransactionAsync(async () => {
      const now = this.clock();
      await rewriteOriginalOrder(this.db, routeId, orderedStopIds, now);
      await this.db.runAsync('UPDATE routes SET updated_at = ? WHERE id = ?', now, routeId);
      await this.db.runAsync(
        `INSERT INTO route_order_snapshots (
          id, route_id, kind, ordered_stop_ids_json, created_at
        ) VALUES (?, ?, 'manual', ?, ?)`,
        this.idFactory('snapshot'),
        routeId,
        JSON.stringify(orderedStopIds),
        now,
      );
      await this.audit(routeId, 'draft_stops_reordered', existing, orderedStopIds);
    });
  }
}

export class UpdateDraftRouteLocations extends RouteCommandBase {
  async execute(routeId: string, startLocation: RouteEndpoint, endLocation = startLocation): Promise<void> {
    await this.requireDraft(routeId);
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE routes SET start_location_json = ?, end_location_json = ?, updated_at = ?
         WHERE id = ?`,
        JSON.stringify(startLocation),
        JSON.stringify(endLocation),
        this.clock(),
        routeId,
      );
      await this.audit(routeId, 'draft_route_locations_updated', {}, { startLocation, endLocation });
    });
  }
}

export class SaveSelectedRouteCandidate extends RouteCommandBase {
  async execute(routeId: string, runId: string, candidateId: string): Promise<{ idempotent: boolean }> {
    const route = await this.requireRoute(routeId);
    if (
      route.selectedRunId === runId &&
      route.selectedCandidateId === candidateId &&
      ['planned', 'loading', 'loaded', 'in_progress'].includes(route.status)
    ) {
      return { idempotent: true };
    }
    if (!['draft', 'planned'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Šioje būsenoje maršruto varianto pakeisti negalima.');
    }
    const candidate = await this.db.getFirstAsync<{
      stop_sequence_json: string;
      schedules_json: string;
      legs_json: string;
      total_distance_km: number;
      total_work_minutes: number;
      matrix_fetched_at: string;
      provider_execution_mode: string;
    }>(
      `SELECT c.stop_sequence_json, c.schedules_json, c.legs_json,
              c.total_distance_km, c.total_work_minutes,
              r.matrix_fetched_at, r.provider_execution_mode
       FROM routing_engine_candidates c
       JOIN routing_engine_runs r ON r.id = c.run_id
       WHERE c.run_id = ? AND c.id = ? AND r.route_id = ?`,
      runId,
      candidateId,
      routeId,
    );
    if (!candidate) {
      throw new RouteCommandError('CANDIDATE_NOT_FOUND', 'Pasirinktas variantas nerastas.');
    }
    const sequence = parseStringArray(candidate.stop_sequence_json);
    const stops = await this.routes.getStops(routeId);
    if (!sameIds(sequence, stops.map((stop) => stop.id))) {
      throw new RouteCommandError(
        'CANDIDATE_STOP_MISMATCH',
        'Pasirinkto varianto taškai nebeatitinka ruošiamo maršruto.',
      );
    }
    const scheduleList = JSON.parse(candidate.schedules_json) as CandidateStopSchedule[];
    const legs = JSON.parse(candidate.legs_json) as CandidateLeg[];
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        'UPDATE delivery_stops SET optimized_order = NULL, active_order = NULL WHERE route_id = ?',
        routeId,
      );
      for (const [index, stopId] of sequence.entries()) {
        await this.db.runAsync(
          `UPDATE delivery_stops SET optimized_order = ?, active_order = ?, updated_at = ?
           WHERE route_id = ? AND id = ?`,
          index + 1,
          index + 1,
          now,
          routeId,
          stopId,
        );
      }
      await persistCandidateEtas(this.db, routeId, scheduleList, legs, {
        setOriginalPlan: true,
        updatedAt: candidate.matrix_fetched_at || now,
        approximate: candidate.provider_execution_mode !== 'real',
      });
      await this.db.runAsync(
        'UPDATE routing_engine_candidates SET selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE run_id = ?',
        candidateId,
        runId,
      );
      await this.db.runAsync(
        'UPDATE routing_engine_runs SET selected_candidate_id = ? WHERE id = ? AND route_id = ?',
        candidateId,
        runId,
        routeId,
      );
      await this.db.runAsync(
        `UPDATE routes SET status = 'planned', selected_run_id = ?, selected_candidate_id = ?,
         estimated_distance_km = ?, estimated_duration_minutes = ?,
         planned_departure_at = COALESCE(?, planned_departure_at), updated_at = ?
         WHERE id = ?`,
        runId,
        candidateId,
        candidate.total_distance_km,
        candidate.total_work_minutes,
        legs[0]?.departureAt ?? null,
        now,
        routeId,
      );
      await this.db.runAsync(
        `INSERT INTO route_order_snapshots (
          id, route_id, kind, ordered_stop_ids_json, created_at
        ) VALUES (?, ?, 'optimized', ?, ?)`,
        this.idFactory('snapshot'),
        routeId,
        JSON.stringify(sequence),
        now,
      );
      await this.audit(routeId, 'route_candidate_selected', {}, { runId, candidateId, sequence });
    });
    return { idempotent: false };
  }
}

export class ActivateRoute extends RouteCommandBase {
  async execute(routeId: string): Promise<{ idempotent: boolean }> {
    const route = await this.requireRoute(routeId);
    if (route.status === 'loading') return { idempotent: true };
    if (route.status !== 'planned') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Krovimą galima pradėti tik pasirinkus maršruto variantą.');
    }
    assertRouteTransition(route.status, 'loading');
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE routes SET status = 'loading', updated_at = ? WHERE id = ? AND status = 'planned'`,
        this.clock(),
        routeId,
      );
      await this.audit(routeId, 'route_activated_for_loading', { status: route.status }, { status: 'loading' });
    });
    return { idempotent: false };
  }
}

export class ReopenRouteForPlanning extends RouteCommandBase {
  /** Lets the user back out of a chosen route alternative before loading starts, so alternatives.tsx can recompute. */
  async execute(routeId: string): Promise<void> {
    const route = await this.requireRoute(routeId);
    if (!['planned', 'loading'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Maršruto varianto pasirinkimą pakeisti galima tik prieš pradedant krautis.');
    }
    assertRouteTransition(route.status, 'draft');
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE routes SET status = 'draft', selected_run_id = NULL, selected_candidate_id = NULL,
         estimated_distance_km = NULL, estimated_duration_minutes = NULL, updated_at = ?
         WHERE id = ?`,
        now,
        routeId,
      );
      await this.db.runAsync(
        'UPDATE delivery_stops SET optimized_order = NULL, active_order = NULL, updated_at = ? WHERE route_id = ?',
        now,
        routeId,
      );
      await this.audit(routeId, 'route_reopened_for_planning', { status: route.status }, { status: 'draft' });
    });
  }
}

export class GetActiveRoute extends RouteCommandBase {
  async execute(): Promise<{ route: Route; stops: DeliveryStop[] } | null> {
    const route = await this.routes.getActive();
    if (!route) return null;
    return { route, stops: await this.routes.getStops(route.id) };
  }
}

export class CancelDraftRoute extends RouteCommandBase {
  async execute(routeId: string): Promise<void> {
    const route = await this.requireRoute(routeId);
    if (!['draft', 'planned', 'loading', 'loaded', 'in_progress'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Šio maršruto atšaukti nebegalima.');
    }
    const now = this.clock();
    assertRouteTransition(route.status, 'cancelled');
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        "UPDATE routes SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?",
        now,
        now,
        routeId,
      );
      await this.audit(routeId, 'route_cancelled', { status: route.status }, { status: 'cancelled', cancelledAt: now });
    });
  }
}

async function insertStop(
  db: SQLiteDatabase,
  routeId: string,
  stopId: string,
  stop: DraftStopInput,
  now: string,
  idFactory: IdFactory,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO delivery_stops (
      id, source_stop_id, route_id, original_order, active_order, order_number, recipient,
      address, original_address, geocoding_query, normalized_address,
      address_validation_state, geocoding_error, latitude, longitude,
      delivery_time_from, delivery_time_to, required_time_window, weight_kg,
      phone, notes, loading_status, delivery_status, service_duration_minutes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'pending', 'pending', ?, ?, ?)`,
    stopId,
    sourceStopIdentity(stop),
    routeId,
    stop.originalOrder,
    stop.originalOrder,
    stop.orderNumber,
    stop.recipient ?? '',
    stop.normalizedAddress ?? stop.originalAddress,
    stop.originalAddress,
    stop.geocodingQuery,
    stop.normalizedAddress,
    stop.addressValidationState,
    stop.geocodingError ?? null,
    stop.latitude,
    stop.longitude,
    stop.deliveryTimeFrom,
    stop.deliveryTimeTo,
    stop.requiredTimeWindow ? 1 : 0,
    stop.weightKg,
    stop.phone,
    stop.notes,
    serviceMinutesForWeight(stop.weightKg),
    now,
    now,
  );
  for (const line of stop.shipmentLines ?? []) {
    await db.runAsync(
      `INSERT INTO shipment_lines (
        id, route_id, delivery_stop_id, source_import_id, source_sheet_name,
        source_row_number, order_number, weight_grams, delivery_time_from,
        delivery_time_to, supplier_prefix, recipient, route_code, raw_column_d,
        raw_column_e, raw_row_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      idFactory('shipment-line'),
      routeId,
      stopId,
      line.sourceImportId,
      line.sourceSheetName,
      line.sourceRowNumber,
      line.orderNumber,
      line.weightGrams,
      line.deliveryTimeFrom,
      line.deliveryTimeTo,
      line.supplierPrefix,
      line.recipient,
      line.routeCode,
      line.rawColumnD,
      line.rawColumnE,
      JSON.stringify(line.rawRow),
      now,
    );
  }
}

async function insertDraftRoute(
  db: SQLiteDatabase,
  routeId: string,
  input: CreateDraftRouteInput,
  now: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO routes (
      id, date, status, planning_mode, total_weight_kg,
      remaining_weight_kg, total_stops, remaining_stops, created_at,
      updated_at, start_location_json, end_location_json,
      planned_departure_at, source_import_audit_id, unknown_weight_stops
    ) VALUES (?, ?, 'draft', ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, 0)`,
    routeId,
    input.date ?? now.slice(0, 10),
    input.planningMode ?? null,
    now,
    now,
    JSON.stringify(input.startLocation),
    JSON.stringify(input.endLocation ?? input.startLocation),
    input.plannedDepartureAt ?? null,
    input.sourceImportAuditId ?? null,
  );
}

async function insertImportSource(
  db: SQLiteDatabase,
  routeId: string,
  source: NonNullable<CreateDraftRouteInput['importSource']>,
  now: string,
  idFactory: IdFactory,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO import_sources (
      id, route_id, type, original_text, image_reference, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    idFactory('source'),
    routeId,
    source.type,
    source.originalText,
    source.imageReference,
    now,
  );
}

async function isRecoverableIncompleteDraft(
  db: SQLiteDatabase,
  active: Route,
  input: CreateDraftRouteWithStopsInput,
): Promise<boolean> {
  if (active.status !== 'draft' || active.totalStops !== 0) return false;
  const persisted = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM delivery_stops WHERE route_id = ?',
    active.id,
  );
  if ((persisted?.count ?? 0) !== 0) return false;
  if (
    input.sourceImportAuditId &&
    active.sourceImportAuditId === input.sourceImportAuditId
  ) return true;
  if (!input.importSource) return false;
  const source = await db.getFirstAsync<{
    type: ImportSourceType;
    original_text: string | null;
    image_reference: string | null;
  }>(
    `SELECT type, original_text, image_reference FROM import_sources
     WHERE route_id = ? ORDER BY created_at DESC LIMIT 1`,
    active.id,
  );
  return Boolean(
    source &&
    source.type === input.importSource.type &&
    source.original_text === input.importSource.originalText &&
    source.image_reference === input.importSource.imageReference
  );
}

function activeRouteError(route: Route): RouteCommandError {
  return new RouteCommandError(
    'ACTIVE_ROUTE_EXISTS',
    'Jau yra aktyvus maršrutas. Tęskite jį arba aiškiai atšaukite.',
    { activeRouteId: route.id, activeStatus: route.status },
  );
}

function sourceStopIdentity(stop: DraftStopInput): string | null {
  return stop.sourceStopId ?? stop.id ?? null;
}

async function updateRouteTotals(db: SQLiteDatabase, routeId: string, now: string): Promise<void> {
  await db.runAsync(
    `UPDATE routes SET
      total_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM delivery_stops WHERE route_id = ?), 0),
      remaining_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM delivery_stops WHERE route_id = ?), 0),
      unknown_weight_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND weight_kg IS NULL),
      remaining_unknown_weight_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND weight_kg IS NULL),
      total_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ?),
      remaining_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ?),
      updated_at = ?
    WHERE id = ?`,
    routeId,
    routeId,
    routeId,
    routeId,
    routeId,
    routeId,
    now,
    routeId,
  );
}

async function rewriteOriginalOrder(
  db: SQLiteDatabase,
  routeId: string,
  orderedStopIds: string[],
  now = new Date().toISOString(),
): Promise<void> {
  await db.runAsync(
    'UPDATE delivery_stops SET original_order = original_order + 1000000, active_order = NULL WHERE route_id = ?',
    routeId,
  );
  for (const [index, stopId] of orderedStopIds.entries()) {
    await db.runAsync(
      `UPDATE delivery_stops SET original_order = ?, active_order = ?, updated_at = ?
       WHERE route_id = ? AND id = ?`,
      index + 1,
      index + 1,
      now,
      routeId,
      stopId,
    );
  }
}

function validateStops(stops: DraftStopInput[]): void {
  const orders = new Set<number>();
  for (const stop of stops) {
    if (!Number.isInteger(stop.originalOrder) || stop.originalOrder <= 0 || orders.has(stop.originalOrder)) {
      throw new RouteCommandError('INVALID_STOP', 'Pristatymo taškų pradinė eilė turi būti unikali ir teigiama.');
    }
    orders.add(stop.originalOrder);
    if (!stop.originalAddress.trim()) {
      throw new RouteCommandError('INVALID_STOP', 'Adresas yra vienintelis privalomas pristatymo laukas.');
    }
    if (stop.weightKg !== null && (!Number.isFinite(stop.weightKg) || stop.weightKg < 0)) {
      throw new RouteCommandError('INVALID_STOP', 'Svoris turi būti teigiamas skaičius arba nežinomas.');
    }
  }
}

function mergeStop(current: DeliveryStop, patch: Partial<DraftStopInput>): DraftStopInput {
  return {
    sourceStopId: current.sourceStopId,
    originalOrder: patch.originalOrder ?? current.originalOrder,
    orderNumber: patch.orderNumber === undefined ? current.orderNumber : patch.orderNumber,
    recipient: patch.recipient === undefined ? current.recipient : patch.recipient,
    originalAddress: patch.originalAddress ?? current.originalAddress,
    geocodingQuery: patch.geocodingQuery === undefined ? current.geocodingQuery : patch.geocodingQuery,
    normalizedAddress: patch.normalizedAddress === undefined ? current.normalizedAddress : patch.normalizedAddress,
    addressValidationState: patch.addressValidationState ?? current.addressValidationState,
    geocodingError: patch.geocodingError === undefined ? current.geocodingError : patch.geocodingError,
    latitude: patch.latitude === undefined ? current.latitude : patch.latitude,
    longitude: patch.longitude === undefined ? current.longitude : patch.longitude,
    deliveryTimeFrom: patch.deliveryTimeFrom === undefined ? current.deliveryTimeFrom : patch.deliveryTimeFrom,
    deliveryTimeTo: patch.deliveryTimeTo === undefined ? current.deliveryTimeTo : patch.deliveryTimeTo,
    requiredTimeWindow: patch.requiredTimeWindow ?? current.requiredTimeWindow,
    weightKg: patch.weightKg === undefined ? current.weightKg : patch.weightKg,
    phone: patch.phone === undefined ? current.phone : patch.phone,
    notes: patch.notes === undefined ? current.notes : patch.notes,
  };
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
}

function sameIds(left: string[], right: string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((id, index) => id === rightSorted[index]);
}
