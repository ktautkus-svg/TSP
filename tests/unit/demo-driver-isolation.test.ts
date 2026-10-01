import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { markDemoDatabase, resetDemoDriverDatabase, seedDemoDriverDatabase } from '../../src/application/auth/demo-driver-seed';
import { CreateDraftRoute } from '../../src/application/routes/route-commands';
import { DEMO_DRIVER_ID, isDemoDriverLogin, isPublicDemoPin } from '../../src/domain/demo-driver';
import { bindDemoDatabase, handleDemoEmployeeRequest } from '../../src/infrastructure/auth/demo-employee-api';
import { EmployeeClientError } from '../../src/infrastructure/auth/employee-session';
import type { RouteEndpoint } from '../../src/domain/route';

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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migrationSource = readFileSync(resolve(root, 'src/database/migrations.ts'), 'utf8');

function migration(name: string): string {
  const match = migrationSource.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}

function createDb(): SQLiteDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= 28; version += 1) adapter.raw.exec(migration(`migrationV${version}`));
  return adapter as unknown as SQLiteDatabase;
}

const endpoint: RouteEndpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai',
  geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva',
  latitude: 55.93,
  longitude: 23.31,
};

const when = new Date('2026-09-29T12:00:00');

describe('isolated demo driver', () => {
  it('refuses to seed a real database and leaves its routes untouched', async () => {
    const real = createDb();
    await new CreateDraftRoute(real).execute({ id: 'real-route', startLocation: endpoint, endLocation: endpoint });
    await expect(seedDemoDriverDatabase(real, when)).rejects.toThrow(/demonstracinėje bazėje/);
    await expect(resetDemoDriverDatabase(real, when)).rejects.toThrow(/demonstracinėje bazėje/);
    const routes = await real.getAllAsync<{ id: string }>('SELECT id FROM routes');
    expect(routes).toEqual([{ id: 'real-route' }]);
    expect(await real.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM fuel_entries')).toEqual({ count: 0 });
  });

  it('seeds loading, active and completed routes only inside the marked demo database', async () => {
    const real = createDb();
    const demo = createDb();
    await new CreateDraftRoute(real).execute({ id: 'real-route', startLocation: endpoint, endLocation: endpoint });
    await markDemoDatabase(demo);
    await seedDemoDriverDatabase(demo, when);
    await seedDemoDriverDatabase(demo, when);

    const routes = await demo.getAllAsync<{ id: string; status: string; owner_employee_id: string }>(
      'SELECT id, status, owner_employee_id AS owner_employee_id FROM routes ORDER BY id',
    );
    expect(routes).toEqual([
      { id: 'demo-route-active', status: 'in_progress', owner_employee_id: DEMO_DRIVER_ID },
      { id: 'demo-route-done', status: 'completed', owner_employee_id: DEMO_DRIVER_ID },
      { id: 'demo-route-loading', status: 'loading', owner_employee_id: DEMO_DRIVER_ID },
    ]);
    const loaded = await demo.getFirstAsync<{ weight_kg: number; delivery_time_from: string; phone: string }>(
      'SELECT weight_kg, delivery_time_from, phone FROM delivery_stops WHERE order_number = ?',
      'U-2401',
    );
    expect(loaded).toMatchObject({ weight_kg: 420, delivery_time_from: '08:00', phone: '+37061230011' });
    expect(await demo.getFirstAsync<{ delivery_status: string }>(
      'SELECT delivery_status FROM delivery_stops WHERE order_number = ?',
      'U-2410',
    )).toMatchObject({ delivery_status: 'delivered' });
    expect(await demo.getAllAsync<{ receipt_number: string; liters: number }>(
      'SELECT receipt_number, liters FROM fuel_entries',
    )).toEqual([{ receipt_number: 'DEMO-1001', liters: 46.5 }]);
    expect(await demo.getAllAsync<{ id: string }>('SELECT id FROM operational_contacts ORDER BY id')).toEqual([
      { id: 'demo-contact-dispatcher' },
      { id: 'demo-contact-warehouse' },
    ]);
    expect(await real.getAllAsync<{ id: string }>('SELECT id FROM routes')).toEqual([{ id: 'real-route' }]);
    expect(await real.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM fuel_entries')).toEqual({ count: 0 });
  });

  it('resets the demo database back to the original sample routes', async () => {
    const demo = createDb();
    await markDemoDatabase(demo);
    await seedDemoDriverDatabase(demo, when);
    await demo.runAsync("UPDATE routes SET status = 'cancelled' WHERE id = 'demo-route-loading'");
    await demo.runAsync('DELETE FROM operational_contacts');
    await resetDemoDriverDatabase(demo, when);
    expect(await demo.getFirstAsync<{ status: string }>(
      'SELECT status FROM routes WHERE id = ?',
      'demo-route-loading',
    )).toMatchObject({ status: 'loading' });
    expect(await demo.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM routes')).toEqual({ count: 3 });
    expect(await demo.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM operational_contacts WHERE id LIKE 'demo-contact-%'",
    )).toEqual({ count: 2 });
  });

  it('keeps demo fuel and admin calls away from the real employee server and the real database', async () => {
    const real = createDb();
    const demo = createDb();
    await markDemoDatabase(demo);
    await seedDemoDriverDatabase(demo, when);
    bindDemoDatabase(demo);
    await expect(handleDemoEmployeeRequest('/api/admin/users')).rejects.toMatchObject({ status: 403 });
    await expect(handleDemoEmployeeRequest('/api/financial/summary')).rejects.toBeInstanceOf(EmployeeClientError);
    await expect(handleDemoEmployeeRequest('/api/mail/messages')).rejects.toMatchObject({ status: 403 });
    const body = JSON.stringify({
      filledAt: '2026-09-29T09:00:00.000Z',
      liters: 12.5,
      odometer: 182400,
      receiptNumber: 'DEMO-LIVE',
    });
    await handleDemoEmployeeRequest('/api/routes/demo-route-active/fuel-entries', { method: 'POST', body });
    await handleDemoEmployeeRequest('/api/routes/demo-route-active/fuel-entries', { method: 'POST', body });
    expect(await demo.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM fuel_entries WHERE receipt_number = 'DEMO-LIVE'",
    )).toEqual({ count: 1 });
    expect(await real.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM fuel_entries')).toEqual({ count: 0 });
    bindDemoDatabase(null);
  });

  it('accepts the published PIN only for test1 and rejects it for every real login', () => {
    expect(isDemoDriverLogin('test1', '123456')).toBe(true);
    expect(isDemoDriverLogin(' TEST1 ', ' 123456 ')).toBe(true);
    expect(isDemoDriverLogin('vairuotojas', '123456')).toBe(false);
    expect(isDemoDriverLogin('test1', '123457')).toBe(false);
    expect(isPublicDemoPin('123456')).toBe(true);
    const store = readFileSync(resolve(root, 'server/employee-auth-store.ts'), 'utf8');
    const login = store.slice(store.indexOf('async login('), store.indexOf('async authenticate('));
    expect(login.indexOf('isPublicDemoPin(pin)')).toBeGreaterThan(-1);
    expect(login.indexOf('isPublicDemoPin(pin)')).toBeLessThan(login.indexOf('normalizeUsername'));
    expect(login.indexOf('isPublicDemoPin(pin)')).toBeLessThan(login.indexOf('verifyPin'));
    expect(store).toContain('function validateRealAccountPin');
    expect(store).not.toContain('validateNewPin(input.pin)');
    const gate = readFileSync(resolve(root, 'src/components/local-access-gate.tsx'), 'utf8');
    const submit = gate.slice(gate.indexOf('const submit'), gate.indexOf('const enterDemoDriver'));
    expect(submit.indexOf('isDemoDriverLogin(username, pin)')).toBeGreaterThan(-1);
    expect(submit.indexOf('isDemoDriverLogin(username, pin)')).toBeLessThan(submit.indexOf('loginEmployee'));
    const layout = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');
    expect(layout).toContain('session?.demo ? DEMO_DATABASE_NAME : REAL_DATABASE_NAME');
    expect(layout).toContain('await markDemoDatabase(database)');
    expect(layout).toContain("pathname === '/finance'");
    expect(layout).toContain("pathname === '/fleet'");
    const sync = readFileSync(resolve(root, 'src/application/sync/route-cloud-sync.ts'), 'utf8');
    expect(sync.indexOf('?.demo')).toBeGreaterThan(-1);
    expect(sync.indexOf('?.demo')).toBeLessThan(sync.indexOf('resolveAuthenticatedEmployeeId'));
  });
});
