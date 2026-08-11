# TSP multi-device cloud sync — architecture

## 1. Why the tablet showed no route

Employee accounts (`docs/EMPLOYEE_ACCOUNTS_V1.md`) are already server-backed:
Firestore holds users, sessions and role, so the *same account* really does
work on any device. What is device-local is the **operational data itself**:
`routes`, `delivery_stops`, `shipment_lines`, `vehicles`, `trip_sheets`,
`fuel_entries`, `saved_locations`, preferences — all of it lives only in that
device's Expo SQLite file (`deliveries.db`). Logging in on a second device
gets you a valid session and an empty local database; nothing associates a
route with an account server-side, so there is nothing to fetch.

The one exception is the existing **assignment** flow
(`server/employee-auth-store.ts`'s `tsp_assignments` collection,
`src/application/auth/route-assignment-sync.ts`): a dispatcher can push a
route snapshot to a specific driver, who downloads it once. That mechanism is
intentionally one-shot and one-directional (driver's device becomes
authoritative until completion; only a progress summary flows back). It is
not a general "my own account's data follows me" sync, and it does not pull
updates back down after the initial download.

## 2. Existing infrastructure this design reuses

- **Auth**: `EmployeeAuthStore`/`employee-api.ts` already authenticate every
  `/api/*` request via a session cookie or bearer token
  (`authenticateApiRequest` / `store.authenticate(token)`), resolving a
  server-validated `EmployeeProfile { id, username, role, permissions }`.
  Cloud sync reuses this — a route's owner is always `profile.id` from the
  authenticated session, never a client-supplied id.
- **Firestore**: same project/database as `tsp_users`/`tsp_sessions`/
  `tsp_assignments`, via the Admin SDK (`server/employee-auth-store.ts`
  already does `new Firestore()`). No second backend, no new provider.
- **Global route/stop identity**: `defaultIdFactory` in
  `src/application/routes/route-commands.ts` already generates
  `` `${prefix}-${Date.now()}-${random8}` `` ids for every route/stop, which
  is already used as the primary key across the whole app. This is already
  suitable as a stable, globally-unique-enough cloud document id — no id
  migration is needed. (Collision probability across two devices is
  astronomically low: millisecond timestamp + 8 random base36 chars; this is
  an accepted, documented assumption rather than a new UUID scheme, to avoid
  touching the many call sites that use `idFactory`.)
- **Snapshot shape**: `RouteSnapshot { route, stops, shipmentLines }` and its
  `exportRouteSnapshot`/`validateSnapshot` already exist
  (`route-assignment-sync.ts`, `employee-auth-store.ts`) for the assignment
  flow. Cloud sync reuses the exact same shape and validation instead of
  inventing a parallel payload format.
- **One-active-route invariant**: SQLite enforces
  `CREATE UNIQUE INDEX one_active_route ON routes ((1)) WHERE status NOT IN
  ('completed','cancelled')` — a device can hold at most one non-terminal
  route. Sync must never violate this (see §7).

## 3. Data ownership audit (schema v14)

