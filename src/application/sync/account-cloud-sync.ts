import type { SQLiteDatabase } from 'expo-sqlite';

import { ACCOUNT_PREFERENCE_KEYS, isAccountPreferenceKey } from '@/application/sync/account-preference-allowlist';
import { employeeApi, type EmployeeProfile } from '@/infrastructure/auth/employee-session';

const ENTITIES = ['saved_location', 'preference'] as const;
type AccountSyncEntity = (typeof ENTITIES)[number];

type AccountSyncPushItem = {
  entity: AccountSyncEntity;
  localId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
};

type AccountSyncPushResult =
  | { entity: AccountSyncEntity; localId: string; outcome: 'applied' }
  | { entity: AccountSyncEntity; localId: string; outcome: 'conflict'; payload: Record<string, unknown>; deleted: boolean }
  | { entity: string; localId: string; outcome: 'rejected'; reason: string };

type AccountSyncPulledItem = {
  entity: AccountSyncEntity;
  localId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  serverUpdatedAt: string;
};

export type AccountCloudSyncResult = {
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
  deleted: number;
  /** Rows owned by a different account, deliberately never uploaded. */
  foreign: number;
};

const EMPTY_RESULT: AccountCloudSyncResult = { pushed: 0, pulled: 0, conflicts: 0, rejected: 0, deleted: 0, foreign: 0 };

/**
 * Synchronises the account-scoped data that has to follow the person rather
 * than the device: saved locations (the warehouse/home a route is planned
 * around) and the small allowlist of portable preferences.
 *
 * Deliberately a separate channel from route sync — an account's warehouse is
 * not part of any route snapshot, and overloading the snapshot would tie
 * unrelated data to route conflict rules. Throws on network/auth failure so the
 * caller can treat it as "stayed offline", matching every other sync entry
 * point.
 */
export async function syncAccountDataWithCloud(db: SQLiteDatabase): Promise<AccountCloudSyncResult> {
  const employeeId = await resolveAuthenticatedEmployeeId();
  await claimUnownedAccountData(db, employeeId);
  const pushOutcome = await pushDirtyAccountData(db, employeeId);
  const pullOutcome = await pullAccountData(db, employeeId);
  return {
    pushed: pushOutcome.pushed,
    conflicts: pushOutcome.conflicts,
    rejected: pushOutcome.rejected,
    foreign: pushOutcome.foreign,
    pulled: pullOutcome.pulled,
    deleted: pullOutcome.deleted,
  };
}

/**
 * Identity comes from the server session, never from the cached client profile:
 * this id decides whose cloud account local rows are uploaded into.
 */
async function resolveAuthenticatedEmployeeId(): Promise<string> {
  const identity = await employeeApi<{ profile: EmployeeProfile }>('/api/auth/me');
  const employeeId = String(identity?.profile?.id ?? '');
  if (!employeeId) throw new Error('Serveris nepatvirtino darbuotojo tapatybės.');
  return employeeId;
}

/**
 * Same conservative rule route sync uses: the first account to sync on a device
 * adopts what is already there (the migration path for data created before
 * ownership existed), and any later account claims only what it created after
 * it started using the device. Ambiguous historical data is never handed to the
 * wrong account, and nothing is deleted to achieve that.
 */
async function claimUnownedAccountData(db: SQLiteDatabase, employeeId: string): Promise<void> {
  const account = await db.getFirstAsync<{ claim_from: string }>(
    'SELECT claim_from FROM sync_accounts WHERE employee_id = ?',
    employeeId,
  );
  let claimFrom = account?.claim_from ?? null;
  if (claimFrom === null) {
    const other = await db.getFirstAsync<{ employee_id: string }>('SELECT employee_id FROM sync_accounts LIMIT 1');
    claimFrom = other ? new Date().toISOString() : '';
    const now = new Date().toISOString();
    await db.runAsync(
      'INSERT INTO sync_accounts (employee_id, claim_from, created_at, updated_at) VALUES (?, ?, ?, ?)',
      employeeId, claimFrom, now, now,
    );
  }
  await db.runAsync(
    'UPDATE saved_locations SET owner_employee_id = ? WHERE owner_employee_id IS NULL AND created_at >= ?',
    employeeId, claimFrom,
  );
  await db.runAsync(
    `UPDATE app_preferences SET owner_employee_id = ?
     WHERE owner_employee_id IS NULL AND sync_scope = 'account' AND updated_at >= ?`,
    employeeId, claimFrom,
  );
}

