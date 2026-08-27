import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pushRouteAssignmentProgress } from '../../src/application/auth/route-assignment-sync';
import { CreateDraftRouteWithStops } from '../../src/application/routes/route-commands';
import { clearEmployeeSession, saveEmployeeSession, type EmployeeProfile } from '../../src/infrastructure/auth/employee-session';

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

const migrationSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'), 'utf8');
const version = Number(migrationSource.match(/SCHEMA_VERSION = (\d+)/)?.[1]);
function migration(index: number): string {
  const match = migrationSource.match(new RegExp(`const migrationV${index} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing migration ${index}`);
  return match[1];
}
function database(): { db: SQLiteDatabase } {
  const adapter = new ExpoLikeDatabase();
  for (let index = 1; index <= version; index += 1) adapter.raw.exec(migration(index));
  return { db: adapter as unknown as SQLiteDatabase };
}

const endpoint = {
  originalAddress: 'Savanorių pr. 180, Vilnius', geocodingQuery: 'Savanorių pr. 180, Vilnius',
  normalizedAddress: 'Savanorių pr. 180, Vilnius', latitude: 54.675, longitude: 25.24,
};

const adminProfile: EmployeeProfile = { id: 'admin-1', username: 'karolis', displayName: 'Karolis Tautkus', role: 'admin', disabled: false };
const driverProfile: EmployeeProfile = { id: 'driver-1', username: 'vairuotojas', displayName: 'Vairuotojas', role: 'driver', disabled: false };

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearEmployeeSession();
});

describe('pushRouteAssignmentProgress self-assignment', () => {
  it('self-assigns an admin-driven route that never went through the dispatcher flow', async () => {
    const { db } = database();
    const { routeId } = await new CreateDraftRouteWithStops(db).execute({
      commandId: 'cmd-1', startLocation: endpoint, endLocation: endpoint,
      importSource: { type: 'pasted_text', originalText: 'x', imageReference: null },
      stops: [{
        originalOrder: 1, orderNumber: null, recipient: 'Klientas', originalAddress: 'Gedimino pr. 9, Vilnius',
        geocodingQuery: 'Gedimino pr. 9, Vilnius', normalizedAddress: 'Gedimino pr. 9, Vilnius', addressValidationState: 'auto_confirmed',
        latitude: 54.68, longitude: 25.28, deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false,
        weightKg: 10, phone: null, notes: null,
      }],
    });
    await saveEmployeeSession({ profile: adminProfile, expiresAt: '2099-01-01T00:00:00.000Z' });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/assignments')) {
        return new Response(JSON.stringify({
          assignment: {
            id: 'assignment-self-1', routeId, driverId: adminProfile.id, driverName: adminProfile.displayName,
            status: 'assigned', routeSnapshot: {}, progress: null,
            assignedAt: '2026-08-27T08:00:00.000Z', updatedAt: '2026-08-27T08:00:00.000Z',
          },
        }), { status: 201 });
      }
      if (url.includes('/progress')) return new Response(null, { status: 204 });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const pushed = await pushRouteAssignmentProgress(db, routeId);

    expect(pushed).toBe(true);
    expect(fetchMock.mock.calls.some(([call]) => String(call).includes('/api/admin/assignments'))).toBe(true);
    const syncRow = await db.getFirstAsync<{ assignment_id: string }>('SELECT assignment_id FROM route_sync_state WHERE route_id = ?', routeId);
    expect(syncRow?.assignment_id).toBe('assignment-self-1');
  });

  it('does not attempt self-assignment for a plain driver (no permission for that endpoint)', async () => {
    const { db } = database();
    const { routeId } = await new CreateDraftRouteWithStops(db).execute({
      commandId: 'cmd-2', startLocation: endpoint, endLocation: endpoint,
      importSource: { type: 'pasted_text', originalText: 'x', imageReference: null },
      stops: [{
        originalOrder: 1, orderNumber: null, recipient: 'Klientas', originalAddress: 'Gedimino pr. 9, Vilnius',
        geocodingQuery: 'Gedimino pr. 9, Vilnius', normalizedAddress: 'Gedimino pr. 9, Vilnius', addressValidationState: 'auto_confirmed',
        latitude: 54.68, longitude: 25.28, deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false,
        weightKg: 10, phone: null, notes: null,
      }],
    });
    await saveEmployeeSession({ profile: driverProfile, expiresAt: '2099-01-01T00:00:00.000Z' });

    const fetchMock = vi.fn(async () => { throw new Error('should not be called'); });
    vi.stubGlobal('fetch', fetchMock);

    const pushed = await pushRouteAssignmentProgress(db, routeId);

    expect(pushed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
