import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import {
  abortOrphanTransaction,
  installSafeTransactions,
  rollbackIfActive,
  withSafeTransactionAsync,
} from '../../src/database/sqlite-transaction';

/**
 * Mirrors expo-sqlite's withTransactionAsync: BEGIN is inside the try, and
 * catch always runs ROLLBACK even when no transaction is active.
 */
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
    try {
      await this.execAsync('BEGIN');
      await operation();
      await this.execAsync('COMMIT');
    } catch (error) {
      await this.execAsync('ROLLBACK');
      throw error;
    }
  }
}

function dbOf(adapter: ExpoLikeDatabase): SQLiteDatabase {
  return adapter as unknown as SQLiteDatabase;
}

describe('safe SQLite transactions', () => {
  it('rollbackIfActive is a no-op when no transaction is open', async () => {
    const adapter = new ExpoLikeDatabase();
    await expect(rollbackIfActive(dbOf(adapter))).resolves.toBeUndefined();
    adapter.raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY)');
    await expect(rollbackIfActive(dbOf(adapter))).resolves.toBeUndefined();
  });

  it('expo-sqlite-style catch masks a self-committed task as cannot rollback', async () => {
    const adapter = new ExpoLikeDatabase();
    adapter.raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

    await expect(adapter.withTransactionAsync(async () => {
      await adapter.execAsync('COMMIT');
      throw new Error('real task error');
    })).rejects.toThrow(/cannot rollback|no transaction is active/i);
  });

  it('withSafeTransactionAsync surfaces the real task error instead of cannot rollback', async () => {
    const adapter = new ExpoLikeDatabase();
    const db = dbOf(adapter);
    adapter.raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');

    await expect(withSafeTransactionAsync(db, async () => {
      await db.execAsync('COMMIT');
      throw new Error('real task error');
    })).rejects.toThrow('real task error');
  });

  it('recovers from a leftover open transaction instead of nested BEGIN + rollback', async () => {
    const adapter = new ExpoLikeDatabase();
    const db = dbOf(adapter);
    adapter.raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    adapter.raw.exec('BEGIN');
    adapter.raw.exec("INSERT INTO items (name) VALUES ('orphan')");

    installSafeTransactions(db);
    await expect(db.withTransactionAsync(async () => {
      await db.runAsync("INSERT INTO items (name) VALUES ('kept')");
    })).resolves.toBeUndefined();

    expect(adapter.raw.prepare('SELECT name FROM items').all().map((row) => String((row as { name: string }).name)))
      .toEqual(['kept']);
  });

  it('abortOrphanTransaction closes a leftover BEGIN so later writes commit', async () => {
    const adapter = new ExpoLikeDatabase();
    const db = dbOf(adapter);
    adapter.raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
    adapter.raw.exec('BEGIN');
    adapter.raw.exec("INSERT INTO items (name) VALUES ('partial')");

    await abortOrphanTransaction(db);
    await db.runAsync("INSERT INTO items (name) VALUES ('after-abort')");

    expect(adapter.raw.prepare('SELECT name FROM items').all())
      .toEqual([{ name: 'after-abort' }]);
  });
});
