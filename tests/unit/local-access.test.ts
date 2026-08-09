import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { LocalAccessService, validatePin, validateUsername } from '../../src/application/auth/local-access';

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
    expect(() => validatePin('1234')).not.toThrow();
  });

  it('stores only a salted hash, verifies access and changes PIN', async () => {
    const adapter = new ExpoLikeDatabase();
    const service = new LocalAccessService(adapter as unknown as SQLiteDatabase);
    await service.configure('Karolis', '2580');
    expect(await service.verify('karolis', '2580')).toBe(true);
    expect(await service.verify('karolis', '0000')).toBe(false);
    const stored = adapter.raw.prepare('SELECT value FROM app_preferences').all().map((row) => String(row.value));
    expect(stored).not.toContain('2580');
    await service.changePin('2580', '7412');
    expect(await service.verify('karolis', '2580')).toBe(false);
    expect(await service.verify('karolis', '7412')).toBe(true);
  });

  it('replaces an old local device lock after a successful server login', async () => {
    const adapter = new ExpoLikeDatabase();
    const service = new LocalAccessService(adapter as unknown as SQLiteDatabase);
    await service.configure('senas-vartotojas', '2580');
    await service.syncServerCredentials('naujas-vairuotojas', '654321');
    expect(await service.verify('senas-vartotojas', '2580')).toBe(false);
    expect(await service.verify('naujas-vairuotojas', '654321')).toBe(true);
  });
});
