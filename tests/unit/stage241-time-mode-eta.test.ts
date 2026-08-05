import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { unresolvedExcelIssues } from '../../src/application/import/excel-route-mapper';
import {
  calculateRemainingEtas,
  etaScheduleState,
  persistCandidateEtas,
  RefreshRouteEtas,
} from '../../src/application/routes/route-eta';
import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
import type { ExcelImportPreview } from '../../src/domain/import/excel-models';
import type { ParsedDelivery } from '../../src/domain/import/models';
import type { DeliveryStop, Route } from '../../src/domain/route';

const here = dirname(fileURLToPath(import.meta.url));

describe('Etapas 2.4.1 time mode and ETA contract', () => {
  it('keeps conflicting windows blocking only when time mode is enabled', () => {
    const preview = {
      groups: [{ id: 'g1', originalAddress: 'Dainų g. 11', normalizedAddress: 'Dainų g. 11', issueCodes: ['TIME_WINDOW_CONFLICT'] }],
    } as unknown as ExcelImportPreview;
    const deliveries = [{
      id: 'g1', validationState: 'valid', selectedAddress: { normalizedAddress: 'Dainų g. 11' },
      deliveryTime: { manuallyCorrected: false }, address: { manuallyCorrected: false },
    }] as unknown as ParsedDelivery[];

    expect(unresolvedExcelIssues(preview, deliveries, 'with_time_windows')).toHaveLength(1);
    expect(unresolvedExcelIssues(preview, deliveries, 'ignore_time_windows')).toEqual([]);
  });

  it('stores windows informationally but removes their optimization force in ignore mode', () => {
    const route = routeFixture('ignore_time_windows');
    const request = buildOptimizationRequestFromRoute(route, [stopFixture('s1', 1)]);
    expect(request.planningMode).toBe('ignore_time_windows');
    expect(request.stops[0]?.informationalTimeWindow).toBeDefined();
    expect(request.stops[0]?.requiredTimeWindow).toBeUndefined();
  });

  it('adds travel, waiting and previous service time to every ETA', () => {
    const first = stopFixture('s1', 1, { legDurationMinutes: 15, serviceDurationMinutes: 10, deliveryTimeFrom: '09:00' });
    const second = stopFixture('s2', 2, { legDurationMinutes: 20, serviceDurationMinutes: 10, deliveryTimeFrom: null, deliveryTimeTo: null });
    const result = calculateRemainingEtas(
      { planningMode: 'with_time_windows' },
      [first, second],
      '2026-08-03T08:30:00+03:00',
    );
    expect(result).toEqual([
      { stopId: 's1', arrivalAt: '2026-08-03T05:45:00.000Z' },
      { stopId: 's2', arrivalAt: '2026-08-03T06:30:00.000Z' },
    ]);
  });

  it('keeps original ETA, latest ETA and actual delivery timestamp separate', async () => {
    const db = createDb();
    await insertRouteAndStop(db);
    await persistCandidateEtas(db, 'route-1', [{
      stopId: 's1', order: 1, arrivalAt: '2026-08-03T08:30:00.000Z',
      serviceStartAt: '2026-08-03T08:30:00.000Z', departureAt: '2026-08-03T08:40:00.000Z',
      waitingMinutes: 0, lateMinutes: 0, informationalMismatchMinutes: 0,
    }], [{
      fromId: 'route-start', toId: 's1', departureAt: '2026-08-03T08:20:00.000Z',
      arrivalAt: '2026-08-03T08:30:00.000Z', distanceKm: 8.4, durationMinutes: 10,
      carriedLoadKg: 20, remainingLoadKgAfterArrival: 0, tonneKilometers: 0.168,
      maneuverPenalty: 0, reachable: true, restrictionWarnings: [],
    }], { setOriginalPlan: true, updatedAt: '2026-08-03T08:20:00.000Z', approximate: false });
    await db.runAsync("UPDATE routes SET status = 'in_progress' WHERE id = 'route-1'");
    await new RefreshRouteEtas(db, () => '2026-08-03T08:45:00.000Z').execute('route-1');
    await db.runAsync("UPDATE delivery_stops SET delivered_at = '2026-08-03T09:01:00.000Z' WHERE id = 's1'");
    const row = await db.getFirstAsync<{
      planned_arrival_at: string; latest_estimated_arrival_at: string; delivered_at: string; eta_approximate: number;
    }>('SELECT planned_arrival_at, latest_estimated_arrival_at, delivered_at, eta_approximate FROM delivery_stops WHERE id = ?', 's1');
    expect(row).toEqual({
      planned_arrival_at: '2026-08-03T08:30:00.000Z',
      latest_estimated_arrival_at: '2026-08-03T08:55:00.000Z',
      delivered_at: '2026-08-03T09:01:00.000Z',
      eta_approximate: 1,
    });
  });

  it('labels a materially shifted ETA as late', () => {
    const stop = stopFixture('s1', 1, {
      plannedArrivalAt: '2026-08-03T08:30:00.000Z',
      latestEstimatedArrivalAt: '2026-08-03T08:42:00.000Z',
    });
    expect(etaScheduleState(stop)).toEqual({ state: 'late', differenceMinutes: 12 });
  });
});

