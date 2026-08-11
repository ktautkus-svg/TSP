import type { SQLiteDatabase } from 'expo-sqlite';

import { RouteRepository } from '@/database/repositories/route-repository';
import { isDeliveryFailureReason } from '@/domain/delivery-failure';
import { isLoadingFailureReason, type LoadingFailureReason } from '@/domain/loading-failure';
import type { DeliveryStop, Route, RouteCompletionSummary, RouteEndpoint } from '@/domain/route';
import { assertRouteTransition } from '@/domain/transitions';
import { RouteCommandError } from './route-commands';
import { RefreshRouteEtas } from './route-eta';

type Clock = () => string;
type IdFactory = (prefix: string) => string;

const defaultClock: Clock = () => new Date().toISOString();
const defaultIdFactory: IdFactory = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const UNDO_WINDOW_MS = 15 * 60 * 1000;

export type RouteProgress = {
  totalStops: number;
  loadedStops: number;
  notLoadedStops: number;
  loadingResolvedStops: number;
  deliveredStops: number;
  failedStops: number;
  remainingStops: number;
  totalKnownWeightKg: number;
  loadedKnownWeightKg: number;
  remainingKnownWeightKg: number;
  totalUnknownWeightStops: number;
  loadedUnknownWeightStops: number;
  remainingUnknownWeightStops: number;
  loadingPercent: number;
  deliveryPercent: number;
  preliminaryRemainingDistanceKm: number | null;
};

export type UndoableAction = {
  id: string;
  routeId: string;
  stopId: string | null;
  actionType: 'stop_loaded' | 'stop_not_loaded' | 'stop_delivered' | 'stop_failed' | 'all_stops_loaded';
  createdAt: string;
  undoExpiresAt: string;
};

abstract class WorkdayCommand {
  protected readonly routes: RouteRepository;

  constructor(
    protected readonly db: SQLiteDatabase,
    protected readonly clock: Clock = defaultClock,
    protected readonly idFactory: IdFactory = defaultIdFactory,
  ) {
    this.routes = new RouteRepository(db);
  }

  protected async route(routeId: string): Promise<Route> {
    const route = await this.routes.getById(routeId);
    if (!route) throw new RouteCommandError('ROUTE_NOT_FOUND', 'Maršrutas nerastas.', { routeId });
    return route;
  }

  protected async stop(routeId: string, stopId: string): Promise<DeliveryStop> {
    const stop = (await this.routes.getStops(routeId)).find((item) => item.id === stopId);
    if (!stop) throw new RouteCommandError('STOP_NOT_FOUND', 'Pristatymo taškas nerastas.', { routeId, stopId });
    return stop;
  }

  protected async journal(
    routeId: string,
    stopId: string | null,
    actionType: string,
    before: unknown,
    after: unknown,
    undoable = false,
  ): Promise<string> {
    const id = this.idFactory('action');
    const now = this.clock();
    const expiresAt = undoable
      ? new Date(new Date(now).getTime() + UNDO_WINDOW_MS).toISOString()
      : null;
    await this.db.runAsync(
      `INSERT INTO action_journal (
        id, route_id, stop_id, action_type, before_json, after_json,
        created_at, undo_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      routeId,
      stopId,
      actionType,
      JSON.stringify(before),
      JSON.stringify(after),
      now,
      expiresAt,
    );
    return id;
  }
}

export class MarkStopLoaded extends WorkdayCommand {
  async execute(routeId: string, stopId: string): Promise<{ idempotent: boolean; actionId: string | null; allLoaded: boolean }> {
    const route = await this.route(routeId);
    const stop = await this.stop(routeId, stopId);
    if (stop.loadingStatus === 'loaded') {
      return { idempotent: true, actionId: null, allLoaded: route.status === 'loaded' };
    }
    if (!['loading', 'loaded'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Taškus galima krauti tik krovimo būsenoje.');
    }
    const now = this.clock();
    let actionId = '';
    let allLoaded = false;
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE delivery_stops SET loading_status = 'loaded', loaded_at = ?,
         delivery_status = 'pending', delivered_at = NULL, failed_at = NULL,
         failure_reason = NULL, failure_comment = NULL, updated_at = ?
         WHERE id = ? AND route_id = ? AND loading_status = 'pending'`,
        now,
        now,
        stopId,
        routeId,
      );
      const pending = await this.db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending' AND loading_status <> 'loaded'",
        routeId,
      );
      allLoaded = (pending?.count ?? 0) === 0;
      if (allLoaded && route.status === 'loading') {
        assertRouteTransition('loading', 'loaded');
        await this.db.runAsync("UPDATE routes SET status = 'loaded', updated_at = ? WHERE id = ?", now, routeId);
      } else {
        // Route snapshots are the sync unit, so stop-only progress must also
        // advance the parent route's computed dirty timestamp.
        await this.db.runAsync('UPDATE routes SET updated_at = ? WHERE id = ?', now, routeId);
      }
      actionId = await this.journal(
        routeId,
        stopId,
        'stop_loaded',
        { ...stopState(stop), loadingStatus: stop.loadingStatus, loadedAt: stop.loadedAt, routeStatus: route.status },
        { deliveryStatus: 'pending', deliveredAt: null, failedAt: null, failureReason: null, failureComment: null,
          loadingStatus: 'loaded', loadedAt: now, routeStatus: allLoaded ? 'loaded' : route.status },
        true,
      );
    });
    return { idempotent: false, actionId, allLoaded };
  }
}