| Table | Classification | Reasoning |
|---|---|---|
| `routes` | **A. Cloud (Priority 1)** | Core operational record; must follow the account. |
| `delivery_stops` | **A. Cloud (Priority 1)** | Synced as part of the owning route's snapshot. |
| `shipment_lines` | **A. Cloud (Priority 1)** | Already part of `RouteSnapshot`; rides along with routes/stops for free. |
| `import_sources` | B. Device-local | Provenance of *how this device* created the route; not needed for cross-device execution. Deferred. |
| `delivery_attempts` | A. Cloud (deferred) | Real delivery history; candidate for a later round once route sync is proven. |
| `action_journal` | B. Device-local | Short-lived undo buffer (`undo_expires_at`); undo only makes sense on the device that made the edit. |
| `route_order_snapshots` | A. Cloud (deferred) | Route-history detail; not required for the P1 acceptance scenario. |
| `vehicles` | A. Cloud (deferred) | Personal equipment info; already deliberately excluded from `RouteSnapshot` (`vehicle_id` is nulled on export in the existing assignment code) — kept device/instance-local for now, consistent with that precedent. |
| `trip_sheets`, `trip_sheet_routes`, `trip_time_entries` | A. Cloud (deferred) | Personal operational history; explicitly out of scope for P1 per the task's phased rollout. |
| `fuel_entries` | A. Cloud (deferred) | Personal operational data; explicit P2+ candidate. |
| `route_optimization_results`, `route_optimization_stops` | B. Device-local (diagnostic) | Large, derived, provider-computation explainability data. `delivery_stops` already carries everything an execution UI needs (`active_order`, `planned_arrival_at/departure_at`, `leg_distance_km`, ETA fields). Not required to satisfy the P1 acceptance scenario; syncing it would be a lot of payload for no execution-visible benefit. Revisit if the "alternatives" review screen needs to be viewable from a second device. |
| `route_stop_constraints`, `manual_route_edits` | A. Cloud (deferred) | Route-editing history; deferred, not required for P1. |
| `routing_engine_runs`, `routing_engine_candidates`, `routing_recalculations` | B. Device-local (diagnostic) | Same reasoning as optimization results — internal routing computation trace, not the operational truth of the route. Never touched by this task (routing/optimization logic is explicitly off-limits). |
| `routing_matrix_cache` | B. Device-local | Pure provider response cache with `expires_at`; must never sync (would also risk leaking cached third-party data across devices for no benefit). |
| `import_audits`, `excel_import_sessions`, `excel_import_rows`, `excel_import_corrections` | B. Device-local | One-time import workflow/audit trail tied to the device that did the import. |
| `location_preferences` | A. Cloud (deferred) | Personal address notes; P2+ candidate. |
| `saved_locations` | A. Cloud (deferred) | Personal home/warehouse defaults; P2+ candidate. Note: current schema is a device-singleton (`kind` as primary key), so making this multi-account-aware needs its own small migration later. |
| `app_preferences` | **Mixed — per-key, not per-table** | `local_access_username`/`local_access_pin_salt`/`local_access_pin_hash`/`local_access_updated_at` are **B. Device-local, security-sensitive** (never sync — this is the offline PIN-unlock cache). `last_route_end_kind`, `last_planning_mode`, `pwa_service_worker_version` etc. are ordinary local UI/feature preferences, cloud-eligible in principle but deferred. **This table must never be synced wholesale.** |
| `route_creation_commands` | B. Device-local | Per-device idempotency key for a single create-route command retry; not meaningful across devices. |
| `route_sync_state` | B. Device-local | Bookkeeping for the *existing* assignment-download flow (which assignment produced which local route, on this device). Left untouched; see §8 for how it interacts with the new mechanism. |
| `tsp_users`, `tsp_usernames`, `tsp_sessions`, `tsp_assignments` (Firestore, not SQLite) | **C. Global/organization** | Already server-owned; unchanged by this work. |

**Priority 1 scope (this implementation): `routes` + `delivery_stops` +
`shipment_lines`, synced together as one snapshot per route.** Everything
else in the table above is audited and classified, but intentionally not
synced yet, per the task's phased rollout.

## 4. Sync model

### 4.1 New SQLite columns (migration v15)

```sql
ALTER TABLE routes ADD COLUMN cloud_synced_at TEXT;   -- last cloud value's server timestamp this device has applied/confirmed
ALTER TABLE routes ADD COLUMN cloud_deleted_at TEXT;  -- local soft-delete marker, propagated to the cloud
```

No new table, and no column on `delivery_stops`/`shipment_lines`: the sync
unit is the whole route snapshot, not individual stops (see §4.3 for why).
`cloud_synced_at IS NULL` marks a route that has never been uploaded —
this is exactly what every pre-existing local route looks like after the
migration, which is what makes the first-sync migration (§6) automatic and
free: no separate "migrate old data" step is needed, dirtiness is computed,
not flagged.

"Needs upload" is computed, not flagged by application code:
`cloud_synced_at IS NULL OR updated_at > cloud_synced_at`. This means **no
existing write path in `route-commands.ts` has to change** — every mutation
already bumps `routes.updated_at`; the sync engine just compares it.

The local pull cursor (last successfully applied server watermark) is stored
in the existing `app_preferences` table under `route_cloud_sync_cursor` — no
new table needed for that either.

### 4.2 Firestore collection: `tsp_routes`

Doc id = the route's own SQLite id (stable, already-unique — see §2).

```
tsp_routes/{routeId}
  id: string
  ownerEmployeeId: string       // authenticated session's profile.id — never client-trusted
  routeSnapshot: RouteSnapshot  // { route, stops, shipmentLines } — same shape as the assignment flow
  deleted: boolean
  clientUpdatedAt: string       // routeSnapshot.route.updated_at, informational only
  serverUpdatedAt: Timestamp    // Firestore server timestamp — authoritative ordering + sync cursor
  createdAt: Timestamp          // set once, preserved across updates
```

