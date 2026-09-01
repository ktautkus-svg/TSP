import { describe, expect, it, vi } from 'vitest';

import { installSerializedWebTransactions } from '../../src/database/serialized-web-transactions';

describe('serialized web SQLite transactions', () => {
  it('does not interleave concurrent transactions', async () => {
    const events: string[] = [];
    let inTransaction = false;
    const db = {
      async execAsync(sql: string) {
        events.push(sql);
        if (sql.startsWith('BEGIN')) inTransaction = true;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') inTransaction = false;
      },
      async isInTransactionAsync() { return inTransaction; },
      async withTransactionAsync(_task: () => Promise<void>) {
        throw new Error('unpatched');
      },
    };
    installSerializedWebTransactions(db as never, 'web');

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = db.withTransactionAsync(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
    });
    const second = db.withTransactionAsync(async () => {
      events.push('second');
    });
    await vi.waitFor(() => {
      expect(events).toEqual(['BEGIN IMMEDIATE', 'first:start']);
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'BEGIN IMMEDIATE', 'first:start', 'first:end', 'COMMIT',
      'BEGIN IMMEDIATE', 'second', 'COMMIT',
    ]);
  });

  it('preserves the original error even if rollback is no longer possible', async () => {
    let inTransaction = false;
    const db = {
      async execAsync(sql: string) {
        if (sql.startsWith('BEGIN')) inTransaction = true;
        if (sql === 'ROLLBACK') throw new Error('cannot rollback - no transaction is active');
      },
      async isInTransactionAsync() { return inTransaction; },
      async withTransactionAsync(_task: () => Promise<void>) {
        throw new Error('unpatched');
      },
    };
    installSerializedWebTransactions(db as never, 'web');
    await expect(db.withTransactionAsync(async () => {
      throw new Error('Excel eilutė negalėjo būti išsaugota');
    })).rejects.toThrow('Excel eilutė negalėjo būti išsaugota');
  });
});