export class MarkAllStopsLoaded extends WorkdayCommand {
  async execute(routeId: string): Promise<{
    idempotent: boolean;
    actionId: string | null;
    loadedCount: number;
    allLoaded: boolean;
  }> {
    let idempotent = true;
    let actionId: string | null = null;
    let loadedCount = 0;
    let allLoaded = false;

    await this.db.withTransactionAsync(async () => {
      const route = await this.db.getFirstAsync<{ status: Route['status'] }>(
        'SELECT status FROM routes WHERE id = ?',
        routeId,
      );
      if (!route) throw new RouteCommandError('ROUTE_NOT_FOUND', 'Maršrutas nerastas.', { routeId });

      const pendingStops = await this.db.getAllAsync<{ id: string }>(
        "SELECT id FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending' AND loading_status = 'pending' ORDER BY id",
        routeId,
      );
      if (pendingStops.length === 0) {
        const unresolved = await this.db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending' AND loading_status <> 'loaded'",
          routeId,
        );
        allLoaded = (unresolved?.count ?? 0) === 0;
        if (allLoaded && route.status === 'loading') {
          assertRouteTransition('loading', 'loaded');
          const now = this.clock();
          await this.db.runAsync("UPDATE routes SET status = 'loaded', updated_at = ? WHERE id = ? AND status = 'loading'", now, routeId);
        }
        return;
      }
      if (route.status !== 'loading') {
        throw new RouteCommandError('INVALID_ROUTE_STATE', 'Taškus galima krauti tik krovimo būsenoje.');
      }

      const now = this.clock();
      const update = await this.db.runAsync(
        `UPDATE delivery_stops SET loading_status = 'loaded', loaded_at = ?, updated_at = ?
         WHERE route_id = ? AND delivery_status = 'pending' AND loading_status = 'pending'`,
        now,
        now,
        routeId,
      );
      loadedCount = update.changes;
      if (loadedCount === 0) {
        allLoaded = false;
        return;
      }

      assertRouteTransition('loading', 'loaded');
      const routeUpdate = await this.db.runAsync(
        "UPDATE routes SET status = 'loaded', updated_at = ? WHERE id = ? AND status = 'loading'",
        now,
        routeId,
      );
      if (routeUpdate.changes !== 1) {
        throw new RouteCommandError('INVALID_ROUTE_STATE', 'Maršruto būsena jau pasikeitė.');
      }

      const changedStopIds = pendingStops.map((stop) => stop.id);
      actionId = await this.journal(
        routeId,
        null,
        'all_stops_loaded',
        { routeStatus: route.status, changedStopIds },
        { routeStatus: 'loaded', changedStopIds, loadedAt: now },
        true,
      );
      idempotent = false;
      allLoaded = true;
    });

    return { idempotent, actionId, loadedCount, allLoaded };
  }
}

export class MarkStopUnloaded extends WorkdayCommand {
  async execute(routeId: string, stopId: string): Promise<{ idempotent: boolean; actionId: string | null }> {
    const route = await this.route(routeId);
    const stop = await this.stop(routeId, stopId);
    if (stop.loadingStatus === 'pending') return { idempotent: true, actionId: null };
    if (!['loading', 'loaded'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pakrovimą galima keisti tik krovimo ekrane.');
    }

    const now = this.clock();
    let actionId: string | null = null;
    await this.db.withTransactionAsync(async () => {
      const update = await this.db.runAsync(
        `UPDATE delivery_stops SET loading_status = 'pending', loaded_at = NULL, updated_at = ?
         WHERE id = ? AND route_id = ? AND loading_status = 'loaded'`,
        now,
        stopId,
        routeId,
      );
      if (update.changes === 0) return;
      if (route.status === 'loaded') {
        await this.db.runAsync(
          "UPDATE routes SET status = 'loading', updated_at = ? WHERE id = ? AND status = 'loaded'",
          now,
          routeId,
        );
      } else {
        await this.db.runAsync('UPDATE routes SET updated_at = ? WHERE id = ?', now, routeId);
      }
      actionId = await this.journal(
        routeId,
        stopId,
        'stop_unloaded',
        { loadingStatus: 'loaded', loadedAt: stop.loadedAt, routeStatus: route.status },
        { loadingStatus: 'pending', loadedAt: null, routeStatus: 'loading' },
      );
    });
    return { idempotent: actionId === null, actionId };
  }
}

export class MarkStopNotLoaded extends WorkdayCommand {
  async execute(
    routeId: string,
    stopId: string,
    reason: LoadingFailureReason,
  ): Promise<{ idempotent: boolean; actionId: string | null; allResolved: boolean }> {
    if (!isLoadingFailureReason(reason)) {
      throw new RouteCommandError('INVALID_STOP', 'Pasirinkite nepakrovimo priežastį.');
    }
    const route = await this.route(routeId);
    const stop = await this.stop(routeId, stopId);
    if (!['loading', 'loaded'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Nepakrautą krovinį galima žymėti tik krovimo ekrane.');
    }
    if (stop.deliveryStatus === 'failed' && stop.failureReason === reason && stop.loadingStatus === 'pending') {
      return { idempotent: true, actionId: null, allResolved: route.status === 'loaded' };
    }

    const now = this.clock();
    let actionId: string | null = null;
    let allResolved = false;
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE delivery_stops SET loading_status = 'pending', loaded_at = NULL,
         delivery_status = 'failed', delivered_at = NULL, failed_at = ?,
         failure_reason = ?, failure_comment = NULL, updated_at = ?
         WHERE id = ? AND route_id = ?`,
        now,
        reason,
        now,
        stopId,
        routeId,
      );
      await refreshRemaining(this.db, routeId, now);
      const unresolved = await this.db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending' AND loading_status <> 'loaded'",
        routeId,
      );
      allResolved = (unresolved?.count ?? 0) === 0;
      if (allResolved && route.status === 'loading') {
        assertRouteTransition('loading', 'loaded');
        await this.db.runAsync("UPDATE routes SET status = 'loaded', updated_at = ? WHERE id = ? AND status = 'loading'", now, routeId);
      }
      actionId = await this.journal(
        routeId,
        stopId,
        'stop_not_loaded',
        { ...stopState(stop), loadingStatus: stop.loadingStatus, loadedAt: stop.loadedAt, routeStatus: route.status },
        { deliveryStatus: 'failed', deliveredAt: null, failedAt: now, failureReason: reason, failureComment: null,
          loadingStatus: 'pending', loadedAt: null, routeStatus: allResolved ? 'loaded' : 'loading' },
        true,
      );
    });
    return { idempotent: false, actionId, allResolved };
  }
}

export class SaveStartOdometer extends WorkdayCommand {
  async execute(routeId: string, value: number): Promise<{ idempotent: boolean }> {
    validateOdometer(value);
    const route = await this.route(routeId);
    if (!['loaded', 'in_progress'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pradinį odometrą galima įvesti tik pakrovus maršrutą.');
    }
    if (route.startOdometer === value && route.startOdometerRecordedAt) return { idempotent: true };
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE routes SET start_odometer = ?, start_odometer_recorded_at = ?,
         start_odometer_skipped_at = NULL, updated_at = ? WHERE id = ?`,
        value,
        now,
        now,
        routeId,
      );
      await this.journal(routeId, null, 'start_odometer_recorded', { value: route.startOdometer }, { value });
    });
    await new RefreshRouteEtas(this.db, this.clock).execute(routeId);
    return { idempotent: false };
  }
}

