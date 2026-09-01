import type { SQLiteDatabase } from 'expo-sqlite';

const PATCHED = '__tspSafeTransactions';

/**
 * expo-sqlite's withTransactionAsync puts BEGIN inside the same try as the
 * task and always RUNS ROLLBACK in catch. When BEGIN itself failed, or the
 * task already ended the transaction, that ROLLBACK throws
 * "cannot rollback - no transaction is active" and masks the real error
 * (expo/expo#49281). Import, migrations, and leftover schema-28 clients
 * then surface that SQLite noise instead of the original failure.
 */
export function isInactiveTransactionError(error: unknown): boolean {
  return /cannot rollback|cannot commit|no transaction is active/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export function isNestedTransactionError(error: unknown): boolean {
  return /cannot start a transaction within a transaction/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export async function isInTransaction(db: SQLiteDatabase): Promise<boolean> {
  if (typeof db.isInTransactionAsync === 'function') {
    return db.isInTransactionAsync();
  }
  try {
    await db.execAsync('BEGIN');
  } catch (error) {
    if (isNestedTransactionError(error)) return true;
    throw error;
  }
  try {
    await db.execAsync('ROLLBACK');
  } catch (error) {
    if (!isInactiveTransactionError(error)) throw error;
  }
  return false;
}

/** ROLLBACK only when a transaction is open. Never throw the inactive-txn error. */
export async function rollbackIfActive(db: SQLiteDatabase): Promise<void> {
  if (typeof db.isInTransactionAsync === 'function') {
    try {
      if (!(await db.isInTransactionAsync())) return;
    } catch {
      // Fall through to a guarded ROLLBACK.
    }
  }
  try {
    await db.execAsync('ROLLBACK');
  } catch (error) {
    if (isInactiveTransactionError(error)) return;
    throw error;
  }
}

/**
 * Close a leftover explicit transaction (failed BEGIN-wrapped migration blob,
 * interrupted import write) so later BEGIN is not nested.
 */
export async function abortOrphanTransaction(db: SQLiteDatabase): Promise<void> {
  if (await isInTransaction(db)) await rollbackIfActive(db);
}

export async function withSafeTransactionAsync(
  db: SQLiteDatabase,
  task: () => Promise<void>,
  options?: { begin?: 'BEGIN' | 'BEGIN IMMEDIATE' },
): Promise<void> {
  const begin = options?.begin ?? 'BEGIN';
  try {
    await db.execAsync(begin);
  } catch (error) {
    if (!isNestedTransactionError(error)) throw error;
    // An unexpected leftover transaction is already unusable; discard it and
    // open a fresh one rather than rolling back a txn we never started while
    // no transaction is active.
    await rollbackIfActive(db);
    await db.execAsync(begin);
  }
  try {
    await task();
    await db.execAsync('COMMIT');
  } catch (error) {
    await rollbackIfActive(db);
    throw error;
  }
}

/** Patch this connection for the rest of the PWA session. */
export function installSafeTransactions(db: SQLiteDatabase): void {
  const patched = db as SQLiteDatabase & { [PATCHED]?: boolean };
  if (patched[PATCHED]) return;
  patched[PATCHED] = true;
  db.withTransactionAsync = (task) => withSafeTransactionAsync(db, task);
}