function routeFixture(planningMode: Route['planningMode']): Route {
  return {
    id: 'route-1', vehicleId: null, date: '2026-08-03', status: 'draft', planningMode,
    estimatedDistanceKm: null, actualDistanceKm: null, totalWeightKg: 20, remainingWeightKg: 20,
    totalStops: 1, remainingStops: 1, startOdometer: null, endOdometer: null,
    createdAt: '2026-08-03T08:00:00.000Z', updatedAt: '2026-08-03T08:00:00.000Z', startedAt: null,
    completedAt: null, startLocation: endpoint('Startas'), endLocation: endpoint('Pabaiga'),
    plannedDepartureAt: '2026-08-03T08:00:00.000Z', selectedRunId: null, selectedCandidateId: null,
    estimatedDurationMinutes: null, sourceImportAuditId: null, unknownWeightStops: 0,
    remainingUnknownWeightStops: 0, cancelledAt: null, startOdometerRecordedAt: null,
    startOdometerSkippedAt: null, endOdometerRecordedAt: null, activeSequenceSnapshotAt: null,
    completionStartedAt: null, completionEndOdometerDraft: null, completionSummary: null,
  };
}

function stopFixture(id: string, order: number, patch: Partial<DeliveryStop> = {}): DeliveryStop {
  return {
    id, sourceStopId: id, routeId: 'route-1', originalOrder: order, optimizedOrder: order, activeOrder: order,
    orderNumber: null, recipient: '', address: 'Dainų g. 11', originalAddress: 'Dainų g. 11',
    geocodingQuery: 'Dainų g. 11', normalizedAddress: 'Dainų g. 11, Šiauliai', addressValidationState: 'auto_confirmed',
    geocodingError: null, latitude: 55.93, longitude: 23.31, deliveryTimeFrom: '09:00', deliveryTimeTo: '10:00',
    requiredTimeWindow: true, serviceDurationMinutes: 10, plannedArrivalAt: null, plannedDepartureAt: null,
    latestEstimatedArrivalAt: null, legDistanceKm: 8.4, legDurationMinutes: 10, etaUpdatedAt: null,
    etaApproximate: false, weightKg: 20, priorityFirst: false, phone: null, notes: null, loadingStatus: 'loaded',
    deliveryStatus: 'pending', failureReason: null, failureComment: null, loadedAt: null, deliveredAt: null,
    failedAt: null, createdAt: '2026-08-03T08:00:00.000Z', updatedAt: '2026-08-03T08:00:00.000Z',
    ...patch,
  };
}

function endpoint(label: string) {
  return { originalAddress: label, geocodingQuery: label, normalizedAddress: label, latitude: 55.93, longitude: 23.31 };
}

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

function createDb(): SQLiteDatabase {
  const db = new ExpoLikeDatabase();
  const source = readFileSync(resolve(here, '../../src/database/migrations.ts'), 'utf8');
  const tick = String.fromCharCode(96);
  for (let version = 1; version <= 11; version += 1) {
    const match = source.match(new RegExp(`const migrationV${version} = ${tick}([\\s\\S]*?)${tick};`));
    if (!match) throw new Error(`Missing migrationV${version}`);
    db.raw.exec(match[1]);
  }
  return db as unknown as SQLiteDatabase;
}

async function insertRouteAndStop(db: SQLiteDatabase) {
  const now = '2026-08-03T08:00:00.000Z';
  await db.runAsync(
    `INSERT INTO routes (id, date, status, planning_mode, created_at, updated_at, start_location_json, end_location_json, planned_departure_at)
     VALUES ('route-1', '2026-08-03', 'draft', 'with_time_windows', ?, ?, ?, ?, ?)`,
    now, now, JSON.stringify(endpoint('Startas')), JSON.stringify(endpoint('Pabaiga')), now,
  );
  await db.runAsync(
    `INSERT INTO delivery_stops (
      id, route_id, original_order, active_order, recipient, address, original_address,
      normalized_address, address_validation_state, latitude, longitude, delivery_time_from,
      delivery_time_to, required_time_window, service_duration_minutes, weight_kg, created_at, updated_at
    ) VALUES ('s1', 'route-1', 1, 1, '', 'Dainų g. 11', 'Dainų g. 11', 'Dainų g. 11, Šiauliai',
      'auto_confirmed', 55.93, 23.31, '09:00', '10:00', 1, 10, 20, ?, ?)`,
    now, now,
  );
}
