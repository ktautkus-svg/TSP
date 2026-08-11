import { Firestore, FieldValue, type DocumentData } from '@google-cloud/firestore';

import { EmployeeApiError } from './employee-auth-store.js';

export const ACCOUNT_SYNC_ENTITIES = ['saved_location', 'preference'] as const;
export type AccountSyncEntity = (typeof ACCOUNT_SYNC_ENTITIES)[number];

/**
 * The server's own copy of the preference allowlist, deliberately duplicated
 * rather than imported from the Expo sources: the client filters what it sends,
 * but the server is the authority on what may be stored. A modified or
 * out-of-date client must not be able to upload the offline PIN credential by
 * simply asking. `tests/unit/account-cloud-sync.test.ts` asserts the two lists
 * cannot drift apart.
 */
const ALLOWED_PREFERENCE_KEYS = ['last_route_end_kind', 'last_planning_mode'];
const ALLOWED_LOCATION_KINDS = ['warehouse', 'home'];
const MAXIMUM_PAYLOAD_CHARACTERS = 8_000;

export type AccountSyncPushItem = {
  entity: AccountSyncEntity;
  localId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
};

export type AccountSyncPushResult =
  | { entity: AccountSyncEntity; localId: string; outcome: 'applied' }
  | { entity: AccountSyncEntity; localId: string; outcome: 'conflict'; payload: Record<string, unknown>; deleted: boolean }
  | { entity: string; localId: string; outcome: 'rejected'; reason: string };

export type AccountSyncPulledItem = {
  entity: AccountSyncEntity;
  localId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  serverUpdatedAt: string;
};

export type AccountPushDecisionInput = {
  ownerEmployeeId: string;
  updatedAt: string | null;
};

export type AccountPushDecision = 'applied' | 'conflict' | 'forbidden';

/**
 * Pure conflict rule so it can be unit tested without Firestore.
 * Ownership always beats recency; otherwise latest-write-wins by `updated_at`,
 * with an equal timestamp counting as "already stored" so a repeated push is a
 * no-op rather than a pointless write.
 */
export function decideAccountPushOutcome(
  existing: AccountPushDecisionInput | null,
  incoming: AccountPushDecisionInput,
): AccountPushDecision {
  if (!existing) return 'applied';
  if (existing.ownerEmployeeId !== incoming.ownerEmployeeId) return 'forbidden';
  if (incoming.updatedAt === null) return 'conflict';
  if (existing.updatedAt === null) return 'applied';
  return incoming.updatedAt > existing.updatedAt ? 'applied' : 'conflict';
}

/** Rejects anything the account channel is not allowed to carry. */
export function validateAccountSyncItem(item: AccountSyncPushItem): void {
  if (!ACCOUNT_SYNC_ENTITIES.includes(item.entity)) {
    throw new EmployeeApiError('INVALID_ENTITY', 'Nepalaikomas duomenų tipas.', 400);
  }
  if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) {
    throw new EmployeeApiError('INVALID_PAYLOAD', 'Įrašo duomenys nepilni.', 400);
  }
  if (JSON.stringify(item.payload).length > MAXIMUM_PAYLOAD_CHARACTERS) {
    throw new EmployeeApiError('PAYLOAD_TOO_LARGE', 'Įrašas per didelis.', 400);
  }
  if (item.entity === 'preference' && !ALLOWED_PREFERENCE_KEYS.includes(item.localId)) {
    // The security gate: an unknown preference key is refused outright, so no
    // client can push `local_access_pin_hash` into the cloud.
    throw new EmployeeApiError('PREFERENCE_NOT_SYNCABLE', 'Ši nuostata nesinchronizuojama.', 400);
  }
  if (item.entity === 'saved_location' && !ALLOWED_LOCATION_KINDS.includes(item.localId)) {
    throw new EmployeeApiError('INVALID_LOCATION_KIND', 'Nepalaikomas vietos tipas.', 400);
  }
}