Single-field equality query only (`where ownerEmployeeId ==`); the
server filters/sorts by `serverUpdatedAt` in memory after fetching one
employee's routes, specifically to avoid requiring a manually-provisioned
Firestore composite index for this feature to ship. Given this app's real
scale (one driver, low hundreds of routes at most), fetching one employee's
route set per sync is cheap. Revisit with a composite index
(`ownerEmployeeId asc, serverUpdatedAt asc`) if that assumption stops
holding.

### 4.3 Conflict resolution — decided per entity, not globally

The whole route (route fields + stops + shipment lines) syncs as **one
snapshot**, because in practice only one device is ever actively working a
given route at a time (you cannot physically deliver from two devices at
once), which makes per-field/per-stop merge unnecessary complexity for v1.
Rule, in order:

1. **Terminal-state guard (route-level, hard rule)**: if the server's stored
   snapshot for a route is already `completed` or `cancelled` — which
   `src/domain/transitions.ts` already defines as having *no* further valid
   transitions — an incoming push that would change it away from that status
   is rejected outright and reported back to the client as a conflict. A
   finished route can never be silently resurrected by a stale device.
2. **Otherwise: latest-write-wins by `routeSnapshot.route.updated_at`**. If
   the incoming push's `updated_at` is not newer than what the server has,
   the push is rejected for that route and reported as a conflict (the
   client should pull and reconcile, not blindly retry the same losing
   write).
3. **Deletion** uses the same rule: `deleted: true` is just another field on
   the snapshot, subject to the same terminal-state guard and LWW-by-
   `updated_at` comparison. A delete cannot resurrect-or-be-resurrected out
   of order.

This is intentionally *not* one blind rule for everything: the terminal-state
guard exists specifically because route status is a one-way state machine in
this app's own domain model, and blind LWW at that boundary would be an
actual data-loss bug (an old "in_progress" write arriving late could
overwrite a real "completed" route). Everywhere else, LWW is adequate and
avoids inventing field-level merge machinery this app doesn't need yet.

### 4.4 Push/pull protocol (incremental, idempotent)

- `POST /api/route-sync` — body `{ routes: [{ routeSnapshot, deleted }] }`.
  For each record: resolve `ownerEmployeeId` from the session (not the
  body); if a doc already exists under a *different* owner, reject that one
  record (ownership violation, never trust a client-supplied id blindly);
  otherwise apply the conflict rule from §4.3 inside a Firestore
  transaction (read-modify-write, preserving `createdAt`). Response reports
  per-route `applied` / `conflict` (with the server's current snapshot for
  conflicted ones, so the client can reconcile immediately without another
  round trip).
