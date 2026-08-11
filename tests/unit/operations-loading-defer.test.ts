import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  ActivateRoute,
  CreateDraftRoute,
  DeferRouteForLater,
  ReplaceDraftStops,
  SaveSelectedRouteCandidate,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import {
  MarkAllStopsLoaded,
  SaveStartOdometer,
  StartRoute,
} from '../../src/application/routes/route-workday';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import { createBaseRequest } from '../../src/domain/routing/scenarios';
import { SQLiteRoutingAuditRepository } from '../../src/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...params as never[]) as T[];
  }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); }
    catch (error) { this.raw.exec('ROLLBACK'); throw error; }
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

function stop(id: string, order: number, weightKg: number | null = 10): DraftStopInput {
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

async function loadedRoute(db: SQLiteDatabase): Promise<string> {
  await new CreateDraftRoute(db).execute({ id: 'route-1', startLocation: endpoint });
  let stopNumber = 0;
  await new ReplaceDraftStops(db, undefined, (prefix) =>
    prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`,
  ).execute('route-1', [stop('stop-1', 1), stop('stop-2', 2)]);
  const request = { ...createBaseRequest(2), routeId: 'route-1' };
  const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
  await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, result);
  await new SaveSelectedRouteCandidate(db).execute('route-1', result.requestId, result.recommended!.id);
  await new ActivateRoute(db).execute('route-1');
  await new MarkAllStopsLoaded(db).execute('route-1');
  return 'route-1';
}

describe('operations loading defer workflow', () => {
  it('mark-all loads without requiring odometer, while Start requires it', async () => {
    const { db } = createDb();
    const routeId = await loadedRoute(db);
    const route = await new RouteRepository(db).getById(routeId);
    expect(route).toMatchObject({ status: 'loaded', startOdometer: null });
    await expect(new StartRoute(db).execute(routeId)).rejects.toMatchObject({ code: 'INVALID_ROUTE_STATE' });
    await new SaveStartOdometer(db).execute(routeId, 1000);
    await expect(new StartRoute(db).execute(routeId)).resolves.toMatchObject({ idempotent: false });
    expect(await new RouteRepository(db).getById(routeId)).toMatchObject({ status: 'in_progress' });
  });

  it('defer returns loaded route to planned, keeps loading marks, and allows a new draft', async () => {
    const { adapter, db } = createDb();
    const routeId = await loadedRoute(db);
    const beforeStops = await new RouteRepository(db).getStops(routeId);
    expect(beforeStops.every((stop) => stop.loadingStatus === 'loaded')).toBe(true);

    await expect(new DeferRouteForLater(db).execute(routeId)).resolves.toMatchObject({ idempotent: false });
    expect(await new RouteRepository(db).getById(routeId)).toMatchObject({ status: 'planned' });
    const afterStops = await new RouteRepository(db).getStops(routeId);
    expect(afterStops.every((stop) => stop.loadingStatus === 'loaded')).toBe(true);

    const audit = adapter.raw.prepare(
      "SELECT action_type FROM action_journal WHERE route_id = ? AND action_type = 'route_deferred_for_later'",
    ).get(routeId);
    expect(audit).toBeTruthy();

    await expect(new CreateDraftRoute(db).execute({ id: 'route-2', startLocation: endpoint }))
      .resolves.toEqual({ routeId: 'route-2' });
    expect(await new RouteRepository(db).getBlockingRoute()).toMatchObject({ id: 'route-2', status: 'draft' });
    expect(await new RouteRepository(db).listOperational()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'route-1', status: 'planned' }),
        expect.objectContaining({ id: 'route-2', status: 'draft' }),
      ]),
    );
  });

  it('loading screen contracts keep mark-all separate from start/defer', () => {
    const loading = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/route/[id]/loading.tsx'),
      'utf8',
    );
    expect(loading).toContain('testID="mark-all-stops-loaded"');
    expect(loading).toContain('testID="open-start-odometer"');
    expect(loading).toContain('testID="defer-loaded-route"');
    expect(loading).toContain('testID="defer-planned-route"');
    expect(loading).toContain('DeferRouteForLater');
    expect(loading).not.toContain('odometerPrompted');
    expect(loading).not.toMatch(/status === 'loaded' && !odometerPrompted/);
  });
});
