import type { SQLiteDatabase } from 'expo-sqlite';

import { applyRouteSnapshot, exportRouteSnapshot } from '@/application/auth/route-assignment-sync';
import { employeeApi, type EmployeeProfile, type RouteSnapshot } from '@/infrastructure/auth/employee-session';

const CURSOR_ENTITY = 'routes';
const NON_TERMINAL_STATUSES = ['draft', 'planned', 'loading', 'loaded', 'in_progress'];

type RouteSyncPushItem = { routeSnapshot: RouteSnapshot; deleted: boolean };
type RouteSyncPushResult =
  | { routeId: string; outcome: 'applied' }
  | { routeId: string; outcome: 'conflict'; routeSnapshot: RouteSnapshot; deleted: boolean }
  | { routeId: string; outcome: 'forbidden' };
type RouteSyncPulledRoute = { routeSnapshot: RouteSnapshot; deleted: boolean; serverUpdatedAt: string };

export type RouteCloudSyncResult = {
  pushed: number;
  conflicts: number;
  pulled: number;
  deferred: number;
  /** Local routes owned by a different account, deliberately never uploaded. */
  foreign: number;
};

/**
 * Pushes every locally-dirty route owned by the authenticated account, then
 * pulls anything newer from that account's other devices. Throws on
 * network/auth failure; callers are expected to catch and treat it as "stayed
 * offline", matching the existing `pullAssignedRoutes` convention.
 */
export async function syncRoutesWithCloud(db: SQLiteDatabase): Promise<RouteCloudSyncResult> {
  const employeeId = await resolveAuthenticatedEmployeeId();
  await claimUnownedRoutes(db, employeeId);
  const pushOutcome = await pushDirtyRoutes(db, employeeId);
  const pullOutcome = await pullRemoteRoutes(db, employeeId);
  return { ...pushOutcome, ...pullOutcome };
}

/**
 * Resolves who this sync pass belongs to from the *server session*, not from
 * the client-cached profile. Which local routes get uploaded into which cloud
 * account is decided by this id, so a stale cached identity would be a
 * cross-account data leak rather than a display glitch.
 */
async function resolveAuthenticatedEmployeeId(): Promise<string> {
  const identity = await employeeApi<{ profile: EmployeeProfile }>('/api/auth/me');
  const employeeId = String(identity?.profile?.id ?? '');
  if (!employeeId) throw new Error('Serveris nepatvirtino darbuotojo tapatybės.');
  return employeeId;
}

/**
 * Decides which unowned local routes belong to this account.
 *
 * The first account ever to sync on a device adopts everything already there —
 * that is the migration path for routes created before ownership existed. Every
 * later account has a claim boundary set to the moment it first synced here, so
 * it only ever claims routes created after it started using the device. A
 * driver's route history can therefore never be uploaded into a colleague's
 * cloud account by signing in on their tablet, and nothing is deleted to
 * achieve that: unclaimed routes stay fully usable locally, they are simply
 * never pushed.
 */
async function claimUnownedRoutes(db: SQLiteDatabase, employeeId: string): Promise<void> {
  const account = await db.getFirstAsync<{ claim_from: string }>(
    'SELECT claim_from FROM sync_accounts WHERE employee_id = ?',
    employeeId,
  );
  let claimFrom = account?.claim_from ?? null;
  if (claimFrom === null) {
    const other = await db.getFirstAsync<{ employee_id: string }>('SELECT employee_id FROM sync_accounts LIMIT 1');
    // An empty boundary sorts before every ISO timestamp, so the first account
    // claims the whole pre-existing database.
    claimFrom = other ? new Date().toISOString() : '';
    const now = new Date().toISOString();
    await db.runAsync(
      'INSERT INTO sync_accounts (employee_id, claim_from, created_at, updated_at) VALUES (?, ?, ?, ?)',
      employeeId, claimFrom, now, now,
    );
  }
  await db.runAsync(
    'UPDATE routes SET owner_employee_id = ? WHERE owner_employee_id IS NULL AND created_at >= ?',
    employeeId, claimFrom,
  );
}