export class SkipStartOdometer extends WorkdayCommand {
  async execute(routeId: string): Promise<{ idempotent: boolean }> {
    const route = await this.route(routeId);
    if (!['loaded', 'in_progress'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Odometrą galima praleisti tik pakrovus maršrutą.');
    }
    if (route.startOdometerSkippedAt && route.startOdometer === null) return { idempotent: true };
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE routes SET start_odometer = NULL, start_odometer_recorded_at = NULL,
         start_odometer_skipped_at = ?, updated_at = ? WHERE id = ?`,
        now,
        now,
        routeId,
      );
      await this.journal(routeId, null, 'start_odometer_skipped', {}, { skippedAt: now });
    });
    return { idempotent: false };
  }
}

export class StartRoute extends WorkdayCommand {
  async execute(routeId: string): Promise<{ idempotent: boolean }> {
    const route = await this.route(routeId);
    if (route.status === 'in_progress') return { idempotent: true };
    if (route.status !== 'loaded') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Maršrutą galima pradėti tik užbaigus krovimą.');
    }
    if (route.startOdometer === null) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Prieš pradėdami įveskite pradinį odometrą.');
    }
    const pending = await this.db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending' AND loading_status <> 'loaded'",
      routeId,
    );
    if ((pending?.count ?? 0) > 0) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Prieš pradėdami pakraukite visus taškus.');
    }
    assertRouteTransition('loaded', 'in_progress');
    const stops = await this.routes.getStops(routeId);
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO route_order_snapshots (
          id, route_id, kind, ordered_stop_ids_json, created_at
        ) VALUES (?, ?, 'manual', ?, ?)`,
        this.idFactory('snapshot'),
        routeId,
        JSON.stringify(stops.map((stop) => stop.id)),
        now,
      );
      await this.db.runAsync(
        `UPDATE routes SET status = 'in_progress', started_at = ?,
         active_sequence_snapshot_at = ?, updated_at = ? WHERE id = ? AND status = 'loaded'`,
        now,
        now,
        now,
        routeId,
      );
      await this.journal(routeId, null, 'route_started', { status: 'loaded' }, { status: 'in_progress', startedAt: now });
    });
    await new RefreshRouteEtas(this.db, this.clock).execute(routeId);
    return { idempotent: false };
  }
}

export class ReverseStopOrder extends WorkdayCommand {
  /** Flips the whole active delivery sequence end-to-end, before the route is started. */
  async execute(routeId: string): Promise<void> {
    const route = await this.route(routeId);
    if (!['loading', 'loaded'].includes(route.status)) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Kryptį apsukti galima tik prieš pradedant maršrutą.');
    }
    const stops = await this.routes.getStops(routeId);
    if (stops.length === 0) return;
    const now = this.clock();
    const total = stops.length;
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('UPDATE delivery_stops SET active_order = NULL WHERE route_id = ?', routeId);
      for (const [index, stop] of stops.entries()) {
        await this.db.runAsync(
          'UPDATE delivery_stops SET active_order = ?, updated_at = ? WHERE id = ? AND route_id = ?',
          total - index,
          now,
          stop.id,
          routeId,
        );
      }
      await this.db.runAsync('UPDATE routes SET updated_at = ? WHERE id = ?', now, routeId);
      await this.journal(
        routeId,
        null,
        'stop_order_reversed',
        { orderedStopIds: stops.map((item) => item.id) },
        { orderedStopIds: [...stops.map((item) => item.id)].reverse() },
      );
    });
  }
}

