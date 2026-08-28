import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { buildNavigationUrls, navigationTargetFromStop, NavigationTargetError } from '../../src/application/navigation/navigation-url-builder';
import { CreateDraftRoute, ReopenRouteForPlanning, ReplaceDraftStops, SetStopPriority, type DraftStopInput } from '../../src/application/routes/route-commands';
import { ExportPilotRouteDiagnostic } from '../../src/application/routes/pilot-route-export';
import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
import { GetDefaultLocations, PlanningModePreference, ResolveRouteLocations, RouteEndPreference, SaveDefaultLocation, type EndLocationChoice, type StartLocationChoice } from '../../src/application/routes/saved-locations';
import {
  BeginRouteCompletion,
  CompleteRoute,
  AdminCompleteRoute,
  ConfirmRouteReturnArrival,
  GetLatestUndoableAction,
  GetRouteProgress,
  MarkAllStopsLoaded,
  MarkStopDelivered,
  MarkStopFailed,
  AddStopDuringDelivery,
  MarkStopLoaded,
  MarkStopNotLoaded,
  MarkStopUnloaded,
  parseOdometer,
  ReverseStopOrder,
  ReorderRemainingStops,
  SaveCompletionOdometerDraft,
  SaveStartOdometer,
  SetNextPendingStop,
  SkipStartOdometer,
  StartRoute,
  StartRouteReturn,
  UndoRouteAction,
} from '../../src/application/routes/route-workday';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import type { RouteEndpoint } from '../../src/domain/route';
import { failedDeliveryLabel } from '../../src/ui/route-labels';

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

const migrationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'),
  'utf8',
);

function migration(name: string): string {
  const match = migrationSource.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}

function createDb(through = 27): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= through; version += 1) adapter.raw.exec(migration(`migrationV${version}`));
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const endpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai', geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva', latitude: 55.93, longitude: 23.31,
};

function stop(id: string, order: number, weightKg: number | null): DraftStopInput {
  return {
    id, originalOrder: order, orderNumber: `U-${order}`, recipient: `Gavėjas ${order}`,
    originalAddress: `Tilžės g. ${order}, Šiauliai`, geocodingQuery: `Tilžės g. ${order}, Šiauliai`,
    normalizedAddress: `Tilžės g. ${order}, Šiauliai, Lietuva`, addressValidationState: 'auto_confirmed',
    latitude: 55.93 + order / 1000, longitude: 23.31 + order / 1000,
    deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false,
    weightKg, phone: null, notes: null,
  };
}

