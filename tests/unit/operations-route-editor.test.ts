import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { moveStopInSequence, sequencesEqual } from '../../src/application/routes/manual-sequence-order';
import {
  CreateDraftRoute,
  ReplaceDraftStops,
  SaveSelectedRouteCandidate,
  type DraftStopInput,
} from '../../src/application/routes/route-commands';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import { createBaseRequest } from '../../src/domain/routing/scenarios';
import { evaluateCandidate } from '../../src/domain/routing/evaluation/candidate-evaluator';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { SQLiteRoutingAuditRepository } from '../../src/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

const here = dirname(fileURLToPath(import.meta.url));
const alternativesScreen = readFileSync(resolve(here, '../../src/app/route/[id]/alternatives.tsx'), 'utf8');
const editScreen = readFileSync(resolve(here, '../../src/app/route/[id]/edit.tsx'), 'utf8');
const layoutSource = readFileSync(resolve(here, '../../src/app/_layout.tsx'), 'utf8');
const navigationSource = readFileSync(resolve(here, '../../src/application/routes/route-navigation.ts'), 'utf8');
const manualOrderList = readFileSync(resolve(here, '../../src/components/manual-route-order-list.tsx'), 'utf8');

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
    recipient: `Gavėjas ${order}`,
    originalAddress: `Dvaro g. ${order}, Šiauliai`,
    geocodingQuery: `Dvaro g. ${order}, Šiauliai`,
    normalizedAddress: `Dvaro g. ${order}, Šiauliai, Lietuva`,
    addressValidationState: 'auto_confirmed',
    latitude: 55.93 + order / 1000,
    longitude: 23.31 + order / 1000,
    deliveryTimeFrom: '08:00',
    deliveryTimeTo: '12:00',
    requiredTimeWindow: false,
    weightKg,
    phone: null,
    notes: null,
  };
}

async function draftWithStops(db: SQLiteDatabase) {
  await new CreateDraftRoute(db).execute({
    id: 'route-1',
    startLocation: endpoint,
    plannedDepartureAt: '2026-08-03T09:00:00.000Z',
  });
  let stopNumber = 0;
  await new ReplaceDraftStops(db, undefined, (prefix) =>
    prefix === 'stop' ? `stop-${++stopNumber}` : `${prefix}-${Math.random()}`,
  ).execute(
    'route-1',
    [stop('stop-1', 1, 10), stop('stop-2', 2, 15), stop('stop-3', 3, 20)],
  );
  return 'route-1';
}

describe('operations route editor workflow', () => {
  it('navigates from alternatives to the editor with run and candidate params', () => {
    expect(alternativesScreen).toContain("pathname: '/route/[id]/edit'");
    expect(alternativesScreen).toContain('runId: resultRequestId');
    expect(alternativesScreen).toContain('candidateId');
    expect(alternativesScreen).toContain('Tęsti su šiuo variantu');
    expect(alternativesScreen).toContain('testID="save-selected-route-top"');
    expect(alternativesScreen).not.toContain('SaveSelectedRouteCandidate');
    expect(alternativesScreen).not.toContain('manual-sequencing-panel');
    expect(alternativesScreen).not.toContain('ManualRouteOrderList');
    expect(alternativesScreen).not.toContain('Redaguoti rankiniu būdu');
    expect(alternativesScreen).toContain('Redaguoti maršruto redaktoriuje');
    expect(alternativesScreen).toContain('testID="open-route-editor"');
    expect(alternativesScreen).toContain('testID="cancel-route-and-new-file"');
  });

  it('registers the editor screen and navigation types', () => {
    expect(layoutSource).toContain('route/[id]/edit');
    expect(layoutSource).toContain('Maršruto redaktorius');
    expect(navigationSource).toContain("'edit'");
    expect(navigationSource).toContain("'/route/[id]/edit'");
    expect(navigationSource).toContain("screen === 'edit'");
  });

  it('keeps editor list/map controls and confirm CTA', () => {
    expect(editScreen).toContain('testID="editor-view-list"');
    expect(editScreen).toContain('testID="editor-view-map"');
    expect(editScreen).toContain('testID="confirm-editor-sequence"');
    expect(editScreen).toContain('Naudoti šią seką');
    expect(editScreen).toContain('SaveSelectedRouteCandidate');
    expect(editScreen).toContain("pathname: '/route/[id]/loading'");
    expect(editScreen).toContain('requestSync(\'mutation\')');
    expect(editScreen).toContain('layout.maxOperationalWidth');
    expect(editScreen).toContain('POLYLINE_DEBOUNCE_MS = 400');
    expect(editScreen).toContain('ManualRouteOrderList');
    expect(manualOrderList).toContain('timeWindowLabel');
    expect(manualOrderList).toContain('recipient');
    expect(manualOrderList).toContain('priority: boolean');
  });

  it('reorders a sequence with the shared helper', () => {
    const sequence = ['a', 'b', 'c', 'd'];
    expect(moveStopInSequence(sequence, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveStopInSequence(sequence, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveStopInSequence(sequence, 'b', 1)).toBe(sequence);
    expect(sequencesEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sequencesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('SaveSelectedRouteCandidate after confirm leaves the route planned, not loading', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    const request = { ...createBaseRequest(3), routeId: 'route-1' };
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, result);
    const selected = result.recommended!;
    await new SaveSelectedRouteCandidate(db).execute('route-1', result.requestId, selected.id);
    const route = await new RouteRepository(db).getById('route-1');
    expect(route).toMatchObject({
      status: 'planned',
      selectedRunId: result.requestId,
      selectedCandidateId: selected.id,
    });
    expect(route?.status).not.toBe('loading');
  });

  it('persists a manually reordered candidate before selecting it as planned', async () => {
    const { db } = createDb();
    await draftWithStops(db);
    const request = { ...createBaseRequest(3), routeId: 'route-1' };
    const result = await new RoutingEngine(new SyntheticTravelCostProvider('linear')).optimize(request);
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, result);
    const baseline = result.recommended!;
    const reordered = moveStopInSequence(baseline.stopSequence, baseline.stopSequence[0]!, baseline.stopSequence.length - 1);
    expect(sequencesEqual(reordered, baseline.stopSequence)).toBe(false);
    const manualCandidate = evaluateCandidate({
      stopSequence: reordered,
      generatedBy: ['manual_reorder'],
      request,
      matrix: result.matrix,
    });
    const manualResult = {
      ...result,
      requestId: 'route-1-manual-test',
      recommended: manualCandidate,
      alternatives: [],
      diagnosticCandidate: null,
      candidates: [manualCandidate],
      feasibleRouteFound: manualCandidate.feasible,
      warnings: manualCandidate.warnings,
    };
    await new SQLiteRoutingAuditRepository(db).saveOptimizationRun('route-1', request, manualResult);
    await new SaveSelectedRouteCandidate(db).execute('route-1', manualResult.requestId, manualCandidate.id);
    const route = await new RouteRepository(db).getById('route-1');
    expect(route).toMatchObject({
      status: 'planned',
      selectedRunId: 'route-1-manual-test',
      selectedCandidateId: manualCandidate.id,
    });
    const stops = await new RouteRepository(db).getStops('route-1');
    expect(stops.map((item) => item.id)).toEqual(reordered);
  });
});