async function pushDirtyAccountData(db: SQLiteDatabase, employeeId: string): Promise<{
  pushed: number; conflicts: number; rejected: number; foreign: number;
}> {
  const foreignRow = await db.getFirstAsync<{ count: number }>(
    `SELECT (SELECT count(*) FROM saved_locations WHERE owner_employee_id IS NOT NULL AND owner_employee_id <> ?)
          + (SELECT count(*) FROM app_preferences WHERE sync_scope = 'account' AND owner_employee_id IS NOT NULL AND owner_employee_id <> ?)
       AS count`,
    employeeId, employeeId,
  );
  const foreign = foreignRow?.count ?? 0;

  const items: AccountSyncPushItem[] = [];

  const locations = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM saved_locations
     WHERE owner_employee_id = ? AND (cloud_synced_at IS NULL OR updated_at > cloud_synced_at)`,
    employeeId,
  );
  for (const row of locations) {
    items.push({
      entity: 'saved_location',
      localId: String(row.kind ?? ''),
      payload: locationPayload(row),
      deleted: Boolean(row.cloud_deleted_at),
    });
  }

  const preferences = await db.getAllAsync<{ key: string; value: string; updated_at: string; cloud_synced_at: string | null }>(
    `SELECT key, value, updated_at, cloud_synced_at FROM app_preferences
     WHERE sync_scope = 'account' AND owner_employee_id = ?
       AND (cloud_synced_at IS NULL OR updated_at > cloud_synced_at)`,
    employeeId,
  );
  for (const row of preferences) {
    // Belt and braces: the scope column already restricts this, but the
    // allowlist is re-checked here so a mis-scoped row can never leave.
    if (!isAccountPreferenceKey(row.key)) continue;
    items.push({
      entity: 'preference',
      localId: row.key,
      payload: { key: row.key, value: row.value, updated_at: row.updated_at },
      deleted: false,
    });
  }

  if (items.length === 0) return { pushed: 0, conflicts: 0, rejected: 0, foreign };

  const response = await employeeApi<{ results: AccountSyncPushResult[] }>('/api/account-sync', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });

  let pushed = 0;
  let conflicts = 0;
  let rejected = 0;
  for (const result of response.results) {
    if (result.outcome === 'applied') {
      const item = items.find((entry) => entry.entity === result.entity && entry.localId === result.localId);
      const updatedAt = String(item?.payload.updated_at ?? '');
      if (updatedAt) await markSynced(db, result.entity as AccountSyncEntity, result.localId, updatedAt);
      pushed += 1;
    } else if (result.outcome === 'conflict') {
      await applyPulledItem(db, employeeId, {
        entity: result.entity as AccountSyncEntity,
        localId: result.localId,
        payload: result.payload,
        deleted: result.deleted,
        serverUpdatedAt: String(result.payload.updated_at ?? ''),
      });
      conflicts += 1;
    } else {
      rejected += 1;
    }
  }
  return { pushed, conflicts, rejected, foreign };
}

async function pullAccountData(db: SQLiteDatabase, employeeId: string): Promise<{ pulled: number; deleted: number }> {
  const query: string[] = [];
  for (const entity of ENTITIES) {
    const cursor = await getSyncCursor(db, entity, employeeId);
    if (cursor) query.push(`since_${entity}=${encodeURIComponent(cursor)}`);
  }
  const response = await employeeApi<{ items: AccountSyncPulledItem[]; cursors: Record<AccountSyncEntity, string> }>(
    `/api/account-sync${query.length ? `?${query.join('&')}` : ''}`,
  );

  let pulled = 0;
  let deleted = 0;
  for (const item of response.items) {
    const outcome = await applyPulledItem(db, employeeId, item);
    if (outcome === 'applied') pulled += 1;
    else if (outcome === 'deleted') deleted += 1;
  }

  for (const entity of ENTITIES) {
    const cursor = response.cursors?.[entity];
    if (cursor) await setSyncCursor(db, entity, employeeId, cursor);
  }
  return { pulled, deleted };
}

async function applyPulledItem(
  db: SQLiteDatabase,
  employeeId: string,
  item: AccountSyncPulledItem,
): Promise<'applied' | 'deleted' | 'skipped'> {
  if (item.entity === 'preference' && !isAccountPreferenceKey(item.localId)) {
    // The server allowlist already refuses these; ignoring them here as well
    // means a compromised or future server cannot write an arbitrary
    // preference — least of all the offline unlock credential — into this
    // device's database.
    return 'skipped';
  }

  const incomingUpdatedAt = String(item.payload?.updated_at ?? '');
  if (!incomingUpdatedAt) return 'skipped';

  if (item.entity === 'saved_location') {
    const existing = await db.getFirstAsync<{ updated_at: string }>(
      'SELECT updated_at FROM saved_locations WHERE kind = ?',
      item.localId,
    );
    if (existing && String(existing.updated_at) > incomingUpdatedAt) return 'skipped';
    if (item.deleted) {
      if (!existing) return 'skipped';
      await db.runAsync('DELETE FROM saved_locations WHERE kind = ?', item.localId);
      return 'deleted';
    }
    await db.runAsync(
      `INSERT INTO saved_locations (kind, label, endpoint_json, created_at, updated_at, owner_employee_id, cloud_synced_at, cloud_deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(kind) DO UPDATE SET
         label = excluded.label,
         endpoint_json = excluded.endpoint_json,
         updated_at = excluded.updated_at,
         owner_employee_id = excluded.owner_employee_id,
         cloud_synced_at = excluded.cloud_synced_at,
         cloud_deleted_at = NULL`,
      item.localId,
      String(item.payload.label ?? ''),
      String(item.payload.endpoint_json ?? ''),
      String(item.payload.created_at ?? incomingUpdatedAt),
      incomingUpdatedAt,
      employeeId,
      incomingUpdatedAt,
    );
    return 'applied';
  }

  const existing = await db.getFirstAsync<{ updated_at: string }>(
    'SELECT updated_at FROM app_preferences WHERE key = ?',
    item.localId,
  );
  if (existing && String(existing.updated_at) > incomingUpdatedAt) return 'skipped';
  await db.runAsync(
    `INSERT INTO app_preferences (key, value, updated_at, sync_scope, owner_employee_id, cloud_synced_at)
     VALUES (?, ?, ?, 'account', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at,
       sync_scope = 'account',
       owner_employee_id = excluded.owner_employee_id,
       cloud_synced_at = excluded.cloud_synced_at`,
    item.localId,
    String(item.payload.value ?? ''),
    incomingUpdatedAt,
    employeeId,
    incomingUpdatedAt,
  );
  return 'applied';
}

/**
 * Marks a saved location as deleted for the cloud. The row stays until the
 * server confirms, because the row is what carries the tombstone into the push.
 */
export async function markSavedLocationDeletedForCloud(db: SQLiteDatabase, kind: string): Promise<void> {
  const row = await db.getFirstAsync<{ updated_at: string; cloud_synced_at: string | null }>(
    'SELECT updated_at, cloud_synced_at FROM saved_locations WHERE kind = ?',
    kind,
  );
  if (!row) return;
  const now = new Date().toISOString();
  const floor = [String(row.updated_at ?? ''), String(row.cloud_synced_at ?? '')].reduce((left, right) => (left > right ? left : right), '');
  const parsedFloor = Date.parse(floor);
  const stamp = now > floor || Number.isNaN(parsedFloor) ? now : new Date(parsedFloor + 1).toISOString();
  await db.runAsync('UPDATE saved_locations SET cloud_deleted_at = ?, updated_at = ? WHERE kind = ?', stamp, stamp, kind);
}

function locationPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: String(row.kind ?? ''),
    label: String(row.label ?? ''),
    endpoint_json: String(row.endpoint_json ?? ''),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

async function markSynced(db: SQLiteDatabase, entity: AccountSyncEntity, localId: string, updatedAt: string): Promise<void> {
  if (entity === 'saved_location') {
    const row = await db.getFirstAsync<{ cloud_deleted_at: string | null }>(
      'SELECT cloud_deleted_at FROM saved_locations WHERE kind = ?',
      localId,
    );
    if (row?.cloud_deleted_at) {
      // The tombstone is the cloud's copy now, so the local row has done its job.
      await db.runAsync('DELETE FROM saved_locations WHERE kind = ?', localId);
      return;
    }
    await db.runAsync('UPDATE saved_locations SET cloud_synced_at = ? WHERE kind = ?', updatedAt, localId);
    return;
  }
  await db.runAsync('UPDATE app_preferences SET cloud_synced_at = ? WHERE key = ?', updatedAt, localId);
}

async function getSyncCursor(db: SQLiteDatabase, entity: AccountSyncEntity, employeeId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ cursor: string }>(
    'SELECT cursor FROM sync_cursors WHERE entity = ? AND employee_id = ?',
    entity, employeeId,
  );
  return row?.cursor ?? null;
}

async function setSyncCursor(db: SQLiteDatabase, entity: AccountSyncEntity, employeeId: string, cursor: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sync_cursors (entity, employee_id, cursor, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity, employee_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    entity, employeeId, cursor, now,
  );
}

export { ACCOUNT_PREFERENCE_KEYS, EMPTY_RESULT as EMPTY_ACCOUNT_SYNC_RESULT };