async function loadingRoute(db: SQLiteDatabase) {
  await new CreateDraftRoute(db).execute({ id: 'route-1', startLocation: endpoint, endLocation: endpoint });
  let stopNumber = 0;
  await new ReplaceDraftStops(db, undefined, (prefix) => prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`)
    .execute('route-1', [stop('stop-1', 1, 10), stop('stop-2', 2, null)]);
  await db.runAsync("UPDATE routes SET status = 'loading', estimated_distance_km = 40 WHERE id = 'route-1'");
}

async function startedRoute(db: SQLiteDatabase) {
  await loadingRoute(db);
  await new MarkStopLoaded(db).execute('route-1', 'stop-1');
  await new MarkStopLoaded(db).execute('route-1', 'stop-2');
  await new SaveStartOdometer(db).execute('route-1', 1000.5);
  await new StartRoute(db).execute('route-1');
}

async function arriveAtRouteEnd(db: SQLiteDatabase) {
  await new StartRouteReturn(db).execute('route-1', 'warehouse', endpoint);
  await new ConfirmRouteReturnArrival(db).execute('route-1');
}

describe('driver workday persistence', () => {
  it('migrates the product defaults and remembers the preferred route end', async () => {
    const { adapter, db } = createDb(9);
    adapter.raw.exec(migration('migrationV10'));
    adapter.raw.exec(migration('migrationV11'));
    const defaults = await new GetDefaultLocations(db).execute();
    expect(defaults.warehouse?.endpoint.originalAddress).toBe('Savanorių pr. 180, Vilnius');
    expect(defaults.home).toBeNull();
    const preference = new RouteEndPreference(db);
    expect(await preference.get()).toBe('warehouse');
    await preference.save('home', '2026-08-03T10:00:00.000Z');
    expect(await new RouteEndPreference(db).get()).toBe('home');
    const planning = new PlanningModePreference(db);
    expect(await planning.get()).toBe('with_time_windows');
    await planning.save('ignore_time_windows', '2026-08-03T10:01:00.000Z');
    expect(await new PlanningModePreference(db).get()).toBe('ignore_time_windows');
  });

  it('persists warehouse and home separately and resolves selected endpoints', async () => {
    const { db } = createDb();
    const home = { ...endpoint, originalAddress: 'Tilžės g. 109, Šiauliai', geocodingQuery: 'Tilžės g. 109, Šiauliai' };
    await new SaveDefaultLocation(db).execute('warehouse', 'Sandėlis', endpoint);
    await new SaveDefaultLocation(db).execute('home', 'Namai', home);
    const restored = await new GetDefaultLocations(db).execute();
    expect(restored.warehouse?.endpoint.originalAddress).toBe(endpoint.originalAddress);
    expect(restored.home?.endpoint.originalAddress).toBe(home.originalAddress);
    await expect(new ResolveRouteLocations(db).execute({ kind: 'warehouse' }, { kind: 'home' })).resolves.toEqual({
      startLocation: endpoint,
      endLocation: home,
    });
    const resolved = await new ResolveRouteLocations(db).execute({ kind: 'warehouse' }, { kind: 'home' });
    await new CreateDraftRoute(db).execute({ id: 'location-route', ...resolved });
    expect(await new RouteRepository(db).getById('location-route')).toMatchObject({
      startLocation: { originalAddress: endpoint.originalAddress },
      endLocation: { originalAddress: home.originalAddress },
    });
  });

  it('preserves all supported start and end combinations in routing, restart and history', async () => {
    const warehouse = { ...endpoint, originalAddress: 'Sandėlio g. 1, Šiauliai', normalizedAddress: 'Sandėlio g. 1, Šiauliai, Lietuva', latitude: 55.91, longitude: 23.30 };
    const home = { ...endpoint, originalAddress: 'Namų g. 2, Šiauliai', normalizedAddress: 'Namų g. 2, Šiauliai, Lietuva', latitude: 55.92, longitude: 23.31 };
    const current = { ...endpoint, originalAddress: 'Dabartinė vieta', normalizedAddress: 'Dabartinė vieta', latitude: 55.93, longitude: 23.32 };
    const customStart = { ...endpoint, originalAddress: 'Kita pradžia', normalizedAddress: 'Kita pradžia', latitude: 55.94, longitude: 23.33 };
    const customEnd = { ...endpoint, originalAddress: 'Kita pabaiga', normalizedAddress: 'Kita pabaiga', latitude: 55.95, longitude: 23.34 };
    const lastStop = { ...endpoint, originalAddress: 'Paskutinis taškas', normalizedAddress: 'Paskutinis taškas', latitude: 55.96, longitude: 23.35 };
    const cases: [StartLocationChoice, EndLocationChoice, RouteEndpoint, RouteEndpoint][] = [
      [{ kind: 'warehouse' } as const, { kind: 'warehouse' } as const, warehouse, warehouse],
      [{ kind: 'warehouse' } as const, { kind: 'home' } as const, warehouse, home],
      [{ kind: 'current', endpoint: current } as const, { kind: 'home' } as const, current, home],
      [{ kind: 'custom', endpoint: customStart } as const, { kind: 'warehouse' } as const, customStart, warehouse],
      [{ kind: 'warehouse' } as const, { kind: 'last_stop', endpoint: lastStop } as const, warehouse, lastStop],
      [{ kind: 'custom', endpoint: customStart } as const, { kind: 'custom', endpoint: customEnd } as const, customStart, customEnd],
    ];

    for (const [startChoice, endChoice, expectedStart, expectedEnd] of cases) {
      const { db } = createDb();
      await new SaveDefaultLocation(db).execute('warehouse', 'Sandėlis', warehouse);
      await new SaveDefaultLocation(db).execute('home', 'Namai', home);
      const resolved = await new ResolveRouteLocations(db).execute(startChoice, endChoice);
      await new CreateDraftRoute(db).execute({ id: 'combo-route', ...resolved });
      await new ReplaceDraftStops(db, undefined, (prefix) => prefix === 'stop' ? 'combo-stop' : `${prefix}-${Math.random()}`)
        .execute('combo-route', [stop('combo-stop', 1, 10)]);
      const restarted = await new RouteRepository(db).getWithStops('combo-route');
      const request = buildOptimizationRequestFromRoute(restarted!.route, restarted!.stops);
      expect(request.startLocation).toMatchObject({ latitude: expectedStart.latitude, longitude: expectedStart.longitude });
      expect(request.endLocation).toMatchObject({ latitude: expectedEnd.latitude, longitude: expectedEnd.longitude });
      expect(restarted!.route.startLocation?.originalAddress).toBe(expectedStart.originalAddress);
      expect(restarted!.route.endLocation?.originalAddress).toBe(expectedEnd.originalAddress);
      await db.runAsync("UPDATE routes SET status = 'completed', completed_at = '2026-08-03T13:00:00.000Z' WHERE id = 'combo-route'");
      expect((await new RouteRepository(db).listHistory())[0]).toMatchObject({
        startLocation: { originalAddress: expectedStart.originalAddress },
        endLocation: { originalAddress: expectedEnd.originalAddress },
      });
    }
  });

  it('marks loading once, persists it and moves to loaded only after all stops', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    expect(await new MarkStopLoaded(db).execute('route-1', 'stop-1')).toMatchObject({ idempotent: false, allLoaded: false });
    expect(await new MarkStopLoaded(db).execute('route-1', 'stop-1')).toMatchObject({ idempotent: true });
    await new MarkStopLoaded(db).execute('route-1', 'stop-2');
    const afterRestart = await new RouteRepository(db).getWithStops('route-1');
    expect(afterRestart?.route.status).toBe('loaded');
    expect(afterRestart?.stops.every((item) => item.loadingStatus === 'loaded')).toBe(true);
  });

  it('resolves loading with an explicit not-loaded reason and starts with only carried stops', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    const result = await new MarkStopNotLoaded(db).execute('route-1', 'stop-2', 'Nėra prekių');
    expect(result).toMatchObject({ idempotent: false, allResolved: true });
    expect(await new MarkStopNotLoaded(db).execute('route-1', 'stop-2', 'Nėra prekių')).toMatchObject({ idempotent: true });

    const restored = await new RouteRepository(db).getWithStops('route-1');
    expect(restored?.route.status).toBe('loaded');
    expect(restored?.stops.find((item) => item.id === 'stop-2')).toMatchObject({
      loadingStatus: 'pending',
      deliveryStatus: 'failed',
      failureReason: 'Nėra prekių',
    });
    expect(await new GetRouteProgress(db).execute('route-1')).toMatchObject({
      loadedStops: 1,
      notLoadedStops: 1,
      loadingResolvedStops: 2,
      loadingPercent: 100,
      remainingStops: 1,
    });
    await expect(new StartRoute(db).execute('route-1')).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await new SaveStartOdometer(db).execute('route-1', 100);
    await expect(new StartRoute(db).execute('route-1')).resolves.toMatchObject({ idempotent: false });
  });

  it('can restore a not-loaded stop to loaded without losing the route', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    await new MarkStopNotLoaded(db).execute('route-1', 'stop-2', 'Netilpo');
    await new MarkStopLoaded(db).execute('route-1', 'stop-2');
    const restored = await new RouteRepository(db).getWithStops('route-1');
    expect(restored?.route.status).toBe('loaded');
    expect(restored?.stops.find((item) => item.id === 'stop-2')).toMatchObject({
      loadingStatus: 'loaded',
      deliveryStatus: 'pending',
      failureReason: null,
      failedAt: null,
    });
  });

  it('marks only pending stops in one bulk action and preserves route data across restart', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await db.runAsync(
      "UPDATE delivery_stops SET active_order = original_order, planned_arrival_at = '2026-08-03T08:30:00.000Z', latest_estimated_arrival_at = '2026-08-03T08:40:00.000Z' WHERE route_id = 'route-1'",
    );
    await new MarkStopLoaded(db, () => '2026-08-03T07:00:00.000Z', (prefix) => `${prefix}-individual`)
      .execute('route-1', 'stop-1');
    const before = await new RouteRepository(db).getWithStops('route-1');
    const result = await new MarkAllStopsLoaded(
      db,
      () => '2026-08-03T07:05:00.000Z',
      (prefix) => `${prefix}-bulk`,
    ).execute('route-1');

    expect(result).toMatchObject({ idempotent: false, loadedCount: 1, allLoaded: true });
    const afterRestart = await new RouteRepository(db).getWithStops('route-1');
    expect(afterRestart?.route.status).toBe('loaded');
    expect(afterRestart?.stops.every((item) => item.loadingStatus === 'loaded')).toBe(true);
    expect(afterRestart?.stops.find((item) => item.id === 'stop-1')?.loadedAt)
      .toBe(before?.stops.find((item) => item.id === 'stop-1')?.loadedAt);
    for (const item of afterRestart?.stops ?? []) {
      expect(item.deliveryStatus).toBe('pending');
      expect(item.activeOrder).toBe(item.originalOrder);
      expect(item.plannedArrivalAt).toBe('2026-08-03T08:30:00.000Z');
      expect(item.latestEstimatedArrivalAt).toBe('2026-08-03T08:40:00.000Z');
    }
    expect(await new GetRouteProgress(db).execute('route-1')).toMatchObject({ loadedStops: 2, loadingPercent: 100 });
    expect(await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM action_journal WHERE route_id = 'route-1' AND action_type = 'all_stops_loaded'",
    )).toEqual({ count: 1 });

    expect(await new MarkAllStopsLoaded(db).execute('route-1')).toMatchObject({ idempotent: true, loadedCount: 0, allLoaded: true });
    expect(await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM action_journal WHERE route_id = 'route-1' AND action_type = 'all_stops_loaded'",
    )).toEqual({ count: 1 });

    expect(await new MarkStopUnloaded(db).execute('route-1', 'stop-2')).toMatchObject({ idempotent: false });
    expect((await new RouteRepository(db).getById('route-1'))?.status).toBe('loading');
    expect((await new RouteRepository(db).getStops('route-1')).find((item) => item.id === 'stop-2'))
      .toMatchObject({ loadingStatus: 'pending', loadedAt: null });
    expect(await new MarkAllStopsLoaded(db).execute('route-1')).toMatchObject({ idempotent: false, loadedCount: 1, allLoaded: true });
  });

  it('rolls back every bulk loading change when its audit write fails', async () => {
    const { adapter, db } = createDb();
    await loadingRoute(db);
    adapter.raw.exec(`
      CREATE TRIGGER fail_bulk_loading_audit BEFORE INSERT ON action_journal
      WHEN NEW.action_type = 'all_stops_loaded'
      BEGIN SELECT RAISE(ABORT, 'bulk audit failed'); END;
    `);

    await expect(new MarkAllStopsLoaded(db).execute('route-1')).rejects.toThrow('bulk audit failed');
    const restored = await new RouteRepository(db).getWithStops('route-1');
    expect(restored?.route.status).toBe('loading');
    expect(restored?.stops.every((item) => item.loadingStatus === 'pending')).toBe(true);
  });

  it.each([1, 100])('bulk-loads a route with %i stop(s)', async (stopCount) => {
    const { db } = createDb();
    await new CreateDraftRoute(db).execute({ id: 'bulk-size-route', startLocation: endpoint, endLocation: endpoint });
    let generatedId = 0;
    await new ReplaceDraftStops(db, undefined, (prefix) => `${prefix}-${++generatedId}`).execute(
      'bulk-size-route',
      Array.from({ length: stopCount }, (_, index) => stop(`source-${index + 1}`, index + 1, 1)),
    );
    await db.runAsync("UPDATE routes SET status = 'loading' WHERE id = 'bulk-size-route'");

    expect(await new MarkAllStopsLoaded(db).execute('bulk-size-route'))
      .toMatchObject({ idempotent: false, loadedCount: stopCount, allLoaded: true });
    expect(await new GetRouteProgress(db).execute('bulk-size-route'))
      .toMatchObject({ totalStops: stopCount, loadedStops: stopCount, loadingPercent: 100 });
  });

  it('persists loading undo and restores the route state idempotently', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    const action = await new GetLatestUndoableAction(db).execute('route-1');
    expect(action?.actionType).toBe('stop_loaded');
    expect(await new UndoRouteAction(db).execute(action!.id)).toEqual({ idempotent: false });
    expect(await new UndoRouteAction(db).execute(action!.id)).toEqual({ idempotent: true });
    expect((await new RouteRepository(db).getStops('route-1'))[0]?.loadingStatus).toBe('pending');
  });

  it('validates and saves the initial odometer; skip alone cannot start the route', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    await new MarkStopLoaded(db).execute('route-1', 'stop-2');
    expect(parseOdometer('123,4')).toBe(123.4);
    expect(() => parseOdometer('-1')).toThrow();
    expect(() => parseOdometer('12.34')).toThrow();
    await new SkipStartOdometer(db).execute('route-1');
    expect((await new RouteRepository(db).getById('route-1'))?.startOdometerSkippedAt).not.toBeNull();
    await expect(new StartRoute(db).execute('route-1')).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await new SaveStartOdometer(db).execute('route-1', 123.4);
    expect((await new RouteRepository(db).getById('route-1'))).toMatchObject({ startOdometer: 123.4, startOdometerSkippedAt: null });
  });

  it('starts once and cannot mark a delivery before the route starts', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await expect(new MarkStopDelivered(db).execute('route-1', 'stop-1')).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    await new MarkStopLoaded(db).execute('route-1', 'stop-2');
    await expect(new StartRoute(db).execute('route-1')).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await new SaveStartOdometer(db).execute('route-1', 100);
    expect(await new StartRoute(db).execute('route-1')).toEqual({ idempotent: false });
    expect(await new StartRoute(db).execute('route-1')).toEqual({ idempotent: true });
  });

  it('delivers idempotently without removing loading state and keeps unknown weight distinct', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await new MarkStopDelivered(db).execute('route-1', 'stop-2');
    expect(await new MarkStopDelivered(db).execute('route-1', 'stop-2')).toEqual({ idempotent: true, actionId: null });
    const stop2 = (await new RouteRepository(db).getStops('route-1')).find((item) => item.id === 'stop-2');
    expect(stop2).toMatchObject({ loadingStatus: 'loaded', deliveryStatus: 'delivered', weightKg: null });
    const progress = await new GetRouteProgress(db).execute('route-1');
    expect(progress).toMatchObject({ remainingStops: 1, remainingKnownWeightKg: 10, remainingUnknownWeightStops: 0, deliveryPercent: 50 });
  });

  it('requires a valid failure reason, excludes failed from remaining and restores it with undo', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await expect(new MarkStopFailed(db).execute('route-1', 'stop-1', { reason: 'Kita', comment: '' })).rejects.toMatchObject({ code: 'INVALID_STOP' });
    await expect(new MarkStopFailed(db).execute('route-1', 'stop-1', { reason: 'Nerastas gavėjas', comment: '' })).rejects.toMatchObject({ code: 'INVALID_STOP' });
    const failed = await new MarkStopFailed(db).execute('route-1', 'stop-1', { reason: 'Liko sandėlyje', comment: '' });
    expect(await new GetRouteProgress(db).execute('route-1')).toMatchObject({
      remainingStops: 1,
      remainingKnownWeightKg: 0,
      remainingUnknownWeightStops: 1,
      preliminaryRemainingDistanceKm: 20,
    });
    expect((await new RouteRepository(db).getById('route-1'))).toMatchObject({ remainingStops: 1, remainingWeightKg: 0 });
    expect((await new RouteRepository(db).getStops('route-1'))[0]).toMatchObject({ failureReason: 'Liko sandėlyje', failureComment: null });
    await new UndoRouteAction(db).execute(failed.actionId!);
    expect((await new RouteRepository(db).getStops('route-1'))[0]).toMatchObject({ deliveryStatus: 'pending', failureComment: null });
    expect((await new RouteRepository(db).listAudit('route-1')).some((entry) => entry.actionType === 'stop_failed' && entry.undoneAt)).toBe(true);
  });

  it('keeps a failed-attempt comment in audit fields if the stop is later delivered', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await new MarkStopFailed(db).execute('route-1', 'stop-1', { reason: 'Nedirba', comment: 'Durys užrakintos' });
    await new MarkStopDelivered(db).execute('route-1', 'stop-1');
    expect((await new RouteRepository(db).getStops('route-1'))[0]).toMatchObject({
      deliveryStatus: 'delivered',
      failureReason: 'Nedirba',
      failureComment: 'Durys užrakintos',
    });
  });

  it('completes transactionally, rejects negative distance and ignores double completion', async () => {
    const { adapter, db } = createDb(27);
    await startedRoute(db);
    await new MarkStopDelivered(db).execute('route-1', 'stop-1');
    await new MarkStopDelivered(db).execute('route-1', 'stop-2');
    await expect(new CompleteRoute(db).execute('route-1', { endOdometer: 999 })).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await expect(new CompleteRoute(db).execute('route-1', { endOdometer: 1042.5 })).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await arriveAtRouteEnd(db);
    const first = await new CompleteRoute(db).execute('route-1', { endOdometer: 1042.5 });
    const second = await new CompleteRoute(db).execute('route-1', { endOdometer: 1100 });
    expect(first).toMatchObject({ idempotent: false, summary: { actualDistanceKm: 42 } });
    expect(second).toMatchObject({ idempotent: true, summary: { actualDistanceKm: 42 } });
    expect(await new RouteRepository(db).getActive()).toBeNull();
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM action_journal WHERE action_type='route_completed'").get()).toMatchObject({ count: 1 });
  });

  it('requires explicit confirmation when unfinished stops remain', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await expect(new CompleteRoute(db).execute('route-1', { endOdometer: 1001 })).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await expect(new CompleteRoute(db).execute('route-1', { endOdometer: 1001, confirmUnfinished: true })).resolves.toMatchObject({ summary: { unmarkedStops: 2 } });
  });

  it('counts a stop delivered within 15 minutes of the window as on time, and beyond as late', async () => {
    const { db } = createDb();
    await new CreateDraftRoute(db).execute({ id: 'route-1', startLocation: endpoint, endLocation: endpoint });
    let stopNumber = 0;
    const windowed = (id: string, order: number, timeTo: string): DraftStopInput => ({
      ...stop(id, order, 10),
      deliveryTimeFrom: '10:00', deliveryTimeTo: timeTo, requiredTimeWindow: true,
    });
    await new ReplaceDraftStops(db, undefined, (prefix) => prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`)
      .execute('route-1', [windowed('stop-1', 1, '11:00'), windowed('stop-2', 2, '11:00')]);
    await db.runAsync("UPDATE routes SET status = 'loading', estimated_distance_km = 40 WHERE id = 'route-1'");
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    await new MarkStopLoaded(db).execute('route-1', 'stop-2');
    await new SaveStartOdometer(db).execute('route-1', 1000);
    await new StartRoute(db).execute('route-1');
    // completionPunctuality reads the window via local wall-clock hours, so
    // deliveredAt must be built from local time too, not a fixed UTC string,
    // or the offset from "11:00" would depend on the machine's timezone.
    const deadline = new Date(2026, 7, 11, 11, 0, 0);
    // 10 minutes past the 11:00 deadline: within the 15-minute tolerance.
    const tenMinutesLate = new Date(deadline.getTime() + 10 * 60_000).toISOString();
    // 20 minutes past: beyond it.
    const twentyMinutesLate = new Date(deadline.getTime() + 20 * 60_000).toISOString();
    await new MarkStopDelivered(db, () => tenMinutesLate).execute('route-1', 'stop-1');
    await new MarkStopDelivered(db, () => twentyMinutesLate).execute('route-1', 'stop-2');
    await arriveAtRouteEnd(db);
    const completed = await new CompleteRoute(db, () => new Date(deadline.getTime() + 60 * 60_000).toISOString()).execute('route-1', { endOdometer: 1010 });
    expect(completed.summary).toMatchObject({ onTimeStops: 1, lateStops: 1 });
  });

  it('lets an administrator close a hanging route from loading without odometer', async () => {
    const { adapter, db } = createDb();
    await loadingRoute(db);
    const first = await new AdminCompleteRoute(db).execute('route-1');
    const second = await new AdminCompleteRoute(db).execute('route-1');
    expect(first).toMatchObject({ idempotent: false, summary: { unmarkedStops: 2, totalStops: 2 } });
    expect(second).toMatchObject({ idempotent: true, summary: { unmarkedStops: 2 } });
    expect(await new RouteRepository(db).getActive()).toBeNull();
    expect((await new RouteRepository(db).getById('route-1'))?.status).toBe('completed');
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM action_journal WHERE action_type='route_completed_by_admin'").get()).toMatchObject({ count: 1 });
  });

  it('lists completed history and restores the complete detail from a new repository', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await new CompleteRoute(db).execute('route-1', { endOdometer: 1001.5, confirmUnfinished: true });
    const restarted = new RouteRepository(db);
    expect((await restarted.listHistory())[0]).toMatchObject({ id: 'route-1', status: 'completed', actualDistanceKm: 1 });
    expect((await restarted.getWithStops('route-1'))?.stops).toHaveLength(2);
  });

  it('exports a redacted pilot diagnostic with route, stops, audit and versions', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await new MarkStopFailed(db).execute('route-1', 'stop-1', {
      reason: 'Kita',
      comment: 'Piloto bandymas',
    });
    await db.runAsync(
      `INSERT INTO action_journal (id, route_id, action_type, before_json, after_json, created_at)
       VALUES ('sensitive', 'route-1', 'diagnostic_probe', '{}', ?, '2026-08-03T12:00:00.000Z')`,
      JSON.stringify({ apiKey: 'must-not-leak', headers: { authorization: 'also-secret' }, safe: 'visible' }),
    );

    const report = await new ExportPilotRouteDiagnostic(
      db,
      () => '2026-08-03T12:30:00.000Z',
    ).execute('route-1', '1.0.0');
    const json = JSON.stringify(report);

    expect(report).toMatchObject({
      exportType: 'pilot_route_diagnostic',
      applicationVersion: '1.0.0',
      schemaVersion: 27,
      route: { id: 'route-1', status: 'in_progress', startOdometer: 1000.5 },
    });
    expect(report.stops).toHaveLength(2);
    expect(report.audit.length).toBeGreaterThan(0);
    expect(json).not.toContain('must-not-leak');
    expect(json).not.toContain('also-secret');
    expect(json).toContain('[REDACTED]');
  });

  it('restores a working route after process death and remains usable offline', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await new MarkStopLoaded(db).execute('route-1', 'stop-1');
    expect((await new RouteRepository(db).getWithStops('route-1'))?.stops.find((item) => item.id === 'stop-1')?.loadingStatus).toBe('loaded');
    await new MarkStopLoaded(db).execute('route-1', 'stop-2');
    await new SaveStartOdometer(db).execute('route-1', 500.5);
    expect((await new RouteRepository(db).getById('route-1'))?.startOdometer).toBe(500.5);
    await new StartRoute(db).execute('route-1');
    await new MarkStopFailed(db).execute('route-1', 'stop-1', { reason: 'Kita', comment: 'Išlikęs komentaras' });
    const pendingUndo = await new GetLatestUndoableAction(db).execute('route-1');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    try {
      const afterProcessDeath = new RouteRepository(db);
      expect(await afterProcessDeath.getActive()).toMatchObject({
        id: 'route-1',
        status: 'in_progress',
        startOdometer: 500.5,
        startLocation: { originalAddress: endpoint.originalAddress },
        endLocation: { originalAddress: endpoint.originalAddress },
      });
      expect((await afterProcessDeath.getStops('route-1')).find((item) => item.id === 'stop-1')).toMatchObject({
        loadingStatus: 'loaded',
        deliveryStatus: 'failed',
        failureComment: 'Išlikęs komentaras',
      });
      expect(pendingUndo).not.toBeNull();
      expect((await new GetLatestUndoableAction(db).execute('route-1'))?.id).toBe(pendingUndo?.id);
      await new MarkStopDelivered(db).execute('route-1', 'stop-2');
      expect((await new RouteRepository(db).getById('route-1'))?.remainingStops).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('persists an interrupted completion and its odometer draft across process restart', async () => {
    const { db } = createDb(27);
    await startedRoute(db);
    await new MarkStopFailed(db).execute('route-1', 'stop-1', {
      reason: 'Kita',
      comment: 'Išlikęs komentaras',
    });
    await new MarkStopDelivered(db).execute('route-1', 'stop-2');
    await arriveAtRouteEnd(db);

    const first = await new BeginRouteCompletion(db, () => '2026-08-03T14:00:00.000Z').execute('route-1');
    const second = await new BeginRouteCompletion(db, () => '2026-08-03T14:01:00.000Z').execute('route-1');
    await new SaveCompletionOdometerDraft(db, () => '2026-08-03T14:02:00.000Z').execute('route-1', '1042,5');

    const restarted = new RouteRepository(db);
    expect(first).toMatchObject({ idempotent: true });
    expect(second).toEqual(first);
    expect(await restarted.getById('route-1')).toMatchObject({
      status: 'in_progress',
      completionStartedAt: first.startedAt,
      completionEndOdometerDraft: '1042,5',
    });
    expect((await restarted.getStops('route-1'))[0]).toMatchObject({
      deliveryStatus: 'failed',
      failureComment: 'Išlikęs komentaras',
    });
  });

  it('clears only the completion odometer draft after the same route is completed', async () => {
    const { db } = createDb(27);
    await startedRoute(db);
    await new MarkStopDelivered(db).execute('route-1', 'stop-1');
    await new MarkStopDelivered(db).execute('route-1', 'stop-2');
    await arriveAtRouteEnd(db);
    await new BeginRouteCompletion(db).execute('route-1');
    await new SaveCompletionOdometerDraft(db).execute('route-1', '1042.5');
    await new CompleteRoute(db).execute('route-1', {
      endOdometer: 1042.5,
      confirmUnfinished: true,
    });
    expect(await new RouteRepository(db).getById('route-1')).toMatchObject({
      status: 'completed',
      completionEndOdometerDraft: null,
    });
  });

  it('migrates v5 routes to v6 and preserves an active route', () => {
    const { adapter } = createDb(5);
    adapter.raw.prepare("INSERT INTO routes (id,date,status,total_weight_kg,remaining_weight_kg,total_stops,remaining_stops,created_at,updated_at,unknown_weight_stops) VALUES ('r','2026-08-03','loading',0,0,0,0,'x','x',0)").run();
    adapter.raw.exec(migration('migrationV6'));
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 6 });
    expect(adapter.raw.prepare("SELECT status, remaining_unknown_weight_stops FROM routes WHERE id='r'").get()).toMatchObject({ status: 'loading', remaining_unknown_weight_stops: 0 });
  });

  it('migrates a physical-pilot v7 DB to v8 without changing the active route', () => {
    const { adapter } = createDb(7);
    adapter.raw.prepare("INSERT INTO routes (id,date,status,total_weight_kg,remaining_weight_kg,total_stops,remaining_stops,created_at,updated_at,unknown_weight_stops,remaining_unknown_weight_stops) VALUES ('r','2026-08-03','in_progress',0,0,0,0,'x','x',0,0)").run();
    adapter.raw.exec(migration('migrationV8'));
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });
    expect(adapter.raw.prepare("SELECT status, completion_started_at, completion_end_odometer_draft FROM routes WHERE id='r'").get()).toMatchObject({
      status: 'in_progress',
      completion_started_at: null,
      completion_end_odometer_draft: null,
    });
  });

  it('migrates an active physical-pilot v8 DB to v9 without losing route data', () => {
    const { adapter } = createDb(8);
    adapter.raw.prepare("INSERT INTO routes (id,date,status,total_weight_kg,remaining_weight_kg,total_stops,remaining_stops,created_at,updated_at,unknown_weight_stops,remaining_unknown_weight_stops) VALUES ('r-v9','2026-08-03','in_progress',0,0,0,0,'x','x',0,0)").run();
    adapter.raw.exec(migration('migrationV9'));
    expect(adapter.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 9 });
    expect(adapter.raw.prepare("SELECT status FROM routes WHERE id='r-v9'").get()).toMatchObject({ status: 'in_progress' });
    expect(adapter.raw.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='shipment_lines'").get()).toMatchObject({ count: 1 });
  });
});