export type AddStopDuringDeliveryInput = {
  originalAddress: string;
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  weightKg: number | null;
  recipient?: string | null;
  notes?: string | null;
};

export class AddStopDuringDelivery extends WorkdayCommand {
  /** Lets the driver add a new stop (e.g. an unplanned pickup) once the route is already in progress. */
  async execute(routeId: string, input: AddStopDuringDeliveryInput): Promise<{ stopId: string }> {
    const route = await this.route(routeId);
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Naują tašką galima pridėti tik vykdomame maršrute.');
    }
    if (!input.originalAddress.trim() || !input.normalizedAddress.trim()) {
      throw new RouteCommandError('INVALID_STOP', 'Adresas privalomas.');
    }
    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
      throw new RouteCommandError('INVALID_STOP', 'Adreso koordinatės nepatvirtintos.');
    }
    if (input.weightKg !== null && (!Number.isFinite(input.weightKg) || input.weightKg < 0)) {
      throw new RouteCommandError('INVALID_STOP', 'Svoris turi būti teigiamas skaičius.');
    }
    const stopId = this.idFactory('stop');
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      const orders = await this.db.getFirstAsync<{ maxOriginal: number; maxActive: number }>(
        `SELECT COALESCE(MAX(original_order), 0) AS maxOriginal, COALESCE(MAX(active_order), 0) AS maxActive
         FROM delivery_stops WHERE route_id = ?`,
        routeId,
      );
      const originalOrder = (orders?.maxOriginal ?? 0) + 1;
      const activeOrder = (orders?.maxActive ?? 0) + 1;
      await this.db.runAsync(
        `INSERT INTO delivery_stops (
          id, route_id, original_order, active_order, recipient, address,
          original_address, geocoding_query, normalized_address, address_validation_state,
          latitude, longitude, weight_kg, notes, loading_status, delivery_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_confirmed', ?, ?, ?, ?, 'loaded', 'pending', ?, ?)`,
        stopId,
        routeId,
        originalOrder,
        activeOrder,
        input.recipient?.trim() || '',
        input.normalizedAddress,
        input.originalAddress,
        input.originalAddress,
        input.normalizedAddress,
        input.latitude,
        input.longitude,
        input.weightKg,
        input.notes?.trim() || null,
        now,
        now,
      );
      // Recomputed directly from delivery_status, unlike the draft-phase
      // updateRouteTotals() in route-commands.ts which treats every stop as
      // "remaining" — that would be wrong here since some stops are already
      // delivered/failed.
      await this.db.runAsync(
        `UPDATE routes SET
          total_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM delivery_stops WHERE route_id = ?), 0),
          total_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ?),
          remaining_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending'), 0),
          remaining_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending'),
          unknown_weight_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND weight_kg IS NULL),
          remaining_unknown_weight_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND weight_kg IS NULL AND delivery_status = 'pending'),
          updated_at = ?
        WHERE id = ?`,
        routeId, routeId, routeId, routeId, routeId, routeId, now, routeId,
      );
      await this.journal(routeId, stopId, 'stop_added_during_delivery', {}, { ...input, stopId });
    });
    return { stopId };
  }
}

