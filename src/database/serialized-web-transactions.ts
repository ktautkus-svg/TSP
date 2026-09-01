import type { SQLiteDatabase } from 'expo-sqlite';

import { withSafeTransactionAsync } from './sqlite-transaction';

const installed = new WeakSet<object>();

/**
 * Expo SQLite implements web transactions with BEGIN/task/COMMIT on one shared
 * connection. Two React effects can therefore interleave their BEGIN/ROLLBACK
 * calls and replace the useful error with "cannot rollback - no transaction is
 * active". Native platforms have a dedicated exclusive transaction API; on web
 * we serialize the existing application transactions on this database object.
 *
 * Each queued write uses withSafeTransactionAsync so a leftover nested BEGIN
 * or a self-committed task cannot replace the real error with
 * "cannot rollback - no transaction is active".
 */
export function installSerializedWebTransactions(
  db: SQLiteDatabase,
  platform: string = typeof document === 'undefined' ? 'native' : 'web',
): void {
  if (platform !== 'web' || installed.has(db)) return;
  installed.add(db);

  let tail: Promise<void> = Promise.resolve();
  db.withTransactionAsync = async (task: () => Promise<void>): Promise<void> => {
    const run = tail.then(
      () => withSafeTransactionAsync(db, task, { begin: 'BEGIN IMMEDIATE' }),
      () => withSafeTransactionAsync(db, task, { begin: 'BEGIN IMMEDIATE' }),
    );
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