describe('reopen route for planning', () => {
  it('sends a loading-stage route back to draft so alternatives can be recomputed', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    await new ReopenRouteForPlanning(db).execute('route-1');
    const route = await new RouteRepository(db).getById('route-1');
    expect(route?.status).toBe('draft');
    expect(route?.selectedRunId).toBeNull();
    expect(route?.selectedCandidateId).toBeNull();
  });

  it('refuses to reopen a route that is already in progress', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await expect(new ReopenRouteForPlanning(db).execute('route-1')).rejects.toThrow();
  });
});

describe('add stop during delivery', () => {
  const newStop = {
    originalAddress: 'Katedros a. 4, Vilnius',
    normalizedAddress: 'Katedros a. 4, Vilnius, Lietuva',
    latitude: 54.6841,
    longitude: 25.2876,
    weightKg: 12.5,
    recipient: 'Naujas klientas',
  };

  it('inserts a new pending stop and recomputes route totals from live delivery status (not treating delivered stops as remaining)', async () => {
    const { db } = createDb();
    await startedRoute(db); // route-1: stop-1 & stop-2, both loaded, route in_progress
    await new MarkStopDelivered(db).execute('route-1', 'stop-1');

    const { stopId } = await new AddStopDuringDelivery(db).execute('route-1', newStop);
    const stops = await new RouteRepository(db).getStops('route-1');
    const added = stops.find((item) => item.id === stopId)!;
    expect(added.deliveryStatus).toBe('pending');
    expect(added.loadingStatus).toBe('loaded');
    expect(added.addressValidationState).toBe('auto_confirmed');
    expect(added.latitude).toBe(newStop.latitude);
    expect(added.longitude).toBe(newStop.longitude);
    expect(added.weightKg).toBe(newStop.weightKg);
    expect(added.recipient).toBe(newStop.recipient);

    const route = await new RouteRepository(db).getById('route-1');
    // stop-1 delivered (10kg), stop-2 pending (null weight), new stop pending (12.5kg)
    expect(route?.totalStops).toBe(3);
    expect(route?.remainingStops).toBe(2); // stop-2 + new stop, NOT stop-1 (already delivered)
    expect(route?.totalWeightKg).toBe(22.5);
    expect(route?.remainingWeightKg).toBe(12.5); // only the new stop has known weight among the pending ones
  });

  it('refuses to add a stop before the route is in progress', async () => {
    const { db } = createDb();
    await loadingRoute(db); // route-1 is still 'loading', not 'in_progress'
    await expect(new AddStopDuringDelivery(db).execute('route-1', newStop)).rejects.toThrow();
  });

  it('rejects an unconfirmed address or invalid coordinates', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await expect(new AddStopDuringDelivery(db).execute('route-1', { ...newStop, normalizedAddress: '' })).rejects.toThrow();
    await expect(new AddStopDuringDelivery(db).execute('route-1', { ...newStop, latitude: Number.NaN })).rejects.toThrow();
    await expect(new AddStopDuringDelivery(db).execute('route-1', { ...newStop, weightKg: -1 })).rejects.toThrow();
  });
});

