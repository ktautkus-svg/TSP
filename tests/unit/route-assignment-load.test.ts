import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { buildQualityRouteMonitor, type RouteAssignment } from '../../server/employee-auth-store';
import { importAssignmentSnapshot } from '../../src/application/auth/route-assignment-sync';

class ExpoLikeDatabase {
  readonly raw = new DatabaseSync(':memory:');
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

const migrationSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
const schemaVersion = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)?.[1]);

function database(): { adapter: ExpoLikeDatabase; db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= schemaVersion; version += 1) {
    const match = migrationSource.match(new RegExp(`const migrationV${version} = \`([\\s\\S]*?)\`;`));
    if (!match) throw new Error(`Missing migration V${version}`);
    adapter.raw.exec(match[1]);
  }
  adapter.raw.exec('PRAGMA foreign_keys = ON;');
  return { adapter, db: adapter as unknown as SQLiteDatabase };
}

function assignments(): RouteAssignment[] {
  const base = new Date('2026-08-17T06:00:00.000Z');
  return Array.from({ length: 30 }, (_, index) => {
    const driverIndex = index % 6;
    const routeForDriver = Math.floor(index / 6);
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + routeForDriver);
    const routeId = `load-route-${String(index + 1).padStart(2, '0')}`;
    const driverId = `load-driver-${driverIndex + 1}`;
    const inProgress = routeForDriver === 0;
    const stops = Array.from({ length: 4 }, (_, stopIndex) => ({
      id: `${routeId}-stop-${stopIndex + 1}`,
      route_id: routeId,
      original_order: stopIndex + 1,
      active_order: stopIndex + 1,
      recipient: `Gavėjas ${index + 1}-${stopIndex + 1}`,
      address: `Bandomoji g. ${index + 1}-${stopIndex + 1}`,
      weight_kg: 100 + stopIndex * 10,
      delivery_status: inProgress && stopIndex === 0 ? 'delivered' : 'pending',
      delivered_at: inProgress && stopIndex === 0 ? date.toISOString() : null,
      created_at: date.toISOString(),
      updated_at: date.toISOString(),
    }));
    return {
      id: `load-assignment-${String(index + 1).padStart(2, '0')}`,
      routeId,
      driverId,
      driverName: `Vairuotojas ${driverIndex + 1}`,
      status: inProgress ? 'in_progress' : 'assigned',
      progress: null,
      createdBy: 'load-test-admin',
      assignedAt: date.toISOString(),
      updatedAt: date.toISOString(),
      vehicle: {
        id: `vehicle-${driverIndex + 1}`,
        registrationNumber: `TSP00${driverIndex + 1}`,
        model: 'Ford Transit',
        maximumPayloadKg: 1500,
      },
      routeSnapshot: {
        route: {
          id: routeId,
          date: date.toISOString().slice(0, 10),
          status: inProgress ? 'in_progress' : 'planned',
          total_weight_kg: 460,
          remaining_weight_kg: inProgress ? 360 : 460,
          total_stops: 4,
          remaining_stops: inProgress ? 3 : 4,
          created_at: date.toISOString(),
          updated_at: date.toISOString(),
          started_at: inProgress ? date.toISOString() : null,
        },
        stops,
        shipmentLines: stops.map((stop, stopIndex) => ({
          id: `${routeId}-line-${stopIndex + 1}`,
          route_id: routeId,
          delivery_stop_id: stop.id,
          source_import_id: `load-import-${index + 1}`,
          source_sheet_name: 'Apkrovos testas',
          source_row_number: stopIndex + 1,
          route_code: `R${String(11 + driverIndex).padStart(2, '0')}`,
          order_number: `LOAD-${index + 1}-${stopIndex + 1}`,
          raw_row_json: '{}',
          created_at: date.toISOString(),
        })),
      },
    } satisfies RouteAssignment;
  });
}

describe('30-route multi-driver assignment load', () => {
  it('keeps five current/future routes for every driver without overwriting another assignment', async () => {
    const all = assignments();
    expect(all).toHaveLength(30);

    for (let driverIndex = 0; driverIndex < 6; driverIndex += 1) {
      const driverId = `load-driver-${driverIndex + 1}`;
      const driverAssignments = all.filter((assignment) => assignment.driverId === driverId);
      const { adapter, db } = database();
      for (const assignment of driverAssignments) await importAssignmentSnapshot(db, assignment, driverId);

      expect(driverAssignments).toHaveLength(5);
      expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM routes').get()).toMatchObject({ count: 5 });
      expect(adapter.raw.prepare('SELECT COUNT(*) AS count FROM route_sync_state WHERE employee_id = ?').get(driverId)).toMatchObject({ count: 5 });
      expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM routes WHERE status = 'in_progress'").get()).toMatchObject({ count: 1 });
      expect(adapter.raw.prepare("SELECT COUNT(*) AS count FROM routes WHERE status = 'planned'").get()).toMatchObject({ count: 4 });
      expect(adapter.raw.prepare('SELECT COUNT(DISTINCT date) AS count FROM routes').get()).toMatchObject({ count: 5 });
    }
  });

  it('builds all 30 quality-control summaries with live and future work intact', () => {
    const monitors = assignments().map((assignment) => buildQualityRouteMonitor(assignment, assignment.vehicle));
    const byDriver = Map.groupBy(monitors, (route) => route.driverId);

    expect(monitors).toHaveLength(30);
    expect(byDriver.size).toBe(6);
    expect([...byDriver.values()].every((routes) => routes.length === 5)).toBe(true);
    expect(monitors.filter((route) => route.status === 'in_progress')).toHaveLength(6);
    expect(monitors.filter((route) => route.status === 'assigned')).toHaveLength(24);
    expect(monitors.every((route) => route.totalStops === 4 && route.nextStop)).toBe(true);
    expect(new Set(monitors.map((route) => route.routeId)).size).toBe(30);
  });
});
