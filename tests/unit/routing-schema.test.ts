import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { createBaseRequest } from '../../src/domain/routing/scenarios';
import { SQLiteRoutingAuditRepository } from '../../src/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

describe('SQLite routing audit migration', () => {
  it('migrates from v1 through v3 and creates auditable routing tables', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'),
      'utf8',
    );
    const extract = (name: string) => {
      const match = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
      if (!match) throw new Error(`Missing ${name}`);
      return match[1];
    };
    const db = new DatabaseSync(':memory:');
    db.exec(extract('migrationV1'));
    db.exec(extract('migrationV2'));
    db.exec(extract('migrationV3'));
    db.exec(extract('migrationV4'));
    db.exec(extract('migrationV5'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 5 });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((row) => String(row.name));
    expect(tables).toEqual(
      expect.arrayContaining([
        'routing_engine_runs',
        'routing_engine_candidates',
        'routing_recalculations',
        'routing_matrix_cache',
        'import_audits',
      ]),
    );
    const stopColumns = db.prepare(`PRAGMA table_info(delivery_stops)`).all();
    expect(stopColumns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'active_order' }),
      expect.objectContaining({ name: 'original_address' }),
      expect.objectContaining({ name: 'normalized_address' }),
      expect.objectContaining({ name: 'weight_kg', notnull: 0 }),
    ]));
  });

  it('migrates an existing schema v3 through import audit and durable route v5', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'),
      'utf8',
    );
    const extract = (name: string) => {
      const match = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
      if (!match) throw new Error(`Missing ${name}`);
      return match[1];
    };
    const db = new DatabaseSync(':memory:');
    db.exec(extract('migrationV1'));
    db.exec(extract('migrationV2'));
    db.exec(extract('migrationV3'));
    db.prepare(`INSERT INTO routes (
      id, date, status, total_weight_kg, remaining_weight_kg,
      total_stops, remaining_stops, created_at, updated_at
    ) VALUES ('legacy-route', '2026-08-03', 'draft', 0, 0, 1, 1, 'now', 'now')`).run();
    db.prepare(`INSERT INTO delivery_stops (
      id, route_id, original_order, address, weight_kg, created_at, updated_at
    ) VALUES ('legacy-stop', 'legacy-route', 1, 'Dvaro g. 1', 0, 'now', 'now')`).run();
    db.exec(extract('migrationV4'));
    db.exec(extract('migrationV5'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 5 });
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='import_audits'`).get()).toBeTruthy();
    expect(db.prepare(`SELECT id, original_address, weight_kg FROM delivery_stops WHERE id='legacy-stop'`).get()).toMatchObject({
      id: 'legacy-stop',
      original_address: 'Dvaro g. 1',
      weight_kg: 0,
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('writes a run and its candidates through the repository boundary', async () => {
    const statements: string[] = [];
    const fakeDb = {
      withTransactionAsync: async (operation: () => Promise<void>) => operation(),
      runAsync: async (sql: string) => {
        statements.push(sql);
        return {};
      },
    } as unknown as SQLiteDatabase;
    const request = createBaseRequest(2);
    const result = await new RoutingEngine(
      new SyntheticTravelCostProvider('linear'),
    ).optimize(request);
    await new SQLiteRoutingAuditRepository(fakeDb).saveOptimizationRun(
      'persisted-route',
      request,
      result,
    );
    expect(statements.some((sql) => sql.includes('routing_engine_runs'))).toBe(true);
    expect(
      statements.filter((sql) => sql.includes('routing_engine_candidates')),
    ).toHaveLength(result.candidates.length);
  });
});