describe('reverse stop order', () => {
  it('flips the whole active delivery sequence end-to-end', async () => {
    const { db } = createDb();
    await loadingRoute(db);
    const before = await new RouteRepository(db).getStops('route-1');
    expect(before.map((item) => item.id)).toEqual(['stop-1', 'stop-2']);

    await new ReverseStopOrder(db).execute('route-1');
    const after = await new RouteRepository(db).getStops('route-1');
    expect(after.map((item) => item.id)).toEqual(['stop-2', 'stop-1']);
  });

  it('refuses to reverse once the route is already in progress', async () => {
    const { db } = createDb();
    await startedRoute(db);
    await expect(new ReverseStopOrder(db).execute('route-1')).rejects.toThrow();
  });
});

describe('active route next stop', () => {
  it('promotes a later pending stop and keeps skipped stops pending', async () => {
    const { adapter, db } = createDb();
    await startedRoute(db);

    await expect(new SetNextPendingStop(db, () => '2026-08-03T10:00:00.000Z').execute('route-1', 'stop-2'))
      .resolves.toMatchObject({ idempotent: false, orderedStopIds: ['stop-2', 'stop-1'] });

    const stops = await new RouteRepository(db).getStops('route-1');
    expect(stops.map((item) => item.id)).toEqual(['stop-2', 'stop-1']);
    expect(stops.map((item) => item.deliveryStatus)).toEqual(['pending', 'pending']);
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM action_journal WHERE action_type = 'next_pending_stop_changed'").get())
      .toMatchObject({ count: 1 });
  });

  it('saves the complete remaining order without moving an already delivered stop', async () => {
    const { adapter, db } = createDb();
    await startedRoute(db);
    await new MarkStopDelivered(db).execute('route-1', 'stop-1');
    const { stopId: addedStopId } = await new AddStopDuringDelivery(db).execute('route-1', {
      originalAddress: 'Katedros a. 4, Vilnius',
      normalizedAddress: 'Katedros a. 4, Vilnius, Lietuva',
      latitude: 54.6841,
      longitude: 25.2876,
      weightKg: 12.5,
      recipient: 'Naujas klientas',
    });

    await expect(new ReorderRemainingStops(db, () => '2026-08-03T10:05:00.000Z').execute('route-1', [addedStopId, 'stop-2']))
      .resolves.toMatchObject({ idempotent: false, orderedStopIds: [addedStopId, 'stop-2'] });

    const stops = await new RouteRepository(db).getStops('route-1');
    expect(stops.map((item) => item.id)).toEqual(['stop-1', addedStopId, 'stop-2']);
    expect(stops[0]?.deliveryStatus).toBe('delivered');
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM action_journal WHERE action_type = 'remaining_stops_reordered'").get())
      .toMatchObject({ count: 1 });
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM route_order_snapshots WHERE route_id = 'route-1' AND kind = 'manual' AND ordered_stop_ids_json = ?")
      .get(JSON.stringify([addedStopId, 'stop-2']))).toMatchObject({ count: 1 });
  });
});