async function pushDirtyRoutes(db: SQLiteDatabase, employeeId: string): Promise<{ pushed: number; conflicts: number; foreign: number }> {
  const foreignRow = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM routes
     WHERE owner_employee_id IS NULL OR owner_employee_id <> ?`,
    employeeId,
  );
  const foreign = foreignRow?.count ?? 0;

  const dirty = await db.getAllAsync<{ id: string; cloud_deleted_at: string | null }>(
    `SELECT id, cloud_deleted_at FROM routes
     WHERE owner_employee_id = ? AND (cloud_synced_at IS NULL OR updated_at > cloud_synced_at)`,
    employeeId,
  );
  if (dirty.length === 0) return { pushed: 0, conflicts: 0, foreign };

  const items: RouteSyncPushItem[] = [];
  for (const row of dirty) {
    const routeSnapshot = await exportRouteSnapshot(db, row.id);
    items.push({ routeSnapshot, deleted: Boolean(row.cloud_deleted_at) });
  }

  const response = await employeeApi<{ results: RouteSyncPushResult[] }>('/api/route-sync', {
    method: 'POST',
    body: JSON.stringify({ routes: items }),
  });

  let pushed = 0;
  let conflicts = 0;
  for (const result of response.results) {
    if (result.outcome === 'applied') {
      const item = items.find((entry) => String(entry.routeSnapshot.route.id) === result.routeId);
      const updatedAt = item ? String(item.routeSnapshot.route.updated_at ?? '') : null;
      if (updatedAt) await db.runAsync('UPDATE routes SET cloud_synced_at = ? WHERE id = ?', updatedAt, result.routeId);
      pushed += 1;
    } else if (result.outcome === 'conflict') {
      // The server's write already won (later update or a terminal route);
      // adopt its snapshot locally instead of retrying a losing push.
      const cloudSyncedAt = String(result.routeSnapshot.route.updated_at ?? new Date().toISOString());
      await applyRouteSnapshot(db, result.routeSnapshot, cloudSyncedAt, employeeId);
      conflicts += 1;
    }
    // 'forbidden' should not occur for a route this account owns; left pending
    // (cloud_synced_at untouched) so it surfaces on the next sync rather than
    // being silently dropped.
  }
  return { pushed, conflicts, foreign };
}

async function pullRemoteRoutes(db: SQLiteDatabase, employeeId: string): Promise<{ pulled: number; deferred: number }> {
  // Anything postponed by an earlier pass is retried first, so a freed slot is
  // used by the oldest waiting route rather than by whatever the cursor happens
  // to return this time.
  const retried = await retryDeferredRoutes(db, employeeId);
  let pulled = retried.applied;
  let deferred = retried.deferred;

  const cursor = await getSyncCursor(db, employeeId);
  const response = await employeeApi<{ routes: RouteSyncPulledRoute[]; cursor: string }>(
    `/api/route-sync${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`,
  );

  for (const pulledRoute of response.routes) {
    const outcome = await applyPulledRoute(db, employeeId, pulledRoute);
    if (outcome === 'applied') pulled += 1;
    else if (outcome === 'deferred') deferred += 1;
  }

  await setSyncCursor(db, employeeId, response.cursor);
  return { pulled, deferred };
}

type PullOutcome = 'applied' | 'deferred' | 'skipped';

/**
 * Applies one pulled route, or records it for a later pass.
 *
 * A route that cannot be applied *right now* is never simply dropped: the
 * cursor advances past it in the same pass, so the server would never offer it
 * again and the route would be lost until some other device happened to touch
 * it. It is stored in `route_sync_deferrals` instead and retried on every
 * subsequent sync until it lands.
 */
async function applyPulledRoute(db: SQLiteDatabase, employeeId: string, pulledRoute: RouteSyncPulledRoute): Promise<PullOutcome> {
  const routeId = String(pulledRoute.routeSnapshot?.route?.id ?? '');
  if (!routeId) return 'skipped';

  const existing = await db.getFirstAsync<{ id: string; status: string; updated_at: string }>(
    'SELECT id, status, updated_at FROM routes WHERE id = ?',
    routeId,
  );
  const incomingUpdatedAt = String(pulledRoute.routeSnapshot.route.updated_at ?? '');

  // The local copy is newer: it wins by the same latest-write-wins rule the
  // server applies, and it is still dirty, so the next push carries it up.
  // Applying the older cloud copy here would silently discard local work.
  if (existing && incomingUpdatedAt && String(existing.updated_at) > incomingUpdatedAt) {
    await clearDeferral(db, employeeId, routeId);
    return 'skipped';
  }

  const incomingStatus = String(pulledRoute.routeSnapshot.route.status ?? '');
  if (!existing && NON_TERMINAL_STATUSES.includes(incomingStatus)) {
    const active = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM routes WHERE status NOT IN ('completed','cancelled') LIMIT 1",
    );
    if (active) {
      // This device already has a different active route: applying the incoming
      // one would violate the one-active-route-per-device invariant.
      await deferRoute(db, employeeId, pulledRoute, 'ACTIVE_ROUTE_EXISTS');
      return 'deferred';
    }
  }

  const cloudSyncedAt = String(pulledRoute.routeSnapshot.route.updated_at ?? pulledRoute.serverUpdatedAt);
  try {
    await applyRouteSnapshot(db, pulledRoute.routeSnapshot, cloudSyncedAt, employeeId);
  } catch (reason) {
    // One unapplicable route must never abort the pass and strand every other
    // route behind it, and must never be forgotten either.
    await deferRoute(db, employeeId, pulledRoute, reason instanceof Error ? reason.message : String(reason));
    return 'deferred';
  }
  await clearDeferral(db, employeeId, routeId);
  return 'applied';
}

async function retryDeferredRoutes(db: SQLiteDatabase, employeeId: string): Promise<{ applied: number; deferred: number }> {
  const rows = await db.getAllAsync<{ route_id: string; snapshot_json: string; deleted: number; server_updated_at: string }>(
    `SELECT route_id, snapshot_json, deleted, server_updated_at FROM route_sync_deferrals
     WHERE employee_id = ? ORDER BY server_updated_at, route_id`,
    employeeId,
  );
  let applied = 0;
  let deferred = 0;
  for (const row of rows) {
    let pulledRoute: RouteSyncPulledRoute;
    try {
      pulledRoute = {
        routeSnapshot: JSON.parse(row.snapshot_json) as RouteSnapshot,
        deleted: row.deleted === 1,
        serverUpdatedAt: row.server_updated_at,
      };
    } catch {
      // An unreadable deferral can never become applicable; drop it rather than
      // retrying forever.
      await clearDeferral(db, employeeId, row.route_id);
      continue;
    }
    const outcome = await applyPulledRoute(db, employeeId, pulledRoute);
    if (outcome === 'applied') applied += 1;
    else if (outcome === 'deferred') deferred += 1;
  }
  return { applied, deferred };
}

async function deferRoute(db: SQLiteDatabase, employeeId: string, pulledRoute: RouteSyncPulledRoute, reason: string): Promise<void> {
  const routeId = String(pulledRoute.routeSnapshot?.route?.id ?? '');
  if (!routeId) return;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO route_sync_deferrals
       (route_id, employee_id, snapshot_json, deleted, server_updated_at, attempts, last_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(route_id, employee_id) DO UPDATE SET
       snapshot_json = excluded.snapshot_json,
       deleted = excluded.deleted,
       server_updated_at = excluded.server_updated_at,
       attempts = route_sync_deferrals.attempts + 1,
       last_reason = excluded.last_reason,
       updated_at = excluded.updated_at`,
    routeId, employeeId, JSON.stringify(pulledRoute.routeSnapshot), pulledRoute.deleted ? 1 : 0,
    pulledRoute.serverUpdatedAt, reason, now, now,
  );
}

async function clearDeferral(db: SQLiteDatabase, employeeId: string, routeId: string): Promise<void> {
  await db.runAsync('DELETE FROM route_sync_deferrals WHERE route_id = ? AND employee_id = ?', routeId, employeeId);
}

/**
 * Cursors are per account: two employees using the same physical device each
 * keep their own watermark, so signing in as a colleague can never suppress
 * data the other account has not received yet.
 */
async function getSyncCursor(db: SQLiteDatabase, employeeId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ cursor: string }>(
    'SELECT cursor FROM sync_cursors WHERE entity = ? AND employee_id = ?',
    CURSOR_ENTITY, employeeId,
  );
  return row?.cursor ?? null;
}

async function setSyncCursor(db: SQLiteDatabase, employeeId: string, cursor: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sync_cursors (entity, employee_id, cursor, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity, employee_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    CURSOR_ENTITY, employeeId, cursor, now,
  );
}
