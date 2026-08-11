import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  ActivateRoute,
  CancelDraftRoute,
  CreateDraftRoute,
  DeleteDraftStop,
  GetActiveRoute,
  ReorderDraftStops,
  ReplaceDraftStops,
  RouteCommandError,
  SaveSelectedRouteCandidate,
  UpdateDraftStop,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import { destinationForRouteStatus } from '../../src/application/routes/route-navigation';
import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import { createBaseRequest } from '../../src/domain/routing/scenarios';
import { SQLiteRoutingAuditRepository } from '../../src/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}

  async execAsync(sql: string) { this.raw.exec(sql); }

  async runAsync(sql: string, ...params: unknown[]) {
    return this.raw.prepare(sql).run(...params as never[]);
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params as never[]) as T[];
  }

  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      await operation();
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'),
    'utf8',
  );
  const schemaVersion = Number(source.match(/SCHEMA_VERSION = (\d+)/)![1]);
  for (let version = 1; version <= schemaVersion; version += 1) {
    const match = source.match(new RegExp(`const migrationV${version} = \`([\\s\\S]*?)\`;`));
    if (!match) throw new Error(`Missing migrationV${version}`);
    adapter.raw.exec(match[1]);
  }
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

const endpoint = {
  originalAddress: 'Sandėlio g. 1, Šiauliai',
  geocodingQuery: 'Sandėlio g. 1, Šiauliai',
  normalizedAddress: 'Sandėlio g. 1, Šiauliai, Lietuva',
  latitude: 55.93,
  longitude: 23.31,
};

function stop(id: string, order: number, weightKg: number | null = null): DraftStopInput {
  return {
    id,
    originalOrder: order,
    orderNumber: null,
    recipient: null,
    originalAddress: `Dvaro g. ${order}, Šiauliai`,
    geocodingQuery: `Dvaro g. ${order}, Šiauliai`,
    normalizedAddress: `Dvaro g. ${order}, Šiauliai, Lietuva`,
    addressValidationState: 'auto_confirmed',
    latitude: 55.93 + order / 1000,
    longitude: 23.31 + order / 1000,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg,
    phone: null,
    notes: null,
  };
}