export class MarkStopDelivered extends WorkdayCommand {
  async execute(routeId: string, stopId: string): Promise<{ idempotent: boolean; actionId: string | null }> {
    const route = await this.route(routeId);
    const stop = await this.stop(routeId, stopId);
    if (stop.deliveryStatus === 'delivered') return { idempotent: true, actionId: null };
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pristatymą galima žymėti tik pradėtame maršrute.');
    }
    const now = this.clock();
    const attemptId = this.idFactory('attempt');
    let actionId = '';
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE delivery_stops SET delivery_status = 'delivered', delivered_at = ?,
         updated_at = ?
         WHERE id = ? AND route_id = ?`,
        now,
        now,
        stopId,
        routeId,
      );
      await this.db.runAsync(
        `INSERT INTO delivery_attempts (id, route_id, stop_id, result, created_at)
         VALUES (?, ?, ?, 'delivered', ?)`,
        attemptId,
        routeId,
        stopId,
        now,
      );
      await refreshRemaining(this.db, routeId, now);
      actionId = await this.journal(routeId, stopId, 'stop_delivered', stopState(stop), {
        deliveryStatus: 'delivered', deliveredAt: now, failedAt: stop.failedAt,
        failureReason: stop.failureReason, failureComment: stop.failureComment, attemptId,
      }, true);
    });
    await new RefreshRouteEtas(this.db, this.clock).execute(routeId);
    return { idempotent: false, actionId };
  }
}

export class MarkStopFailed extends WorkdayCommand {
  async execute(
    routeId: string,
    stopId: string,
    input: { reason: string; comment?: string },
  ): Promise<{ idempotent: boolean; actionId: string | null }> {
    const reason = input.reason.trim();
    const comment = input.comment?.trim() ?? '';
    if (!isDeliveryFailureReason(reason)) {
      throw new RouteCommandError('INVALID_STOP', 'Pasirinkite vieną iš pateiktų nepavykimo priežasčių.');
    }
    if (!comment && reason === 'Kita') {
      throw new RouteCommandError('INVALID_STOP', 'Nepavykusio pristatymo komentaras arba aiški priežastis yra privaloma.');
    }
    const route = await this.route(routeId);
    const stop = await this.stop(routeId, stopId);
    if (stop.deliveryStatus === 'failed' && stop.failureReason === reason && stop.failureComment === comment) {
      return { idempotent: true, actionId: null };
    }
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pristatymą galima žymėti tik pradėtame maršrute.');
    }
    const now = this.clock();
    const attemptId = this.idFactory('attempt');
    let actionId = '';
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `UPDATE delivery_stops SET delivery_status = 'failed', failed_at = ?,
         delivered_at = NULL, failure_reason = ?, failure_comment = ?, updated_at = ?
         WHERE id = ? AND route_id = ?`,
        now,
        reason,
        comment || null,
        now,
        stopId,
        routeId,
      );
      await this.db.runAsync(
        `INSERT INTO delivery_attempts (id, route_id, stop_id, result, failure_comment, created_at)
         VALUES (?, ?, ?, 'failed', ?, ?)`,
        attemptId,
        routeId,
        stopId,
        comment || reason,
        now,
      );
      await refreshRemaining(this.db, routeId, now);
      actionId = await this.journal(routeId, stopId, 'stop_failed', stopState(stop), {
        deliveryStatus: 'failed', deliveredAt: null, failedAt: now,
        failureReason: reason, failureComment: comment || null, attemptId,
      }, true);
    });
    await new RefreshRouteEtas(this.db, this.clock).execute(routeId);
    return { idempotent: false, actionId };
  }
}

export class UndoRouteAction extends WorkdayCommand {
  async execute(actionId: string): Promise<{ idempotent: boolean }> {
    const action = await this.db.getFirstAsync<{
      id: string; route_id: string; stop_id: string | null; action_type: string;
      before_json: string; after_json: string; created_at: string;
      undo_expires_at: string | null; undone_at: string | null;
    }>('SELECT * FROM action_journal WHERE id = ?', actionId);
    const undoableTypes = ['stop_loaded', 'stop_not_loaded', 'stop_delivered', 'stop_failed', 'all_stops_loaded'];
    if (!action || !undoableTypes.includes(action.action_type)) {
      throw new RouteCommandError('INVALID_STOP', 'Atšaukiamas veiksmas nerastas.');
    }
    if (action.action_type !== 'all_stops_loaded' && !action.stop_id) {
      throw new RouteCommandError('INVALID_STOP', 'Atšaukiamas veiksmas nerastas.');
    }
    if (action.undone_at) return { idempotent: true };
    const now = this.clock();
    if (!action.undo_expires_at || action.undo_expires_at < now) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Veiksmo atšaukimo laikas jau pasibaigė.');
    }
    if (action.action_type === 'all_stops_loaded') {
      const later = await this.db.getFirstAsync<{ id: string }>(
        `SELECT id FROM action_journal
         WHERE route_id = ? AND undone_at IS NULL
           AND action_type IN ('stop_loaded','stop_not_loaded','stop_unloaded','all_stops_loaded','route_started')
           AND (created_at > ? OR (created_at = ? AND id > ?))
         LIMIT 1`,
        action.route_id,
        action.created_at,
        action.created_at,
        action.id,
      );
      if (later) throw new RouteCommandError('INVALID_ROUTE_STATE', 'Po šio veiksmo maršrutas jau buvo pakeistas dar kartą.');
      const before = JSON.parse(action.before_json) as { routeStatus?: string; changedStopIds?: string[] };
      const after = JSON.parse(action.after_json) as { changedStopIds?: string[] };
      const changedStopIds = after.changedStopIds ?? before.changedStopIds ?? [];
      const route = await this.route(action.route_id);
      if (route.status === 'in_progress') {
        throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pradėjus maršrutą pakrovimo veiksmo atšaukti nebegalima.');
      }
      await this.db.withTransactionAsync(async () => {
        for (const stopId of changedStopIds) {
          await this.db.runAsync(
            `UPDATE delivery_stops SET loading_status = 'pending', loaded_at = NULL, updated_at = ?
             WHERE id = ? AND route_id = ? AND loading_status = 'loaded' AND delivery_status = 'pending'`,
            now,
            stopId,
            action.route_id,
          );
        }
        await refreshRemaining(this.db, action.route_id, now);
        if (route.status === 'loaded' && before.routeStatus === 'loading') {
          await this.db.runAsync(
            "UPDATE routes SET status = 'loading', updated_at = ? WHERE id = ? AND status = 'loaded'",
            now,
            action.route_id,
          );
        }
        await this.db.runAsync('UPDATE action_journal SET undone_at = ? WHERE id = ? AND undone_at IS NULL', now, action.id);
        await this.journal(action.route_id, null, 'undo_applied', { actionId }, { restored: before });
      });
      await new RefreshRouteEtas(this.db, this.clock).execute(action.route_id);
      return { idempotent: false };
    }
    const later = await this.db.getFirstAsync<{ id: string }>(
      `SELECT id FROM action_journal
       WHERE route_id = ? AND stop_id = ? AND undone_at IS NULL
         AND (created_at > ? OR (created_at = ? AND id > ?))
       LIMIT 1`,
      action.route_id,
      action.stop_id,
      action.created_at,
      action.created_at,
      action.id,
    );
    if (later) throw new RouteCommandError('INVALID_ROUTE_STATE', 'Po šio veiksmo taškas jau buvo pakeistas dar kartą.');
    const before = JSON.parse(action.before_json) as Record<string, unknown>;
    const after = JSON.parse(action.after_json) as Record<string, unknown>;
    const route = await this.route(action.route_id);
    if (action.action_type === 'stop_loaded' && route.status === 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pradėjus maršrutą pakrovimo veiksmo atšaukti nebegalima.');
    }
    await this.db.withTransactionAsync(async () => {
      if (action.action_type === 'stop_loaded' || action.action_type === 'stop_not_loaded') {
        await this.db.runAsync(
          `UPDATE delivery_stops SET loading_status = ?, loaded_at = ?, delivery_status = ?,
           delivered_at = ?, failed_at = ?, failure_reason = ?, failure_comment = ?, updated_at = ? WHERE id = ?`,
          String(before.loadingStatus),
          nullableString(before.loadedAt),
          String(before.deliveryStatus),
          nullableString(before.deliveredAt),
          nullableString(before.failedAt),
          nullableString(before.failureReason),
          nullableString(before.failureComment),
          now,
          action.stop_id,
        );
        await refreshRemaining(this.db, action.route_id, now);
        if (route.status === 'loaded' && before.routeStatus === 'loading') {
          await this.db.runAsync("UPDATE routes SET status = 'loading', updated_at = ? WHERE id = ? AND status = 'loaded'", now, action.route_id);
        }
      } else {
        await this.db.runAsync(
          `UPDATE delivery_stops SET delivery_status = ?, delivered_at = ?, failed_at = ?,
           failure_reason = ?, failure_comment = ?, updated_at = ? WHERE id = ?`,
          String(before.deliveryStatus),
          nullableString(before.deliveredAt),
          nullableString(before.failedAt),
          nullableString(before.failureReason),
          nullableString(before.failureComment),
          now,
          action.stop_id,
        );
        if (typeof after.attemptId === 'string') {
          await this.db.runAsync('UPDATE delivery_attempts SET undone_at = ? WHERE id = ?', now, after.attemptId);
        }
        await refreshRemaining(this.db, action.route_id, now);
      }
      await this.db.runAsync('UPDATE action_journal SET undone_at = ? WHERE id = ? AND undone_at IS NULL', now, action.id);
      await this.journal(action.route_id, action.stop_id, 'undo_applied', { actionId }, { restored: before });
    });
    await new RefreshRouteEtas(this.db, this.clock).execute(action.route_id);
    return { idempotent: false };
  }
}

export class GetLatestUndoableAction extends WorkdayCommand {
  async execute(routeId: string): Promise<UndoableAction | null> {
    const now = this.clock();
    const row = await this.db.getFirstAsync<{
      id: string; route_id: string; stop_id: string | null; action_type: UndoableAction['actionType'];
      created_at: string; undo_expires_at: string;
    }>(
      `SELECT id, route_id, stop_id, action_type, created_at, undo_expires_at
       FROM action_journal WHERE route_id = ?
       AND action_type IN ('stop_loaded','stop_not_loaded','stop_delivered','stop_failed','all_stops_loaded')
       AND undone_at IS NULL AND undo_expires_at >= ?
       AND (stop_id IS NOT NULL OR action_type = 'all_stops_loaded')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      routeId,
      now,
    );
    return row ? {
      id: row.id,
      routeId: row.route_id,
      stopId: row.stop_id,
      actionType: row.action_type,
      createdAt: row.created_at,
      undoExpiresAt: row.undo_expires_at,
    } : null;
  }
}