describe('stop priority', () => {
  it('numbers priorities by click order and compacts ranks after deselection', async () => {
    const { db } = createDb(27);
    await new CreateDraftRoute(db).execute({ id: 'route-p', startLocation: endpoint, endLocation: endpoint });
    let stopNumber = 0;
    await new ReplaceDraftStops(db, undefined, (prefix) => prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`)
      .execute('route-p', [stop('stop-1', 1, 10), stop('stop-2', 2, 20)]);

    await new SetStopPriority(db).execute('route-p', 'stop-1', true);
    let stops = await new RouteRepository(db).getStops('route-p');
    expect(stops.find((item) => item.id === 'stop-1')?.priorityFirst).toBe(true);
    expect(stops.find((item) => item.id === 'stop-1')?.priorityRank).toBe(1);
    expect(stops.find((item) => item.id === 'stop-2')?.priorityFirst).toBe(false);

    await new SetStopPriority(db).execute('route-p', 'stop-2', true);
    stops = await new RouteRepository(db).getStops('route-p');
    expect(stops.find((item) => item.id === 'stop-1')?.priorityFirst).toBe(true);
    expect(stops.find((item) => item.id === 'stop-2')?.priorityFirst).toBe(true);
    expect(stops.map((item) => item.priorityRank)).toEqual([1, 2]);

    await new SetStopPriority(db).execute('route-p', 'stop-1', false);
    stops = await new RouteRepository(db).getStops('route-p');
    expect(stops.find((item) => item.id === 'stop-1')?.priorityRank).toBeNull();
    expect(stops.find((item) => item.id === 'stop-2')?.priorityRank).toBe(1);
  });

  it('orders multiple priority stops along the way without hard-locking the first slot', async () => {
    const { db } = createDb(27);
    await new CreateDraftRoute(db).execute({ id: 'route-p2', startLocation: endpoint, endLocation: endpoint });
    let stopNumber = 0;
    await new ReplaceDraftStops(db, undefined, (prefix) => prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`)
      .execute('route-p2', [stop('stop-1', 1, 10), stop('stop-2', 2, 20), stop('stop-3', 3, 5)]);
    await new SetStopPriority(db).execute('route-p2', 'stop-3', true);
    await new SetStopPriority(db).execute('route-p2', 'stop-1', true);

    const persisted = await new RouteRepository(db).getWithStops('route-p2');
    const request = buildOptimizationRequestFromRoute(persisted!.route, persisted!.stops);
    const first = request.stops.find((item) => item.id === 'stop-1');
    const third = request.stops.find((item) => item.id === 'stop-3');
    expect(first?.mustBeFirst).toBe(false);
    expect(third?.mustBeFirst).toBe(false);
    expect(third?.deliverBeforeStopIds).toEqual(['stop-1']);
    expect(first?.deliverBeforeStopIds).toEqual([]);
    expect(request.stops.filter((item) => item.preferEarly).map((item) => item.id).sort()).toEqual(['stop-1', 'stop-3']);
  });
});

