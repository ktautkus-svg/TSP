import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  ActivateRoute,
  CreateDraftRoute,
  CreateDraftRouteWithStops,
  PruneUncommittedDraftRoutes,
  ReopenRouteForPlanning,
  SaveSelectedRouteCandidate,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
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
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
const schemaVersion = Number(source.match(/SCHEMA_VERSION = (\d+)/)?.[1]);

function createDb(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
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

function stop(order: number): DraftStopInput {
  return {
    sourceStopId: `delivery-${order}`,
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
    weightKg: 10,
    phone: null,
    notes: null,
  };
}

let commandSeq = 0;
function createInput(id?: string) {
  commandSeq += 1;
  return {
    id,
    commandId: `cmd-${commandSeq}`,
    plannedDepartureAt: '2026-09-02T04:00:00.000Z',
    startLocation: endpoint,
    endLocation: endpoint,
    importSource: { type: 'excel' as const, originalText: 'R11 R19 R54', imageReference: null },
    stops: [stop(1), stop(2)],
  };
}

describe('uncommitted draft cleanup', () => {
  it('cancels leftover Ruošiamas drafts that never selected a route', async () => {
    const { adapter, db } = createDb();
    const first = await new CreateDraftRouteWithStops(db).execute(createInput('orphan-1'));
    const second = await new CreateDraftRouteWithStops(db).execute(createInput('orphan-2'));
    expect(first.routeId).toBe('orphan-1');
    expect(await new RouteRepository(db).getById('orphan-1')).toMatchObject({ status: 'cancelled' });
    expect(await new RouteRepository(db).getById(second.routeId)).toMatchObject({ status: 'draft' });
    expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM routes WHERE status = 'draft'").get()).toMatchObject({ count: 1 });
    expect(adapter.raw.prepare('SELECT cloud_deleted_at FROM routes WHERE id = ?').get('orphan-1')).toMatchObject({
      cloud_deleted_at: expect.any(String),
    });
  });

  it('does not delete a planned or assigned route when pruning orphans', async () => {
    const { adapter, db } = createDb();
    await new CreateDraftRouteWithStops(db).execute(createInput('planned-1'));
    const persisted = await new RouteRepository(db).getWithStops('planned-1');
    const request = buildOptimizationRequestFromRoute(persisted!.route, persisted!.stops);
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('planned-1', request, result);
    await new SaveSelectedRouteCandidate(db).execute('planned-1', result.requestId, result.recommended!.id);

    await new CreateDraftRoute(db).execute({ id: 'assigned-1', startLocation: endpoint, endLocation: endpoint });
    adapter.raw.prepare(
      `INSERT INTO route_sync_state (
        assignment_id, route_id, employee_id, server_revision, sync_status, last_synced_at, created_at, updated_at
      ) VALUES ('assign-1', 'assigned-1', 'emp-1', '1', 'synced', '2026-09-02T08:00:00.000Z', '2026-09-02T08:00:00.000Z', '2026-09-02T08:00:00.000Z')`,
    ).run();

    await new CreateDraftRouteWithStops(db).execute(createInput('orphan-new'));
    const pruned = await new PruneUncommittedDraftRoutes(db).execute();

    expect(await new RouteRepository(db).getById('planned-1')).toMatchObject({ status: 'planned' });
    expect(await new RouteRepository(db).getById('assigned-1')).toMatchObject({ status: 'draft' });
    expect(await new RouteRepository(db).getById('orphan-new')).toMatchObject({ status: 'cancelled' });
    expect(pruned.cancelledRouteIds).toEqual(['orphan-new']);
  });

  it('keeps a draft that was reopened from a planned route', async () => {
    const { db } = createDb();
    await new CreateDraftRouteWithStops(db).execute(createInput('reopened-1'));
    const persisted = await new RouteRepository(db).getWithStops('reopened-1');
    const request = buildOptimizationRequestFromRoute(persisted!.route, persisted!.stops);
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('reopened-1', request, result);
    await new SaveSelectedRouteCandidate(db).execute('reopened-1', result.requestId, result.recommended!.id);
    await new ReopenRouteForPlanning(db).execute('reopened-1');

    const pruned = await new PruneUncommittedDraftRoutes(db).execute();
    expect(pruned.cancelledRouteIds).toEqual([]);
    expect(await new RouteRepository(db).getById('reopened-1')).toMatchObject({ status: 'draft' });
  });

  it('keeps the draft currently being planned and a working assigned route', async () => {
    const { adapter, db } = createDb();
    await new CreateDraftRouteWithStops(db).execute(createInput('keep-me'));
    await new CreateDraftRoute(db).execute({ id: 'working-1', startLocation: endpoint, endLocation: endpoint });
    adapter.raw.prepare("UPDATE routes SET status = 'in_progress' WHERE id = 'working-1'").run();

    const pruned = await new PruneUncommittedDraftRoutes(db).execute({ keepRouteId: 'keep-me' });
    expect(pruned.cancelledRouteIds).toEqual([]);
    expect(await new RouteRepository(db).getById('keep-me')).toMatchObject({ status: 'draft' });
    expect(await new RouteRepository(db).getById('working-1')).toMatchObject({ status: 'in_progress' });
  });

  it('does not touch ActivateRoute or park-memory working status', async () => {
    const { adapter, db } = createDb();
    await new CreateDraftRouteWithStops(db).execute(createInput('to-load'));
    const persisted = await new RouteRepository(db).getWithStops('to-load');
    const request = buildOptimizationRequestFromRoute(persisted!.route, persisted!.stops);
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('to-load', request, result);
    await new SaveSelectedRouteCandidate(db).execute('to-load', result.requestId, result.recommended!.id);
    await new ActivateRoute(db).execute('to-load');

    await new CreateDraftRouteWithStops(db).execute(createInput('later-orphan'));
    expect(await new RouteRepository(db).getById('to-load')).toMatchObject({ status: 'loading' });
    expect(adapter.raw.prepare("SELECT status FROM routes WHERE id = 'later-orphan'").get()).toMatchObject({ status: 'draft' });
  });
});