type StoredAccountRecord = {
  entity: AccountSyncEntity;
  localId: string;
  ownerEmployeeId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  clientUpdatedAt: string;
  serverUpdatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

const COLLECTIONS: Record<AccountSyncEntity, string> = {
  saved_location: 'tsp_user_locations',
  preference: 'tsp_user_preferences',
};

export class AccountSyncStore {
  private readonly db = new Firestore();

  /**
   * Document ids are composed from the session's employee id and the local key,
   * so ownership is enforced by the key itself: a caller literally cannot
   * address another employee's document. The stored `ownerEmployeeId` is
   * checked as well, so a future id-scheme change cannot silently weaken this.
   */
  private reference(entity: AccountSyncEntity, employeeId: string, localId: string) {
    return this.db.collection(COLLECTIONS[entity]).doc(`${employeeId}--${localId}`);
  }

  /** Applies each item independently so one bad record never fails the batch. */
  async push(employeeId: string, items: AccountSyncPushItem[]): Promise<AccountSyncPushResult[]> {
    const results: AccountSyncPushResult[] = [];
    for (const item of items) {
      try {
        validateAccountSyncItem(item);
      } catch (error) {
        results.push({
          entity: String(item?.entity ?? ''),
          localId: String(item?.localId ?? '').slice(0, 80),
          outcome: 'rejected',
          reason: error instanceof Error ? error.message : 'Įrašas atmestas.',
        });
        continue;
      }
      results.push(await this.applyOne(employeeId, item));
    }
    return results;
  }

  private async applyOne(employeeId: string, item: AccountSyncPushItem): Promise<AccountSyncPushResult> {
    const reference = this.reference(item.entity, employeeId, item.localId);
    const incomingUpdatedAt = String(item.payload.updated_at ?? '');
    try {
      return await this.db.runTransaction<AccountSyncPushResult>(async (transaction) => {
        const document = await transaction.get(reference);
        const existing = document.exists ? (document.data() as StoredAccountRecord) : null;
        const decision = decideAccountPushOutcome(
          existing && { ownerEmployeeId: existing.ownerEmployeeId, updatedAt: String(existing.payload?.updated_at ?? '') || null },
          { ownerEmployeeId: employeeId, updatedAt: incomingUpdatedAt || null },
        );

        if (decision === 'forbidden') {
          return { entity: item.entity, localId: item.localId, outcome: 'rejected', reason: 'Įrašas priklauso kitai paskyrai.' };
        }
        if (decision === 'conflict') {
          return {
            entity: item.entity,
            localId: item.localId,
            outcome: 'conflict',
            payload: existing!.payload,
            deleted: existing!.deleted,
          };
        }

        const record: StoredAccountRecord = {
          entity: item.entity,
          localId: item.localId,
          ownerEmployeeId: employeeId,
          payload: item.payload,
          deleted: item.deleted,
          clientUpdatedAt: incomingUpdatedAt,
          serverUpdatedAt: FieldValue.serverTimestamp(),
          createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
        };
        transaction.set(reference, record as unknown as DocumentData);
        return { entity: item.entity, localId: item.localId, outcome: 'applied' };
      });
    } catch (error) {
      return {
        entity: item.entity,
        localId: item.localId,
        outcome: 'rejected',
        reason: error instanceof Error ? error.message : 'Nepavyko išsaugoti įrašo.',
      };
    }
  }

  /**
   * Single-field equality query per collection, filtered and sorted in memory —
   * the same no-composite-index rule route sync follows. An account holds two
   * locations and two preferences, so this stays trivially cheap.
   */
  async pull(employeeId: string, since: Partial<Record<AccountSyncEntity, string>>): Promise<{
    items: AccountSyncPulledItem[];
    cursors: Record<AccountSyncEntity, string>;
  }> {
    const items: AccountSyncPulledItem[] = [];
    const cursors = {} as Record<AccountSyncEntity, string>;
    for (const entity of ACCOUNT_SYNC_ENTITIES) {
      const sinceMs = since[entity] ? Date.parse(String(since[entity])) : 0;
      let watermark = Number.isNaN(sinceMs) ? 0 : sinceMs;
      const snapshot = await this.db.collection(COLLECTIONS[entity]).where('ownerEmployeeId', '==', employeeId).get();
      const rows = snapshot.docs
        .map((document) => document.data() as StoredAccountRecord)
        .filter((data) => toMillis(data.serverUpdatedAt) > (Number.isNaN(sinceMs) ? 0 : sinceMs))
        .sort((left, right) => toMillis(left.serverUpdatedAt) - toMillis(right.serverUpdatedAt));
      for (const row of rows) {
        const serverUpdatedAtMs = toMillis(row.serverUpdatedAt);
        watermark = Math.max(watermark, serverUpdatedAtMs);
        items.push({
          entity,
          localId: row.localId,
          payload: row.payload,
          deleted: row.deleted,
          serverUpdatedAt: new Date(serverUpdatedAtMs).toISOString(),
        });
      }
      // The cursor is the newest record actually returned, never the server's
      // wall clock: a watermark ahead of the data would skip anything this pass
      // could not apply. Route sync learned this the hard way.
      cursors[entity] = new Date(watermark).toISOString();
    }
    return { items, cursors };
  }
}

function toMillis(value: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue): number {
  const timestamp = value as FirebaseFirestore.Timestamp;
  return typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : 0;
}
