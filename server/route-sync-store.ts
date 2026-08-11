import { Firestore, FieldValue, type DocumentData } from '@google-cloud/firestore';

import { safeId, validateSnapshot, type RouteSnapshot } from './employee-auth-store.js';

export type RouteSyncPushItem = {
  routeSnapshot: RouteSnapshot;
  deleted: boolean;
};

export type RouteSyncPushResult =
  | { routeId: string; outcome: 'applied' }
  | { routeId: string; outcome: 'conflict'; routeSnapshot: RouteSnapshot; deleted: boolean }
  | { routeId: string; outcome: 'forbidden' };

export type RouteSyncPulledRoute = {
  routeSnapshot: RouteSnapshot;
  deleted: boolean;
  serverUpdatedAt: string;
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

export type PushDecisionInput = {
  ownerEmployeeId: string;
  status: string | null;
  updatedAt: string | null;
};

export type PushDecision = 'applied' | 'conflict' | 'forbidden';

/**
 * Pure conflict-resolution rule (no Firestore access) so it can be unit
 * tested directly. See docs/CLOUD_SYNC_ARCHITECTURE.md §4.3:
 * 1. wrong owner is always rejected;
 * 2. a terminal (completed/cancelled) stored route can never be changed
 *    away from that status by an older/conflicting write;
 * 3. otherwise latest-write-wins by `updated_at`.
 */
export function decidePushOutcome(existing: PushDecisionInput | null, incoming: PushDecisionInput): PushDecision {
  if (!existing) return 'applied';
  if (existing.ownerEmployeeId !== incoming.ownerEmployeeId) return 'forbidden';

  const existingIsTerminal = existing.status !== null && TERMINAL_STATUSES.has(existing.status);
  if (existingIsTerminal && incoming.status !== existing.status) return 'conflict';

  const incomingIsNewer = incoming.updatedAt !== null
    && (existing.updatedAt === null || incoming.updatedAt > existing.updatedAt);
  return incomingIsNewer ? 'applied' : 'conflict';
}

type StoredRoute = {
  id: string;
  ownerEmployeeId: string;
  routeSnapshot: RouteSnapshot;
  deleted: boolean;
  clientUpdatedAt: string;
  serverUpdatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

export class RouteSyncStore {
  private readonly db = new Firestore();
  private readonly routes = this.db.collection('tsp_routes');

  /**
   * Applies each pushed route independently so one rejected record (bad
   * ownership or a losing conflict) never blocks the rest of the batch.
   */
  async push(employeeId: string, items: RouteSyncPushItem[]): Promise<RouteSyncPushResult[]> {
    const results: RouteSyncPushResult[] = [];
    for (const item of items) {
      validateSnapshot(item.routeSnapshot);
      const routeId = safeId(String(item.routeSnapshot.route.id ?? ''));
      const incomingUpdatedAt = String(item.routeSnapshot.route.updated_at ?? '');
      const incomingStatus = String(item.routeSnapshot.route.status ?? '');
      const reference = this.routes.doc(routeId);

      // A rejected record (bad ownership) must never abort the rest of the
      // batch, so per-item failures are caught and reported, not thrown.
      const outcome = await this.db.runTransaction<RouteSyncPushResult>(async (transaction) => {
        const existingDoc = await transaction.get(reference);
        const existing = existingDoc.exists ? (existingDoc.data() as StoredRoute) : null;

        const decision = decidePushOutcome(
          existing && {
            ownerEmployeeId: existing.ownerEmployeeId,
            status: String(existing.routeSnapshot.route.status ?? '') || null,
            updatedAt: String(existing.routeSnapshot.route.updated_at ?? '') || null,
          },
          { ownerEmployeeId: employeeId, status: incomingStatus || null, updatedAt: incomingUpdatedAt || null },
        );

        if (decision === 'forbidden') return { routeId, outcome: 'forbidden' };
        if (decision === 'conflict') {
          return {
            routeId,
            outcome: 'conflict',
            routeSnapshot: existing!.routeSnapshot,
            deleted: existing!.deleted,
          };
        }

        const record: StoredRoute = {
          id: routeId,
          ownerEmployeeId: employeeId,
          routeSnapshot: item.routeSnapshot,
          deleted: item.deleted,
          clientUpdatedAt: incomingUpdatedAt,
          serverUpdatedAt: FieldValue.serverTimestamp(),
          createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
        };
        transaction.set(reference, record as unknown as DocumentData);
        return { routeId, outcome: 'applied' };
      });
      results.push(outcome);
    }
    return results;
  }

  /**
   * Single-field equality query only (no composite index) — an employee's
   * own routes are fetched and then filtered/sorted by serverUpdatedAt in
   * memory, deliberately avoiding a manually-provisioned Firestore index for
   * this feature to ship. See docs/CLOUD_SYNC_ARCHITECTURE.md §4.2.
   */
  async pull(employeeId: string, since: string | null): Promise<{ routes: RouteSyncPulledRoute[]; cursor: string }> {
    const cursor = new Date().toISOString();
    const sinceMs = since ? Date.parse(since) : 0;
    const snapshot = await this.routes.where('ownerEmployeeId', '==', employeeId).get();
    const routes = snapshot.docs
      .map((doc) => doc.data() as StoredRoute)
      .filter((data) => {
        const timestamp = data.serverUpdatedAt as FirebaseFirestore.Timestamp | undefined;
        if (!timestamp || typeof timestamp.toMillis !== 'function') return true;
        return timestamp.toMillis() > sinceMs;
      })
      .sort((a, b) => toMillis(a.serverUpdatedAt) - toMillis(b.serverUpdatedAt))
      .map((data) => ({
        routeSnapshot: data.routeSnapshot,
        deleted: data.deleted,
        serverUpdatedAt: new Date(toMillis(data.serverUpdatedAt)).toISOString(),
      }));
    return { routes, cursor };
  }
}

function toMillis(value: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue): number {
  const timestamp = value as FirebaseFirestore.Timestamp;
  return typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : 0;
}