async function draftWithStops(db: SQLiteDatabase) {
  const created = await new CreateDraftRoute(db, () => '2026-08-03T08:00:00.000Z', (prefix) => `${prefix}-fixed`).execute({
    id: 'route-1',
    startLocation: endpoint,
    plannedDepartureAt: '2026-08-03T09:00:00.000Z',
  });
  let stopNumber = 0;
  await new ReplaceDraftStops(db, () => '2026-08-03T08:01:00.000Z', (prefix) =>
    prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`,
  ).execute(
    created.routeId,
    [stop('stop-1', 1, null), stop('stop-2', 2, 15)],
  );
  return created.routeId;
}

describe('durable route workflow', () => {
  it('creates a draft and persists stops with unknown weight as null', async () => {
    const { adapter, db } = createDb();
    const routeId = await draftWithStops(db);
    const persisted = await new RouteRepository(db).getWithStops(routeId);
    expect(persisted?.route).toMatchObject({ status: 'draft', totalStops: 2, totalWeightKg: 15, unknownWeightStops: 1 });
    expect(persisted?.stops[0]).toMatchObject({ id: 'stop-1', sourceStopId: 'stop-1', weightKg: null });
    expect(adapter.raw.prepare('SELECT weight_kg, source_stop_id FROM delivery_stops WHERE id = ?').get('stop-1')).toMatchObject({ weight_kg: null, source_stop_id: 'stop-1' });
  });

  it('builds a real request from persisted stops without a synthetic workday date', async () => {
    const { db } = createDb();
    const routeId = await draftWithStops(db);
    const persisted = await new RouteRepository(db).getWithStops(routeId);
    const request = buildOptimizationRequestFromRoute(persisted!.route, persisted!.stops);
    expect(request.routeId).toBe(routeId);
    expect(request.stops.map((item) => item.id)).toEqual(['stop-1', 'stop-2']);
    expect(request.workdayEndAt).toBeUndefined();
  });

  it('allows only one blocking route and permits a new draft after planned deferral', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    await expect(new CreateDraftRoute(db).execute({ id: 'route-2', startLocation: endpoint })).rejects.toMatchObject({ code: 'ACTIVE_ROUTE_EXISTS' });
    await new CancelDraftRoute(db).execute('route-1');
    await expect(new CreateDraftRoute(db).execute({ id: 'route-2', startLocation: endpoint })).resolves.toEqual({ routeId: 'route-2' });
  });

  it('allows creating a new draft while another route remains planned', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    const request = { ...createBaseRequest(2), routeId: 'route-1' };
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, result);
    await new SaveSelectedRouteCandidate(db).execute('route-1', result.requestId, result.recommended!.id);
    expect(await new RouteRepository(db).getById('route-1')).toMatchObject({ status: 'planned' });
    await expect(new CreateDraftRoute(db).execute({ id: 'route-2', startLocation: endpoint }))
      .resolves.toEqual({ routeId: 'route-2' });
    expect(await new RouteRepository(db).getBlockingRoute()).toMatchObject({ id: 'route-2', status: 'draft' });
    expect(await new RouteRepository(db).getActive()).toMatchObject({ id: 'route-2', status: 'draft' });
  });

  it('still blocks creation while a draft exists', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    await expect(new CreateDraftRoute(db).execute({ id: 'route-2', startLocation: endpoint }))
      .rejects.toMatchObject({ code: 'ACTIVE_ROUTE_EXISTS' });
  });

  it('edits, reorders and deletes draft stops transactionally', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    await new UpdateDraftStop(db).execute('route-1', 'stop-1', {
      originalAddress: 'Stoties g. 9C',
      geocodingQuery: 'Stoties g. 9C, Šiauliai',
      normalizedAddress: 'Stoties g. 9C, 77156 Šiauliai, Lietuva',
      weightKg: 0,
    });
    await new ReorderDraftStops(db).execute('route-1', ['stop-2', 'stop-1']);
    let stops = await new RouteRepository(db).getStops('route-1');
    expect(stops.map((item) => item.id)).toEqual(['stop-2', 'stop-1']);
    expect(stops[1]).toMatchObject({
      originalAddress: 'Stoties g. 9C',
      geocodingQuery: 'Stoties g. 9C, Šiauliai',
      normalizedAddress: 'Stoties g. 9C, 77156 Šiauliai, Lietuva',
      weightKg: 0,
    });
    await new DeleteDraftStop(db).execute('route-1', 'stop-2');
    stops = await new RouteRepository(db).getStops('route-1');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ id: 'stop-1', originalOrder: 1 });
  });

  it('saves the selected optimized sequence, activates once and loads in reverse order', async () => {
    const { adapter, db } = createDb();
    await draftWithStops(db);
    const request = { ...createBaseRequest(2), routeId: 'route-1' };
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, result);
    const selected = result.recommended!;
    await new SaveSelectedRouteCandidate(db).execute('route-1', result.requestId, selected.id);
    expect(await new RouteRepository(db).getById('route-1')).toMatchObject({
      status: 'planned',
      selectedRunId: result.requestId,
      selectedCandidateId: selected.id,
    });
    await new ActivateRoute(db).execute('route-1');
    expect(await new ActivateRoute(db).execute('route-1')).toEqual({ idempotent: true });
    expect(await new SaveSelectedRouteCandidate(db).execute('route-1', result.requestId, selected.id)).toEqual({ idempotent: true });
    const route = await new RouteRepository(db).getById('route-1');
    expect(route).toMatchObject({ status: 'loading', selectedRunId: result.requestId, selectedCandidateId: selected.id });
    const forward = await new RouteRepository(db).getStops('route-1');
    const loading = await new RouteRepository(db).getStops('route-1', 'loading');
    expect(loading.map((item) => item.id)).toEqual(forward.map((item) => item.id).reverse());
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 1 });
    expect(adapter.raw.prepare(`SELECT COUNT(*) AS count FROM route_order_snapshots WHERE kind='optimized'`).get()).toMatchObject({ count: 1 });
  });

  it('restores the same active route from a new repository instance', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    const first = await new GetActiveRoute(db).execute();
    const afterProcessRestart = await new GetActiveRoute(db).execute();
    expect(afterProcessRestart?.route.id).toBe(first?.route.id);
    expect(afterProcessRestart?.stops.map((item) => item.id)).toEqual(first?.stops.map((item) => item.id));
  });

  it('rolls back route creation when a later statement in the transaction fails', async () => {
    const { adapter, db } = createDb();
    await expect(new CreateDraftRoute(db).execute({
      id: 'rollback-route',
      startLocation: endpoint,
      importSource: { type: 'invalid' as never, originalText: null, imageReference: null },
    })).rejects.toThrow();
    expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 0 });
  });

  it('maps dashboard destinations from persisted route state', () => {
    expect(destinationForRouteStatus('draft')).toBe('review');
    expect(destinationForRouteStatus('planned')).toBe('loading');
    expect(destinationForRouteStatus('loading')).toBe('loading');
    expect(destinationForRouteStatus('in_progress')).toBe('delivery');
  });

  it('does not pass route payload JSON between route screens', () => {
    for (const path of [
      '../../src/app/import/index.tsx',
      '../../src/app/route/new.tsx',
      '../../src/app/route/[id]/review.tsx',
      '../../src/app/route/[id]/alternatives.tsx',
    ]) {
      const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), path), 'utf8');
      expect(source).not.toMatch(/params:\s*\{[^}]*JSON\.stringify/su);
      expect(source).not.toContain('confirmedPoints:');
      expect(source).not.toContain('startGeocode:');
    }
  });

  it('reports domain errors for a candidate whose stops no longer match the draft', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    const request = { ...createBaseRequest(1), routeId: 'route-1' };
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, result);
    await expect(new SaveSelectedRouteCandidate(db).execute('route-1', result.requestId, result.recommended!.id))
      .rejects.toBeInstanceOf(RouteCommandError);
  });
});