- `GET /api/route-sync?since=<cursor>` — returns every route owned by the
  caller with `serverUpdatedAt > since`, plus a new cursor (the server's own
  clock at request time, never the client's). Both endpoints are mounted
  next to the existing `/api/assignments` routes in `employee-api.ts`/
  `production-server.ts`, behind the same session authentication — reusing
  the existing middleware, not a new auth path.
- Both directions are naturally **idempotent**: Firestore writes are
  upserts keyed by the stable route id (re-sending the same push twice is a
  no-op past the first), and the SQLite apply side is
  `INSERT ... ON CONFLICT(id) DO UPDATE` inside a transaction, so re-applying
  the same pulled snapshot twice does not duplicate rows.

### 4.5 Offline / reconnect behaviour

- Offline: sync calls fail fast (network error caught, swallowed like the
  existing `pullAssignedRoutes` pattern), local reads/writes are completely
  unaffected, `cloud_synced_at` simply stays stale. The active route remains
  fully usable offline (no behavior change here — this already works today).
- Reconnect: the same sync pass that already runs opportunistically
  (mirroring where `pullAssignedRoutes`/`pushRouteAssignmentProgress` are
  currently called from the home-screen focus effect) pushes every route
  with `cloud_synced_at IS NULL OR updated_at > cloud_synced_at`, then pulls
  since the stored cursor and applies. No background scheduler is
  introduced.

## 5. Account ownership & security

- `ownerEmployeeId` is always the authenticated session's `profile.id`,
  resolved server-side by `store.authenticate(token)` — identical to how
  `createAssignment`'s `createdBy: profile.id` already works. The client
  never supplies an owner id.
- Pull/push are **self-scoped only**: an employee can only sync their own
  routes (`where ownerEmployeeId == profile.id`). There is no
  admin/dispatcher "read everyone's synced routes" endpoint in this round —
  oversight visibility continues to go through the existing
  `/api/admin/assignments` listing, which is unchanged.
- A push can never overwrite another employee's route: the per-record
  ownership check in §4.4 rejects it before any write.
- No server secret is ever sent to the client; sync uses the same
  session-cookie/bearer auth already in place, no new credential type.

### 5.1 Dispatcher assignment vs. cloud-synced route — avoiding duplicates

Today, `createAssignment` (`employee-auth-store.ts`) stores the route
snapshot only inside `tsp_assignments`, and the driver's one-shot download
(`importAssignmentSnapshot`) never revisits it. To avoid two parallel,
divergent copies of the same route (one in `tsp_assignments`, one in the new
`tsp_routes`), `createAssignment` additionally **upserts `tsp_routes/{routeId}`
with `ownerEmployeeId = driverId`**, reusing the exact same snapshot it
already builds. Because both flows key by the same route id, this is a
plain idempotent upsert, not a second record: whichever flow touches the
route first, the other just updates the same document. From that point on,
the assigned route participates in the driver's normal two-way cloud sync
like any route they created themselves — the assignment is the *mechanism
that establishes ownership*, not a separate storage system.

This is the only change to the existing assignment code in this round; the
one-shot `importAssignmentSnapshot` download path is left exactly as is
(still how a newly-assigned route first reaches the driver's device). The
new bidirectional pull is what makes *later* dispatcher-side edits, or a
second of the driver's own devices, see updates after that point — something
the old one-shot mechanism never did.

## 6. Migration of existing local data

Nothing is reset or reassigned. Because dirtiness is computed from
`cloud_synced_at IS NULL OR updated_at > cloud_synced_at` (§4.1), every route
that existed before this feature shipped is automatically detected as
"needs upload" the first time sync runs on that device — no separate
migration flag, no re-creation, no data loss. Existing route/stop ids are
reused as-is as the cloud document id (§2). If the same route id has
somehow already been independently uploaded from another device (e.g. two
devices both had a similarly-timed local copy — practically only possible
for assignment-derived routes, since those already share an id by
construction), the ownership + LWW rules in §4.3/§4.4 apply exactly as they
would for any other conflict; nothing special-cased for "first sync".

## 7. The one-active-route invariant

SQLite allows at most one non-terminal (`draft`..`in_progress`) route per
device. The pull-apply step must never violate this. Mirroring the existing
safety check in `pullAssignedRoutes` (`route-assignment-sync.ts`: skip
importing an assignment if a *different* active route already exists
locally), the new pull-apply does the same for any incoming non-terminal
route: if it doesn't already exist locally and the device currently has a
different active route, the incoming route is deferred (left unapplied,
cursor still advances past it so a *later* pull re-checks it) rather than
breaking the unique index. Completed/cancelled routes have no such
constraint and always merge freely — this is how route history ends up
synced "for free" as part of Priority 1, since history rows are just
normal `routes` rows with a terminal status.

## 8. Rollout

1. Schema v15 (this round): `cloud_synced_at`, `cloud_deleted_at` on
   `routes`.
2. Server: `route-sync-store.ts` (Firestore access + conflict rules) +
   `/api/route-sync` GET/POST wired into `employee-api.ts`/
   `production-server.ts`, reusing existing auth.
3. Client: `src/application/sync/route-cloud-sync.ts` — push dirty routes,
   pull since cursor, apply with the one-active-route guard; triggered from
   the same place the existing assignment pull already runs.
4. `createAssignment` additionally upserts `tsp_routes` (§5.1).
5. Tests (§9).
6. Everything in §3 marked "deferred" is an explicit, separate future round
   — not started here.

## 9. Testing strategy

Server-side sync-store logic and client-side apply logic are both tested
with the same lightweight patterns already used in this repo (in-memory
`node:sqlite` adapter for the client side, a fake Firestore-shaped store for
the server side — mirroring `tests/unit/employee-accounts.test.ts` and
`tests/unit/local-access.test.ts`), covering: first upload, second-device
download, repeated-sync idempotency, offline update + reconnect, the
terminal-state conflict guard, deletion propagation, expired/invalid
session rejection, wrong-owner rejection, dispatcher-assignment-to-owned-
route handoff without duplication, and migration of a pre-existing local
route with no prior `cloud_synced_at`.
