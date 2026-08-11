import type { SQLiteDatabase } from 'expo-sqlite';

import { applyRouteSnapshot, exportRouteSnapshot } from '@/application/auth/route-assignment-sync';
import { employeeApi, type RouteSnapshot } from '@/infrastructure/auth/employee-session';

const SYNC_CURSOR_KEY = 'route_cloud_sync_cursor';
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
};

/**
 * Pushes every locally-dirty route (`cloud_synced_at IS NULL OR updated_at >
 * cloud_synced_at` — computed, not flagged by callers) then pulls anything
 * newer from the account's other devices. Throws on network/auth failure;
 * callers are expected to catch and treat it as "stayed offline", matching
 * the existing `pullAssignedRoutes` convention.
 */
export async function syncRoutesWithCloud(db: SQLiteDatabase): Promise<RouteCloudSyncResult> {
  const pushOutcome = await pushDirtyRoutes(db);
  const pullOutcome = await pullRemoteRoutes(db);
  return { ...pushOutcome, ...pullOutcome };
}

async function pushDirtyRoutes(db: SQLiteDatabase): Promise<{ pushed: number; conflicts: number }> {
  const dirty = await db.getAllAsync<{ id: string; cloud_deleted_at: string | null }>(
    'SELECT id, cloud_deleted_at FROM routes WHERE cloud_synced_at IS NULL OR updated_at > cloud_synced_at',
  );
  if (dirty.length === 0) return { pushed: 0, conflicts: 0 };

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
      await applyRouteSnapshot(db, result.routeSnapshot, cloudSyncedAt);
      conflicts += 1;
    }
    // 'forbidden' should not occur for a route this device itself owns; left
    // pending (cloud_synced_at untouched) so it surfaces on the next sync
    // rather than being silently dropped.
  }
  return { pushed, conflicts };
}

async function pullRemoteRoutes(db: SQLiteDatabase): Promise<{ pulled: number; deferred: number }> {
  const cursor = await getSyncCursor(db);
  const response = await employeeApi<{ routes: RouteSyncPulledRoute[]; cursor: string }>(
    `/api/route-sync${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`,
  );

  let pulled = 0;
  let deferred = 0;
  for (const pulledRoute of response.routes) {
    const routeId = String(pulledRoute.routeSnapshot.route.id ?? '');
    if (!routeId) continue;
    const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM routes WHERE id = ?', routeId);
    const incomingStatus = String(pulledRoute.routeSnapshot.route.status ?? '');
    if (!existing && NON_TERMINAL_STATUSES.includes(incomingStatus)) {
      const active = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM routes WHERE status NOT IN ('completed','cancelled') LIMIT 1",
      );
      if (active) {
        // This device already has a different active route: applying the
        // incoming one would violate the one-active-route-per-device
        // invariant. Deferred, not lost — it is re-evaluated on every
        // subsequent pull until this device's own route finishes.
        deferred += 1;
        continue;
      }
    }
    const cloudSyncedAt = String(pulledRoute.routeSnapshot.route.updated_at ?? pulledRoute.serverUpdatedAt);
    await applyRouteSnapshot(db, pulledRoute.routeSnapshot, cloudSyncedAt);
    pulled += 1;
  }

  await setSyncCursor(db, response.cursor);
  return { pulled, deferred };
}

async function getSyncCursor(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_preferences WHERE key = ?',
    SYNC_CURSOR_KEY,
  );
  return row?.value ?? null;
}

async function setSyncCursor(db: SQLiteDatabase, cursor: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    SYNC_CURSOR_KEY, cursor, now,
  );
}