export class GetRouteProgress extends WorkdayCommand {
  async execute(routeId: string): Promise<RouteProgress> {
    const route = await this.route(routeId);
    const stops = await this.routes.getStops(routeId);
    const loaded = stops.filter((stop) => stop.loadingStatus === 'loaded');
    const notLoaded = stops.filter((stop) => stop.loadingStatus === 'pending' && stop.deliveryStatus === 'failed');
    const loadingResolved = [...loaded, ...notLoaded];
    const delivered = stops.filter((stop) => stop.deliveryStatus === 'delivered');
    const remaining = stops.filter((stop) => stop.deliveryStatus === 'pending');
    return {
      totalStops: stops.length,
      loadedStops: loaded.length,
      notLoadedStops: notLoaded.length,
      loadingResolvedStops: loadingResolved.length,
      deliveredStops: delivered.length,
      failedStops: stops.filter((stop) => stop.deliveryStatus === 'failed').length,
      remainingStops: remaining.length,
      totalKnownWeightKg: sumKnown(stops),
      loadedKnownWeightKg: sumKnown(loaded),
      remainingKnownWeightKg: sumKnown(remaining),
      totalUnknownWeightStops: stops.filter((stop) => stop.weightKg === null).length,
      loadedUnknownWeightStops: loaded.filter((stop) => stop.weightKg === null).length,
      remainingUnknownWeightStops: remaining.filter((stop) => stop.weightKg === null).length,
      loadingPercent: percent(loadingResolved.length, stops.length),
      deliveryPercent: percent(delivered.length, stops.length),
      preliminaryRemainingDistanceKm: route.estimatedDistanceKm === null || stops.length === 0
        ? null
        : round(route.estimatedDistanceKm * remaining.length / stops.length),
    };
  }
}

