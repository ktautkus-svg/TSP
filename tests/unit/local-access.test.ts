import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { LocalAccessService, validateNewPin, validatePin, validateUsername } from '../../src/application/auth/local-access';

class ExpoLikeDatabase {
  readonly raw = new DatabaseSync(':memory:');
  constructor() { this.raw.exec('CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)'); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

describe('local owner access', () => {
  it('validates username and numeric PIN', () => {
    expect(validateUsername('  Karolis ')).toBe('karolis');
    expect(() => validateUsername('x')).toThrow();
    expect(() => validatePin('12a4')).toThrow();
    expect(() => validatePin('123')).toThrow();
    expect(() => validatePin('1234')).toThrow();
    expect(() => validatePin('123456')).not.toThrow();
    expect(() => validateNewPin('1234')).toThrow();
    expect(() => validateNewPin('123456')).not.toThrow();
  });

  it('stores only a salted hash, verifies access and changes PIN', async () => {
    const adapter = new ExpoLikeDatabase();
    const service = new LocalAccessService(adapter as unknown as SQLiteDatabase);
    await service.configure('Karolis', '258025');
    expect(await service.verify('karolis', '258025')).toBe(true);
    expect(await service.verify('karolis', '000000')).toBe(false);
    const stored = adapter.raw.prepare('SELECT value FROM app_preferences').all().map((row) => String(row.value));
    expect(stored).not.toContain('258025');
    await service.changePin('258025', '741258');
    expect(await service.verify('karolis', '258025')).toBe(false);
    expect(await service.verify('karolis', '741258')).toBe(true);
  });

  it('replaces an old local device lock after a successful server login', async () => {
    const adapter = new ExpoLikeDatabase();
    const service = new LocalAccessService(adapter as unknown as SQLiteDatabase);
    await service.configure('senas-vartotojas', '258025');
    await service.syncServerCredentials('naujas-vairuotojas', '654321');
    expect(await service.verify('senas-vartotojas', '258025')).toBe(false);
    expect(await service.verify('naujas-vairuotojas', '654321')).toBe(true);
  });
});