describe('navigation URL builder', () => {
  const target = { originalAddress: 'Tilžės g. 1, Šiauliai', normalizedAddress: 'Tilžės g. 1, Šiauliai, Lietuva', latitude: 55.93, longitude: 23.31 };
  it('builds Waze and Apple Maps URLs on iOS', () => {
    const urls = buildNavigationUrls(target, 'ios');
    expect(urls.waze).toBe('waze://?ll=55.93,23.31&navigate=yes');
    expect(urls.fallback).toContain('maps.apple.com');
  });
  it('builds Google Maps fallback on Android and Web', () => {
    expect(buildNavigationUrls(target, 'android').fallback).toContain('google.com/maps/dir');
    expect(buildNavigationUrls({ ...target, latitude: null, longitude: null }, 'web').fallback).toContain(encodeURIComponent(target.normalizedAddress));
  });
  it('rejects an unconfirmed address before opening navigation', () => {
    expect(() => navigationTargetFromStop({ ...target, addressValidationState: 'unconfirmed' })).toThrow(NavigationTargetError);
  });
});

describe('route delivery labels', () => {
  it('keeps the failed reason and the driver comment visible together', () => {
    expect(failedDeliveryLabel('Klientas nepriėmė', 'Gavėjas atsisakė priimti siuntą')).toBe(
      'Nepavyko: Klientas nepriėmė\nKomentaras: Gavėjas atsisakė priimti siuntą',
    );
  });
});