export class CompleteRoute extends WorkdayCommand {
  async execute(
    routeId: string,
    input: { endOdometer: number; confirmUnfinished?: boolean; confirmLargeDifference?: boolean },
  ): Promise<{ idempotent: boolean; summary: RouteCompletionSummary }> {
    validateOdometer(input.endOdometer);
    const route = await this.route(routeId);
    if (route.status === 'completed' && route.completionSummary) {
      return { idempotent: true, summary: route.completionSummary };
    }
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Užbaigti galima tik pradėtą maršrutą.');
    }
    if (route.startOdometer !== null && input.endOdometer < route.startOdometer) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Galutinis odometras negali būti mažesnis už pradinį.');
    }
    const stops = await this.routes.getStops(routeId);
    const unfinished = stops.filter((stop) => stop.deliveryStatus !== 'delivered');
    if (unfinished.length > 0 && !input.confirmUnfinished) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Yra nepristatytų taškų. Patvirtinkite, kad maršrutą vis tiek baigiate.', {
        unfinishedStops: String(unfinished.length),
      });
    }
    const actual = route.startOdometer === null ? null : round(input.endOdometer - route.startOdometer);
    const suspiciousThreshold = Math.max((route.estimatedDistanceKm ?? 0) * 3, 500);
    if (actual !== null && actual > suspiciousThreshold && !input.confirmLargeDifference) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Odometrų skirtumas atrodo neįprastai didelis. Patvirtinkite rodmenį.', {
        actualDistanceKm: String(actual),
      });
    }
    const delivered = stops.filter((stop) => stop.deliveryStatus === 'delivered');
    const failed = stops.filter((stop) => stop.deliveryStatus === 'failed');
    let onTimeStops = 0;
    let lateStops = 0;
    for (const stop of delivered) {
      const punctuality = completionPunctuality(stop);
      if (punctuality === 'on_time') onTimeStops += 1;
      if (punctuality === 'late') lateStops += 1;
    }
    const now = this.clock();
    const plannedDurationMinutes = route.estimatedDurationMinutes;
    const actualDurationMinutes = route.startedAt
      ? Math.round((Date.parse(now) - Date.parse(route.startedAt)) / 60_000)
      : null;
    const summary: RouteCompletionSummary = {
      totalStops: stops.length,
      deliveredStops: delivered.length,
      failedStops: failed.length,
      unmarkedStops: stops.filter((stop) => stop.deliveryStatus === 'pending').length,
      deliveredKnownWeightKg: sumKnown(delivered),
      undeliveredKnownWeightKg: sumKnown(unfinished),
      unknownWeightStops: stops.filter((stop) => stop.weightKg === null).length,
      plannedDistanceKm: route.estimatedDistanceKm,
      actualDistanceKm: actual,
      onTimeStops,
      lateStops,
      plannedDurationMinutes,
      actualDurationMinutes,
      durationDeviationMinutes:
        plannedDurationMinutes === null || actualDurationMinutes === null
          ? null
          : actualDurationMinutes - plannedDurationMinutes,
      distanceDeviationKm:
        route.estimatedDistanceKm === null || actual === null
          ? null
          : round(actual - route.estimatedDistanceKm),
    };
    assertRouteTransition('in_progress', 'completed');
    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `UPDATE routes SET status = 'completed', end_odometer = ?,
         end_odometer_recorded_at = ?, actual_distance_km = ?,
         completion_summary_json = ?, completion_end_odometer_draft = NULL,
         completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'in_progress'`,
        input.endOdometer,
        now,
        actual,
        JSON.stringify(summary),
        now,
        now,
        routeId,
      );
      if (result.changes !== 1) {
        throw new RouteCommandError('INVALID_ROUTE_STATE', 'Maršruto būsena jau pasikeitė.');
      }
      await this.journal(routeId, null, 'route_completed', { status: 'in_progress' }, {
        status: 'completed', endOdometer: input.endOdometer, summary,
      });
    });
    return { idempotent: false, summary };
  }
}

export class StartRouteReturn extends WorkdayCommand {
  async execute(
    routeId: string,
    destinationKind: 'warehouse' | 'home',
    destination: RouteEndpoint,
  ): Promise<{ idempotent: boolean; destination: RouteEndpoint }> {
    const route = await this.route(routeId);
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Grįžimą galima pradėti tik vykdomam maršrutui.');
    }
    if (route.remainingStops > 0) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pirmiausia užbaikite visus pristatymo taškus.');
    }
    if (!destination.originalAddress.trim()) throw new Error('Grįžimo adresas nenurodytas.');
    if (route.returnStartedAt && route.endLocation) {
      return { idempotent: true, destination: route.endLocation };
    }
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `UPDATE routes SET return_destination_kind = ?, return_started_at = ?,
         return_arrived_at = NULL, end_location_json = ?, updated_at = ?
         WHERE id = ? AND status = 'in_progress' AND return_started_at IS NULL`,
        destinationKind,
        now,
        JSON.stringify(destination),
        now,
        routeId,
      );
      if (result.changes !== 1) throw new RouteCommandError('INVALID_ROUTE_STATE', 'Grįžimo būsena jau pasikeitė.');
      await this.journal(routeId, null, 'route_return_started', {}, { destinationKind, destination, startedAt: now });
    });
    return { idempotent: false, destination };
  }
}

export class ConfirmRouteReturnArrival extends WorkdayCommand {
  async execute(routeId: string): Promise<{ idempotent: boolean; arrivedAt: string }> {
    const route = await this.route(routeId);
    if (route.status !== 'in_progress' || !route.returnStartedAt) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Pirmiausia pasirinkite grįžimo vietą ir paleiskite navigaciją.');
    }
    if (route.returnArrivedAt) return { idempotent: true, arrivedAt: route.returnArrivedAt };
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `UPDATE routes SET return_arrived_at = ?, completion_started_at = COALESCE(completion_started_at, ?), updated_at = ?
         WHERE id = ? AND status = 'in_progress' AND return_started_at IS NOT NULL AND return_arrived_at IS NULL`,
        now,
        now,
        now,
        routeId,
      );
      if (result.changes !== 1) throw new RouteCommandError('INVALID_ROUTE_STATE', 'Grįžimo būsena jau pasikeitė.');
      await this.journal(routeId, null, 'route_return_arrived', {}, { arrivedAt: now });
    });
    return { idempotent: false, arrivedAt: now };
  }
}

