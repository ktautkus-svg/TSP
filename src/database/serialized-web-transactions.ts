import type { SQLiteDatabase } from 'expo-sqlite';

const installed = new WeakSet<object>();

/**
 * Expo SQLite implements web transactions with BEGIN/task/COMMIT on one shared
 * connection. Two React effects can therefore interleave their BEGIN/ROLLBACK
 * calls and replace the useful error with "cannot rollback - no transaction is
 * active". Native platforms have a dedicated exclusive transaction API; on web
 * we serialize the existing application transactions on this database object.
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
      () => runTransaction(db, task),
      () => runTransaction(db, task),
    );
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

async function runTransaction(
  db: SQLiteDatabase,
  task: () => Promise<void>,
): Promise<void> {
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    await task();
    await db.execAsync('COMMIT');
  } catch (error) {
    // Preserve the original database/application error. Expo's unconditional
    // ROLLBACK masks it when another operation has already ended the transaction.
    try {
      if (await db.isInTransactionAsync()) await db.execAsync('ROLLBACK');
    } catch {
      // The original error is the actionable one.
    }
    throw error;
  }
}