export class BeginRouteCompletion extends WorkdayCommand {
  async execute(routeId: string): Promise<{ idempotent: boolean; startedAt: string }> {
    const route = await this.route(routeId);
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Užbaigimą galima pradėti tik vykdomam maršrutui.');
    }
    if (route.completionStartedAt) {
      return { idempotent: true, startedAt: route.completionStartedAt };
    }
    const now = this.clock();
    await this.db.withTransactionAsync(async () => {
      const result = await this.db.runAsync(
        `UPDATE routes SET completion_started_at = ?, updated_at = ?
         WHERE id = ? AND status = 'in_progress' AND completion_started_at IS NULL`,
        now,
        now,
        routeId,
      );
      if (result.changes !== 1) {
        const current = await this.route(routeId);
        if (current.status !== 'in_progress' || !current.completionStartedAt) {
          throw new RouteCommandError('INVALID_ROUTE_STATE', 'Maršruto būsena jau pasikeitė.');
        }
        return;
      }
      await this.journal(routeId, null, 'route_completion_started', {}, { startedAt: now });
    });
    const refreshed = await this.route(routeId);
    return { idempotent: false, startedAt: refreshed.completionStartedAt ?? now };
  }
}

export class SaveCompletionOdometerDraft extends WorkdayCommand {
  async execute(routeId: string, value: string): Promise<void> {
    const route = await this.route(routeId);
    if (route.status !== 'in_progress') {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Odometrą galima keisti tik vykdomam maršrutui.');
    }
    const normalized = value.trim();
    if (normalized.length > 20 || (normalized && !/^\d+(?:[.,]\d?)?$/.test(normalized))) {
      throw new Error('Odometras turi būti skaičius su ne daugiau kaip viena dešimtaine dalimi.');
    }
    const now = this.clock();
    const result = await this.db.runAsync(
      `UPDATE routes SET completion_started_at = COALESCE(completion_started_at, ?),
       completion_end_odometer_draft = ?, updated_at = ?
       WHERE id = ? AND status = 'in_progress'`,
      now,
      normalized || null,
      now,
      routeId,
    );
    if (result.changes !== 1) {
      throw new RouteCommandError('INVALID_ROUTE_STATE', 'Maršruto būsena jau pasikeitė.');
    }
  }
}

export function parseOdometer(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d)?$/.test(normalized)) throw new Error('Įveskite kilometrus sveiku skaičiumi arba su viena dešimtaine dalimi.');
  const parsed = Number(normalized);
  validateOdometer(parsed);
  return parsed;
}

function validateOdometer(value: number): void {
  if (!Number.isFinite(value) || value < 0 || Math.round(value * 10) !== value * 10) {
    throw new Error('Odometras turi būti neneigiamas skaičius su ne daugiau kaip viena dešimtaine dalimi.');
  }
}

function completionPunctuality(stop: DeliveryStop): 'on_time' | 'late' | 'unknown' {
  if (!stop.deliveredAt) return 'unknown';
  const deliveredMs = Date.parse(stop.deliveredAt);
  if (!Number.isFinite(deliveredMs)) return 'unknown';
  if (stop.deliveryTimeTo) {
    const [hours, minutes] = stop.deliveryTimeTo.split(':').map(Number);
    if (Number.isInteger(hours) && Number.isInteger(minutes)) {
      const deadline = new Date(stop.deliveredAt);
      deadline.setHours(hours!, minutes!, 0, 0);
      const slackMs = deliveredMs - deadline.getTime();
      if (slackMs <= 5 * 60_000) return 'on_time';
      return 'late';
    }
  }
  if (stop.plannedArrivalAt) {
    const plannedMs = Date.parse(stop.plannedArrivalAt);
    if (Number.isFinite(plannedMs)) {
      const diffMinutes = Math.round((deliveredMs - plannedMs) / 60_000);
      if (diffMinutes <= 5) return 'on_time';
      if (diffMinutes > 5) return 'late';
    }
  }
  return 'unknown';
}

function stopState(stop: DeliveryStop): Record<string, unknown> {
  return {
    deliveryStatus: stop.deliveryStatus,
    deliveredAt: stop.deliveredAt,
    failedAt: stop.failedAt,
    failureReason: stop.failureReason,
    failureComment: stop.failureComment,
  };
}

async function refreshRemaining(db: SQLiteDatabase, routeId: string, now: string): Promise<void> {
  await db.runAsync(
    `UPDATE routes SET
      remaining_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending'),
      remaining_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending'), 0),
      remaining_unknown_weight_stops = (SELECT COUNT(*) FROM delivery_stops WHERE route_id = ? AND delivery_status = 'pending' AND weight_kg IS NULL),
      updated_at = ? WHERE id = ?`,
    routeId,
    routeId,
    routeId,
    now,
    routeId,
  );
}

function sumKnown(stops: DeliveryStop[]): number {
  return round(stops.reduce((total, stop) => total + (stop.weightKg ?? 0), 0));
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : Math.round(value / total * 100);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
