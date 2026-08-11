# TSP Cloud Sync v2 — plan for the remaining device-local data

Status: **Phase 0 implemented (schema v16); phases 1–5 still architecture only.**
See §16 for what shipped and where the implementation deliberately differs from
the design below.

Scope: audited at schema v15, branch `agent/claude-sync-v2`, 2026-08-11.
Phase 0 landed on the same branch and moved the schema to v16.

Companion document: `docs/CLOUD_SYNC_ARCHITECTURE.md` (the v1 design). Where
this plan disagrees with that document, the disagreement is called out
explicitly — v1's own doc contains two claims that the shipped code does not
satisfy (§14.5, §14.6).

---

## 1. Current Cloud Sync v1 architecture

### 1.1 What ships today

| Layer | File | Responsibility |
|---|---|---|
| Schema | `src/database/migrations.ts` (v15) | `routes.cloud_synced_at`, `routes.cloud_deleted_at` |
| Client engine | `src/application/sync/route-cloud-sync.ts` | push dirty routes → pull since cursor → apply |
| Snapshot I/O | `src/application/auth/route-assignment-sync.ts` | `exportRouteSnapshot`, `applyRouteSnapshot` |
| Server API | `server/employee-api.ts` (`/api/route-sync` GET/POST) | session auth, request shaping |
| Server store | `server/route-sync-store.ts` | Firestore `tsp_routes`, conflict decision |
| Trigger | `src/app/index.tsx` focus effect | opportunistic sync on home-screen focus |

Synced entity set: `routes` + `delivery_stops` + `shipment_lines`, as one
`RouteSnapshot` document per route.

### 1.2 The five mechanisms v2 must stay compatible with

1. **Identity** — `ownerEmployeeId` is always the authenticated session's
   `profile.id`, resolved server-side by `EmployeeAuthStore.authenticate()`.
   The client never supplies an owner. v2 keeps this rule verbatim.
2. **Dirtiness is computed, not flagged** —
   `cloud_synced_at IS NULL OR updated_at > cloud_synced_at`. No write path in
   `route-commands.ts` had to change for v1, because every mutation already
   bumps `updated_at`. v2 reuses this pattern for every new entity, which is
   why the first requirement for any new synced table is *a real `updated_at`
   column that every writer already maintains*.
3. **Terminal-state guard** — `decidePushOutcome()` refuses to move a stored
   `completed`/`cancelled` route away from that status, then falls back to
   latest-write-wins by `updated_at`. This is a per-entity rule, not a global
   one; v2 defines its own rule per entity (§7).
4. **No composite Firestore index** — `pull()` does a single-field equality
   query (`ownerEmployeeId ==`) and filters/sorts `serverUpdatedAt` in memory,
   deliberately, so the feature ships without manually provisioned indexes.
   v2 keeps this constraint and states where it stops being acceptable (§12).
5. **One active route per device** — SQLite unique index `one_active_route`
   over all non-terminal routes. Verified device-wide, not per-account
   (probe C, §11.3). Pull-apply defers rather than violates it.

### 1.3 What v1 deliberately did *not* do

No background scheduler, no field-level merge, no dispatcher read-across
endpoint, no deletion UI, no organization concept, and no sync for anything
outside the route snapshot. All of that is still true.

---

## 2. Remaining local data inventory

Full schema v15 is 29 SQLite tables (`npm run validate:schema`). Everything not in the v1 snapshot is
below, with the fact that decides its class: **does anything actually write
it, and is it reconstructible?**

| Table | Rows written by | Live today? | Reconstructible? |
|---|---|---|---|
| `vehicles` | `TripSheetRepository.saveVehicle` / `ensureVehicle` | yes (device singleton, id `vehicle-primary`) | no |
| `trip_sheets` | `TripSheetRepository.syncCompletedDate` | yes | **yes — recomputed from completed routes** |
| `trip_sheet_routes` | same | yes | yes |
| `trip_time_entries` | *nothing* | no | n/a |
| `fuel_entries` | *nothing* (screen is `FoundationScreen` placeholder) | **no** | no, once written |
| `saved_locations` | `SavedLocationRepository.save`, seeded in v10 | yes (2 rows: `warehouse`, `home`) | no |
| `location_preferences` | *nothing* | no | n/a |
| `app_preferences` | 8+ writers, per key | yes | partly |
| `delivery_attempts` | `route-workday.ts` (deliver / fail / undo) | yes | partly (status is on the stop; the undo trail is not) |
| `action_journal` | `route-commands.ts`, `route-workday.ts`, `route-recalculation.ts` | yes | no, but expires (`undo_expires_at`) |
| `route_order_snapshots` | `route-commands.ts` ×4, `route-workday.ts` | yes | no |
| `route_creation_commands` | route creation idempotency | yes | no (device-scoped by definition) |
| `route_sync_state` | assignment download | yes | yes (re-pulled from `/api/assignments`) |
| `import_sources` | route creation | yes | no |
| `import_audits` | import pipeline | yes | no |
| `excel_import_sessions` / `_rows` / `_corrections` | Excel import | yes | no |
| `route_optimization_results` / `_stops` | *nothing* (superseded by routing engine) | no | yes |
| `route_stop_constraints` | *nothing* | no | n/a |
| `manual_route_edits` | *nothing* | no | n/a |
| `routing_engine_runs` / `_candidates` | routing engine | yes | yes (re-run) |
| `routing_recalculations` | *nothing* directly | no | yes |
| `routing_matrix_cache` | provider adapters | yes | yes (expires) |

Three findings change the plan more than anything else in this table:

- **`fuel_entries` has no write path.** The domain service
  (`src/application/services/fuel-consumption.ts`) and the type
  (`domain/vehicle-and-trip.ts`) exist; the screen is a placeholder. There is
  no data to sync and no writer to make sync-aware. Designing its sync now is
  worthwhile; *shipping* it now is building an integration for a feature that
  does not exist.
- **`trip_sheets` are derived.** `syncCompletedDate()` recomputes every field
  from `routes` + `delivery_stops` for a given date, keyed by a deterministic
  id `trip-sheet-${date}-${vehicleId}`. Nothing else writes them; `notes` is
  never set by any UI. Because routes already sync, trip sheets regenerate on
  the second device for free.
- **`vehicles` is a device singleton with a hard-coded primary key.**
  `saveVehicle()` uses `existing?.id ?? 'vehicle-primary'`, and `getVehicle()`
  is `ORDER BY updated_at DESC LIMIT 1`. Every device in the fleet has a row
  literally called `vehicle-primary`. There is no multi-vehicle UI.

`app_preferences` is not one entity. Current keys:

| Key | Writer | Class |
|---|---|---|
| `local_access_username` / `_pin_salt` / `_pin_hash` / `_updated_at` | `local-access.ts` | **C — device-local, security-sensitive. Never sync.** |
| `last_route_end_kind` | `RouteEndPreference` | A — account |
| `last_planning_mode` | `PlanningModePreference` | A — account |
| `default_navigation_provider` | `NavigationPreference` | C — device (Waze on the phone, Apple Maps on the iPad) |
| `theme_preference` | `theme-preference.ts` | C — device (screen/lighting differ per device) |
| `pwa_service_worker_version`, `pwa_last_successful_write_at`, `last_pwa_restore_at` | PWA runtime / settings | D — device diagnostics |
| `route_cloud_sync_cursor` | `route-cloud-sync.ts` | C — device bookkeeping (but see §14.9) |

---

## 3. Ownership matrix

Classes: **A** account-synced · **B** organization/shared · **C** device-local
· **D** derived/cache.

| Entity | Class | Ownership key | Sync in v2? |
|---|---|---|---|
| `routes`, `delivery_stops`, `shipment_lines` | A | `ownerEmployeeId` | already (v1) |
| `saved_locations` | **A** | `employeeId` + `kind` | **yes — phase 1** |
| `app_preferences` (allowlisted keys only) | **A per key** | `employeeId` + `key` | **yes — phase 1** |
| `app_preferences` (`local_access_*`) | **C** | device | never |
| `app_preferences` (theme, navigation, PWA diagnostics) | C | device | no |
| `vehicles` | **B by nature, A in v2** | `employeeId` + `vehicleId`, `organizationId` reserved | **yes — phase 2** |
| `routes.vehicle_id` | A | rides in the route snapshot | phase 2 (currently nulled — §14.3) |
| `delivery_attempts` | **A** | owning route | **yes — phase 3, inside the route snapshot** |
| `fuel_entries` | **A** (author) / **B** (vehicle) | `vehicleId` + `recordedByEmployeeId` | **no — phase 4, with the feature** |
| `location_preferences` | A | `employeeId` + `normalized_location_key` | no — phase 5, with the feature |
| `trip_sheets`, `trip_sheet_routes`, `trip_time_entries` | **D** | derived from routes | **never — regenerate** |
| `route_order_snapshots` | C | device edit trail | no |
| `action_journal` | C | device undo buffer (expires) | never |
| `route_creation_commands` | C | device idempotency key | never |
| `route_sync_state` | C | device↔assignment link | never (rebuildable from `/api/assignments`) |
| `import_sources`, `import_audits` | C | device that imported | no |
| `excel_import_sessions` / `_rows` / `_corrections` | C | device that imported | no |
| `route_optimization_results` / `_stops` | D | derived | never |
| `route_stop_constraints`, `manual_route_edits` | C (dead tables) | — | never |
| `routing_engine_runs` / `_candidates`, `routing_recalculations` | D | derived, re-runnable | never |
| `routing_matrix_cache` | D | provider cache, `expires_at` | **never** (also a third-party-data-leak vector) |
| `tsp_users`, `tsp_usernames`, `tsp_sessions`, `tsp_assignments` (Firestore) | B | server-owned | unchanged |

### 3.1 Per-entity dossiers

Only entities whose classification is non-obvious, or that the task named
explicitly, get a full dossier. The rest are covered by the matrix and §3.2.

---

#### `saved_locations` — class A (account-synced)

**Why A.** Two rows: the warehouse the driver starts from and the home they
finish at. They are personal planning defaults, not company master data — the
warehouse is *this driver's* loading point. `ResolveRouteLocations` refuses to
create a route without them (`"Numatytasis sandėlis nenustatytas"`), so a
second device that lacks them cannot plan a route at all. Highest
value-per-byte of anything left: 2 rows, ~400 bytes, and it removes a hard
blocker on a fresh device.

**Ownership key.** `employeeId` + `kind` (`'warehouse' | 'home'`).

**Server shape.** `tsp_user_locations/{employeeId}--{kind}`:

```
{ ownerEmployeeId, entity: 'saved_location', localId: kind,
  payload: { kind, label, endpoint_json, created_at, updated_at },
  deleted: false, clientUpdatedAt, serverUpdatedAt, createdAt }
```

**Stable id.** The local primary key is `kind`, which is *not* globally
unique and fails `safeId()` (`'home'` is 4 chars; the regex demands 8–80).
The document id is therefore composed: `${employeeId}--${kind}`. The server
recomputes that prefix from the session and rejects any mismatch, so
ownership is enforced by the key itself. **No local re-keying, no migration
of the primary key.**

**Migration of existing data.** None beyond two bookkeeping columns
(`cloud_synced_at`, `cloud_deleted_at`). Both existing rows have `updated_at`
already, so the computed-dirtiness rule uploads them on the first sync — same
free-migration property v1 relies on. Note the v10 seed wrote identical
default rows on *every* device with the same `updated_at`
(`2026-08-03T00:00:00.000Z`); if two devices both still hold untouched seeds,
LWW sees equal timestamps and the first writer wins, which is correct because
the content is byte-identical.

**Conflict.** Per-kind LWW by `updated_at`. Warehouse and home never conflict
with each other because they are separate documents. No terminal-state
concept applies.

**Deletion.** There is no delete UI — `save()` is upsert-only. Tombstone
support is implemented for symmetry (`cloud_deleted_at` → `deleted: true`),
and a pulled tombstone deletes the local row. In practice the field stays
null.

**Offline.** Fully local-first. A device that never syncs keeps working with
its own defaults. On reconnect the newer edit wins.

**Security.** Self-scoped: `where ownerEmployeeId == profile.id`. Contains a
home address — genuinely personal data — so it must never be readable by
dispatcher/admin endpoints. No admin read path is added.

**Relationship with routes.** `routes.start_location_json` /
`end_location_json` are resolved *copies*, not references, so a synced route
already carries its endpoints; syncing `saved_locations` only fixes *future*
planning on the second device. The two are independent — good.

**Worth it?** **Yes.** Smallest possible payload, removes a hard blocker,
zero interaction with route conflict rules.

---

#### `vehicles` — class B by nature, shipped as A

**Why not simply A.** A van is a company asset used by whichever driver is
assigned to it. Registration number, dimensions, payload limits and fuel norm
are properties of the *vehicle*, not of the person — and the table already has
`CREATE UNIQUE INDEX vehicle_registration_number`, which is a global
uniqueness claim that only makes sense at organization scope. Fuel entries,
trip sheets and (once restored) `routes.vehicle_id` all hang off it, and
`route_optimization_results.vehicle_id` is `NOT NULL … ON DELETE RESTRICT`:
vehicles are referenced by routing data, so their identity has to be stable
forever.

**Why not B *now*.** There is no organization entity anywhere in the system —
no `tsp_organizations` collection, no `organizationId` on `EmployeeProfile`,
no role check that could authorize "edit the company's vehicle". Introducing
one to sync a single row per driver is a large, speculative change. The
honest position: **model the data as org-shaped, scope it to the account
until an organization actually exists.**

**Ownership key.** v2: `employeeId` + `vehicleId`. Reserved for v3:
`organizationId` + `vehicleId`, with an account-level
`current_vehicle_id` preference naming which vehicle this driver is on.

**Server shape.** `tsp_vehicles/{employeeId}--{vehicleId}`:

```
{ ownerEmployeeId, organizationId: 'default', entity: 'vehicle',
  localId: vehicleId, payload: <full vehicles row>,
  deleted, clientUpdatedAt, serverUpdatedAt, createdAt }
```

`organizationId: 'default'` is written from day one so the v3 migration is a
backfill, not a schema change.

**Stable id — the important part.** Every device's row is literally
`vehicle-primary`. Three consequences:

1. Because the document id is `${employeeId}--vehicle-primary`, two
   *different* employees never collide. Ownership is safe.
2. Two devices of the *same* employee collide **on purpose**: both describe
   the same physical van, so LWW converging them into one record is the
   correct outcome for today's one-driver-one-van reality.
3. It stops being correct the moment a second vehicle exists. **Do not
   re-key `vehicle-primary` in this phase** — re-keying independently on each
   device would generate two different ids for one van and produce duplicates
   on first sync, which is strictly worse than the collision it fixes. The
   re-key belongs to the migration that introduces multi-vehicle support,
   where a single device is authoritative and can rewrite
   `routes.vehicle_id`, `trip_sheets.vehicle_id`, `fuel_entries.vehicle_id`
   and `route_optimization_results.vehicle_id` in one transaction.

**Migration of existing data.** Add `cloud_synced_at`, `cloud_deleted_at`,
`organization_id`; no key change, no data rewrite. Existing rows are dirty by
computation on first sync.

**Conflict.** Whole-document LWW by `updated_at`, plus one server guard:
reject a push whose `registration_number` is already held by a *different*
`localId` under the same owner, mirroring the local unique index. Without
that guard a pull can insert a row that the local unique index then rejects,
which would abort the pull transaction.

**Deletion.** No delete UI exists. Tombstones are supported but a pulled
tombstone must **not** delete a local vehicle that is still referenced by
`trip_sheets` (`ON DELETE RESTRICT`) or `route_optimization_results`
(`RESTRICT`). Rule: apply a vehicle tombstone only if no local FK references
it; otherwise keep the row and log. Never let a remote delete throw inside
the pull transaction — that is exactly the failure mode of defect §14.1.

**Offline.** Local-first; `ensureVehicle()` fabricates a default van when the
table is empty, which means an offline second device will create its own
`vehicle-primary` before it ever syncs. That is fine — it collides by design
(point 2 above) and LWW resolves it. Worth knowing: the fabricated default
(`'Darbinis automobilis' / 'NENURODYTA'`) has a *newer* `updated_at` than the
real record on the other device, so **a fresh device that auto-creates a
default vehicle before its first sync will overwrite the real one.**
Mitigation: on push, skip vehicles that still hold both default sentinel
values and have never been edited by the user.

**Security.** Self-scoped in v2. When it becomes org-shared: read for every
authenticated employee in the org, write for `admin`/`dispatcher` and for the
driver currently assigned to that vehicle.

**Relationship with routes.** Direct and currently broken:
`exportRouteSnapshot` sets `vehicle_id: null` (§14.3). Restoring the field is
only safe once vehicles sync, because a route referencing a vehicle id the
receiving device does not have would violate
`routes.vehicle_id REFERENCES vehicles(id)`. **Vehicles must therefore sync
before, or in the same pass as, un-nulling `vehicle_id`** — and the pull must
apply vehicles before routes within a sync pass.

**Worth it?** **Yes, and it is a prerequisite**, not for its own three fields
but because fuel, trip sheets and the route↔vehicle link all depend on a
stable cross-device vehicle identity. Low volume (1 row), moderate care.

---

#### `fuel_entries` — class A (author) / B (vehicle), **not in v2**

**Why A/B.** A fuel fill is an immutable financial event: money, litres,
odometer, station, timestamp. It is authored by a person but belongs to a
vehicle; consumption is computed *between two full-tank fills*
(`calculateFullTankConsumption`), so the entries form a sequence whose value
depends on completeness. A missing entry does not degrade the answer — it
silently falsifies it (a partial fill counted as an interval boundary changes
l/100 km). That makes fuel data the least tolerant of lossy sync in the whole
schema, and the least tolerant of blind LWW.

**Why not now.** Nothing writes the table. `src/app/fuel.tsx` is a nine-line
`FoundationScreen` placeholder. Syncing an empty table is pure overhead, and
the write path that does not exist yet is exactly the place where sync
correctness has to be built in (an id that is unique across devices, an
`updated_at`, and append-only semantics).

**Ownership key.** `vehicleId` + entry id, with `recordedByEmployeeId` as
authorship metadata. Scoped by `ownerEmployeeId` in v2's account model; moves
to `organizationId` with vehicles.

**Server shape.** `tsp_fuel_entries/{employeeId}--{entryId}`, payload = the
row. Query by `ownerEmployeeId` only (same no-composite-index rule).

**Stable id.** Must be generated by `defaultIdFactory('fuel')` →
`fuel-${Date.now()}-${random8}`, never a deterministic or sequential id. This
is a **requirement on the future feature**, and the single most valuable thing
this document can say about fuel entries.

**Migration.** None — table is empty on every device. Confirmed: no INSERT
exists anywhere in `src/`.

**Conflict.** **Append-only, not LWW.** Two devices creating entries create
distinct ids; there is nothing to merge. Edits (if ever allowed) are LWW by
`updated_at` — which requires adding an `updated_at` column, since the table
currently has only `created_at`. A deletion must be a tombstone, never a hard
delete, because a silently vanished fill corrupts every consumption interval
that spans it.

**Deletion.** Tombstone (`cloud_deleted_at`), retained forever;
`calculateFullTankConsumption` must be fed only non-deleted entries.

**Offline.** Perfect fit for offline capture — fills happen at petrol
stations, often with no signal. Entries queue locally and upload later; order
of arrival is irrelevant because the interval maths sorts by odometer.

**Security.** Self-scoped; financial data. Never expose across employees
without an explicit org model and an explicit role check.

**Relationship with routes.** Indirect: `fuel_entries.trip_sheet_id` (nullable,
`ON DELETE SET NULL`) and `vehicle_id`. Odometer readings overlap with
`routes.start_odometer` / `end_odometer` but are independent records.

**Worth it?** **Not yet — and that is the recommendation.** Build the fuel
feature first, sync-aware from the first commit (unique ids, `updated_at`,
tombstones). Retro-fitting sync onto a table full of `fuel-1`-style ids would
be far more expensive than getting it right at creation.

---

#### `trip_sheets` / `trip_sheet_routes` / `trip_time_entries` — class D (derived)

**Why D, not A.** `syncCompletedDate()` computes every stored field from
`routes` + `delivery_stops` for a date: distances, odometers, durations,
delivered weight, stop counts, start/end locations. The id is deterministic
across devices (`trip-sheet-${date}-${vehicleId}`), and `trip_sheet_routes` is
deleted and rebuilt on every run. Nothing else writes them: `notes` is passed
as `null` on insert and is not in the `ON CONFLICT DO UPDATE` list, and no UI
writes it. `trip_time_entries` has no writer at all.

Since routes already sync, **the derived output regenerates on the second
device from already-synced inputs.** Syncing it would ship a second, weaker
copy of data the device can compute exactly.

**What is needed instead.** Regeneration is currently manual — the user must
open *Kelionės lapai* and press "Atnaujinti iš užbaigtų maršrutų". The
correct v2 change is a one-line trigger: after a sync pass applies at least
one `completed` route, call `TripSheetRepository.syncAllCompletedDates()`.
That is a **derivation trigger, not a sync integration**, and it costs
nothing to keep correct.

**Ownership key.** n/a (derived). If it were synced: `employeeId` + date +
vehicle.

**Conflict.** n/a. Regeneration is idempotent and deterministic given the
same routes, which is exactly the property that makes syncing unnecessary.

**Deletion.** n/a — rows are rewritten, never deleted, except
`trip_sheet_routes` which is rebuilt per run.

**Offline.** Regeneration is a pure local computation; works fully offline.

**Security.** n/a locally. Note that a trip sheet is the artefact most likely
to be wanted by an *employer* rather than the driver — if trip-sheet export or
dispatcher visibility is ever requested, the entity moves to class B and needs
a real server model. Today no such requirement exists.

**Relationship with routes.** Total: it is a projection of them. **And it is
the source of the most serious defect in v1** — `trip_sheet_routes.route_id`
is `ON DELETE RESTRICT`, which makes `applyRouteSnapshot`'s delete-and-reinsert
fail outright (§14.1).

**Worth it?** **No.** Do not sync. Trigger regeneration instead. Revisit only
if a manual-edit UI (notes, corrected odometer) is added — the moment a human
can type into a trip sheet it stops being derived and becomes class A.

---

#### `delivery_attempts` — class A, inside the route snapshot

**Why A.** Written by `route-workday.ts` on every delivery, failure and undo.
The stop row keeps the *current* status; the attempt row keeps the history
(including `undone_at`). It is genuine operational history, and today
**pull-apply destroys it** on the originating device (§14.2, probe B).

**Ownership key.** The owning route — no independent ownership.

**Server shape.** Extend `RouteSnapshot` to
`{ route, stops, shipmentLines, deliveryAttempts }`. The existing document
shape absorbs it; no new collection, no new endpoint.

**Stable id.** Already `defaultIdFactory`-generated; nothing to change.

**Migration.** None. Existing rows ride along on the first push after the
snapshot shape is extended. Server `validateSnapshot()` must treat a missing
`deliveryAttempts` key as `[]` so older clients keep working.

**Conflict.** **Union by id, not replace.** Both devices only ever append to
their own route; taking the union of attempt ids (preferring the copy with a
non-null `undone_at`) avoids losing an attempt recorded on the other device.
This is the one place v2 needs merge semantics rather than snapshot replace.

**Deletion.** Never deleted independently; cascades with the route.

**Offline.** Attempts are created offline by definition — the driver is on the
road. They upload with the next route push.

**Security.** Inherits the route's ownership check exactly.

**Worth it?** **Yes, cheap.** It rides along with an existing document,
requires no new endpoint or table, and stops an active silent data loss.

---

#### `app_preferences` — split per key

**Why per key.** The table mixes an offline PIN hash, UI theme, planning
defaults and PWA diagnostics. Syncing it wholesale would replicate the local
unlock credential across devices — a security regression. Syncing none of it
means the driver reconfigures planning defaults per device.

**Account-level allowlist (v2):** `last_route_end_kind`, `last_planning_mode`.
These are planning intent and should follow the person.

**Device-level (never synced):** `local_access_*` (4 keys, security),
`theme_preference`, `default_navigation_provider` (Waze on Android, Apple Maps
on iPad — a per-device fact), `pwa_*`, `last_pwa_restore_at`, and every sync
cursor.

**Ownership key.** `employeeId` + `key`.

**Server shape.** `tsp_user_preferences/{employeeId}--{key}`, payload
`{ key, value, updated_at }`.

**Stable id.** Composite as above. Keys are short (`last_planning_mode` is 18
chars) and match `[a-z_]+`, so the composite passes `safeId`.

**Migration.** Add `sync_scope TEXT NOT NULL DEFAULT 'device'` and
`cloud_synced_at` to `app_preferences`; set `sync_scope='account'` for the two
allowlisted keys in the migration. **The allowlist lives in the schema, not in
sync code** — that way a new preference is device-local unless someone
deliberately opts it in, which is the safe default for a table that holds a
PIN hash.

**Conflict.** Per-key LWW by `updated_at`. Never whole-table.

**Deletion.** Not supported; preferences are upserted, never deleted.

**Offline.** Trivial — last writer on reconnect wins.

**Security.** The allowlist must be enforced **both** client-side (push filter)
and server-side (reject any key not in the server's own allowlist). A
compromised or buggy client must not be able to upload
`local_access_pin_hash`.

**Worth it?** **Yes, as part of phase 1.** Two keys, a few bytes, and the
schema-level scope column is the thing that keeps this table safe forever.

---

#### `location_preferences` — class A, deferred

Personal notes about awkward addresses ("difficult u-turn", "rear access",
"restricted hours"), with `is_hard_constraint` feeding routing. Genuinely
valuable and genuinely personal — and **completely unwritten today** (only
`pwa-backup.ts` mentions it). Same verdict as fuel: class A, ownership key
`employeeId` + `normalized_location_key`, doc id
`${employeeId}--${hash(normalized_location_key)}` (the raw key is an address
and must not be a document id), LWW by `updated_at`, tombstones supported.
Ship with the feature, not before. Note that `is_hard_constraint` reaches
routing behaviour, so syncing it changes optimization inputs across devices —
that must be an explicit, tested decision when the time comes.

### 3.2 Everything classified C or D, briefly

- **`action_journal`** (C): undo buffer with `undo_expires_at`. Undo only makes
  sense on the device that made the edit. Never sync.
- **`route_order_snapshots`** (C): per-device ordering trail. Not required to
  execute a route (the order is on the stops). Currently destroyed by
  pull-apply; acceptable, but should be a conscious decision (§14.2).
- **`route_creation_commands`** (C): idempotency key for one device's retry.
  Meaningless elsewhere.
- **`route_sync_state`** (C): device↔assignment mapping, rebuildable from
  `/api/assignments`. Its destruction by pull-apply temporarily breaks
  dispatcher progress reporting (§14.2).
- **`import_sources`, `import_audits`, `excel_import_*`** (C): provenance of
  how *this device* built a route. Large (`raw_row_json`, OCR payloads),
  no cross-device value. Excluded.
- **`routing_engine_runs/_candidates`, `routing_recalculations`,
  `route_optimization_results/_stops`** (D): provider computation traces,
  re-runnable, large. Never sync. Also out of bounds for any UI/sync task.
- **`routing_matrix_cache`** (D): third-party provider responses with
  `expires_at`. Never sync — it would replicate cached provider data across
  devices for no benefit and with licensing implications.
- **Dead tables** (`trip_time_entries`, `route_stop_constraints`,
  `manual_route_edits`, `route_optimization_*`): no writers. Do not build sync
  for tables nothing writes.

---

## 4. Recommended synchronization order

Ordered by *value ÷ risk*, with the hard dependencies made explicit.

| Phase | Entities | Why this position |
|---|---|---|
| **0** | *No new entities.* Fix the v1 defects in §14 | Two of them (§14.1, §14.4) are data-loss/outage bugs that every additional synced entity would inherit and amplify |
| **1** | `saved_locations`, account-scoped `app_preferences` (2 keys) | Smallest payload, no FK relationships, no interaction with route conflict rules. Proves the generic account-sync channel on data that cannot break a route |
| **2** | `vehicles`, then un-null `routes.vehicle_id` | Prerequisite for fuel, trip-sheet accuracy and the route↔vehicle link. Must land after phase 1 because it needs the same channel, and vehicles must apply *before* routes within a pass |
| **3** | `delivery_attempts` inside `RouteSnapshot` | Requires the phase-0 fix to `applyRouteSnapshot` (union-merge instead of delete-and-reinsert). Stops an active silent loss |
| **4** | `fuel_entries` | Only once the fuel feature exists. Design fixed now (§3.1) so it is built sync-native |
| **5** | `location_preferences` | Only once the feature exists; touches routing inputs, so needs its own decision |
| **never** | trip sheets, imports, journals, routing traces, matrix cache, `local_access_*` | Derived, device-scoped, or security-sensitive |

**Do not reorder 1 and 2.** Vehicles carry FK relationships in four tables and
a unique index; saved locations carry none. If the generic channel has a flaw,
it should be found on the entity that cannot corrupt anything.

---

## 5. Firestore / API model

### 5.1 One new endpoint, zero changes to route-sync

`/api/route-sync`, `server/route-sync-store.ts` and
`src/application/sync/route-cloud-sync.ts` are **not modified**. Account-scoped
entities get their own endpoint and store:

- `server/account-sync-store.ts` — new
- `POST /api/account-sync`, `GET /api/account-sync` in `server/employee-api.ts`
  (two route branches next to the existing ones, behind the same
  `store.authenticate(token)`)
- `src/application/sync/account-cloud-sync.ts` — new client engine
- `isEmployeePath()` gains `|| pathname.startsWith('/api/account-sync')`

This is deliberate: it keeps the shipped, physically-tested route path
untouched, and it avoids any merge conflict with concurrent sync-UX work.

### 5.2 Uniform document shape

Every account-scoped collection uses one envelope so the store is generic:

```
tsp_user_locations/{employeeId}--{kind}
tsp_user_preferences/{employeeId}--{key}
tsp_vehicles/{employeeId}--{vehicleId}
tsp_fuel_entries/{employeeId}--{entryId}        // phase 4
tsp_location_preferences/{employeeId}--{hash}   // phase 5

{
  ownerEmployeeId: string,   // from the session, never the body
  entity: 'saved_location' | 'preference' | 'vehicle' | ...,
  localId: string,           // the SQLite primary key
  payload: Record<string, string|number|null>,   // the row, verbatim
  deleted: boolean,
  clientUpdatedAt: string,   // payload.updated_at, informational
  serverUpdatedAt: Timestamp,// authoritative ordering + cursor
  createdAt: Timestamp,      // preserved across updates
  organizationId?: string    // vehicles only; 'default' today
}
```

`payload` is stored verbatim so a schema addition on the client does not
require a server change — the same property that lets `RouteSnapshot` carry
new columns today.

### 5.3 Request/response shape

```
POST /api/account-sync
  { items: [ { entity, localId, payload, deleted } ] }
→ { results: [ { entity, localId, outcome: 'applied'|'conflict'|'forbidden'|'rejected',
                 payload?, deleted? } ] }

GET /api/account-sync?since=<json cursor map>
→ { items: [ { entity, localId, payload, deleted, serverUpdatedAt } ],
    cursors: { saved_location: '…', preference: '…', vehicle: '…' } }
```

Per-entity cursors, because entities sync at wildly different rates and a
single cursor would make a busy entity starve a quiet one.

`rejected` is a new outcome v1 lacks: a malformed or non-allowlisted item is
reported per item and **never fails the batch** (§14.7).

### 5.4 Query strategy and cost

Same rule as v1: single-field equality (`ownerEmployeeId ==`) per collection,
filter and sort `serverUpdatedAt` in memory. One driver's account holds ~1
vehicle, 2 locations, 2 preferences — trivially cheap. This stops being
acceptable when fuel entries accumulate (phase 4: hundreds to thousands of
rows/year); at that point add the composite index
`(ownerEmployeeId asc, serverUpdatedAt asc)` **for `tsp_fuel_entries` only**
and keep the rest index-free.

---

## 6. SQLite migration requirements

> **Implemented differently — see §16.1.** Phase 0 shipped as schema v16 with
> `routes.owner_employee_id`, `sync_accounts`, `sync_cursors` and
> `route_sync_deferrals`. The `saved_locations` and `app_preferences.sync_scope`
> columns below belong to phase 1 and are not in v16 yet.

### 6.1 Schema v16 — phase 0 + 1 (as originally designed)

```sql
-- v16: cloud sync v2 groundwork.
BEGIN IMMEDIATE;

-- Per-account, per-entity pull cursors. Replaces the single device-global
-- `route_cloud_sync_cursor` preference, which silently mis-scopes after an
-- account switch (see §14.9). The route cursor is migrated in, not reset.
CREATE TABLE IF NOT EXISTS sync_cursors (
  entity      TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  cursor      TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (entity, employee_id)
);

-- Which account's operational data this device currently holds. NULL means
-- "pre-accounts data, adopt on first sync". Guards the cross-account push
-- leak described in §14.4.
ALTER TABLE routes ADD COLUMN owner_employee_id TEXT;

ALTER TABLE saved_locations ADD COLUMN cloud_synced_at TEXT;
ALTER TABLE saved_locations ADD COLUMN cloud_deleted_at TEXT;

ALTER TABLE app_preferences ADD COLUMN sync_scope TEXT NOT NULL DEFAULT 'device'
  CHECK (sync_scope IN ('device','account'));
ALTER TABLE app_preferences ADD COLUMN cloud_synced_at TEXT;
UPDATE app_preferences SET sync_scope = 'account'
  WHERE key IN ('last_route_end_kind','last_planning_mode');

PRAGMA user_version = 16;
COMMIT;
```

### 6.2 Schema v17 — phase 2

```sql
BEGIN IMMEDIATE;
ALTER TABLE vehicles ADD COLUMN cloud_synced_at TEXT;
ALTER TABLE vehicles ADD COLUMN cloud_deleted_at TEXT;
ALTER TABLE vehicles ADD COLUMN organization_id TEXT;   -- 'default' until orgs exist
UPDATE vehicles SET organization_id = 'default' WHERE organization_id IS NULL;
PRAGMA user_version = 17;
COMMIT;
```

### 6.3 Rules these migrations follow

1. **Additive only.** No table rebuild, no primary-key change, no data
   rewrite. Every rebuild in this schema's history (v5, v6, v9) needed
   `PRAGMA foreign_keys = OFF`; none of that is needed here.
2. **New columns are nullable or defaulted**, so `cloud_synced_at IS NULL`
   automatically marks every pre-existing row as "needs upload" — the same
   free-migration property v1 relies on. No backfill step exists or is needed.
3. **`sync_scope` in the schema, not in code**, so a new preference key is
   device-local by default.
4. **`pwa-backup.ts` must be updated in the same commit.** Its `tables` list
   and `parsePwaBackup` pin `schemaVersion === SCHEMA_VERSION` exactly, so
   every bump invalidates existing backup files by design. `sync_cursors` must
   be *excluded* from the backup table list (restoring another device's cursor
   would skip pulls); `owner_employee_id` and the new columns ride along
   automatically since backup selects `*`.
5. **`npm run validate:schema` must pass** — it rebuilds v1..N in memory and
   runs `PRAGMA foreign_key_check`.
6. Tests that pin the schema version (`tests/unit/route-cloud-sync.test.ts`
   loops `version <= 15`; `pwa-backup.test.ts`, `routing-schema.test.ts`) must
   be updated in the same commit, as the v15 commit already had to do.

### 6.4 What is *not* changed

`trip_sheet_routes.route_id … ON DELETE RESTRICT` is **kept**. The v1 defect
it exposes (§14.1) is a bug in `applyRouteSnapshot`'s delete-and-reinsert
strategy, not in the constraint — the constraint is correctly protecting a
trip sheet from losing its route. Fixing it in the schema would require a
table rebuild and would weaken a real invariant; fixing it in the apply
function is a smaller, safer change (§14.1).

---

## 7. Conflict rules per entity

| Entity | Rule | Rationale |
|---|---|---|
| `routes` (+stops, lines) | terminal-state guard, then LWW by `updated_at` | unchanged from v1; status is a one-way state machine |
| `delivery_attempts` | **union by id**, prefer the copy with `undone_at` set | append-only history; replace would lose the other device's attempts |
| `saved_locations` | per-`kind` LWW by `updated_at` | independent scalars |
| `app_preferences` (account) | per-`key` LWW by `updated_at` | independent scalars; never whole-table |
| `vehicles` | whole-document LWW + registration-number uniqueness guard + default-sentinel skip | one logical record; the guard mirrors the local unique index |
| `fuel_entries` (phase 4) | **append-only**; edits LWW; deletes tombstone-only | a lost or resurrected fill silently falsifies consumption maths |
| `location_preferences` (phase 5) | per-key LWW | independent notes |
| trip sheets | **n/a — regenerate** | derived output, deterministic given the same routes |

Two rules apply to every entity:

- **Ownership beats recency.** A document whose `ownerEmployeeId` differs from
  the session is `forbidden`, never merged, regardless of timestamps.
- **A losing push is not retried.** The client adopts the server's copy
  (as `route-cloud-sync.ts` already does on `conflict`) rather than looping.

---

## 8. Offline model

1. **Every write is local-first.** No new write path becomes network-dependent.
   Sync is an opportunistic reconciliation, exactly as in v1.
2. **Dirtiness stays computed**, per table:
   `cloud_synced_at IS NULL OR updated_at > cloud_synced_at`. This requires
   `updated_at` on every synced table — satisfied by `saved_locations`,
   `vehicles`, `app_preferences`; **not** by `fuel_entries`
   (`created_at` only), which is one more reason phase 4 waits for the feature.
3. **Failure is silence, not an error state.** A failed pass leaves
   `cloud_synced_at` stale and retries on the next trigger. Callers catch and
   treat it as "stayed offline" — the existing convention.
4. **Per-entity isolation.** One entity's failure must not abort the others.
   v1 fails the whole pass on any error (§14.7); the account channel applies
   and reports per item.
5. **Cursor advances only past what was applied.** The cursor is
   `max(serverUpdatedAt)` of *applied* items, never the server's wall clock.
   This is the correction to §14.5 — with a wall-clock cursor, anything
   deferred is skipped forever.
6. **Conflict adoption is offline-safe**: adopting the server's copy is a local
   transaction; if it fails, nothing is marked synced.
7. **Order within a pass**: vehicles → saved locations → preferences → routes.
   Referenced entities apply before referencing ones, so `routes.vehicle_id`
   never points at a vehicle the device has not yet received.

---

## 9. Security model

1. **Owner is always server-derived** from `store.authenticate(token)`. No
   endpoint accepts a client-supplied owner id. Composite document ids
   (`${employeeId}--${localId}`) are recomputed server-side and compared;
   a mismatch is `forbidden`.
2. **Self-scoped reads.** `where ownerEmployeeId == profile.id`. No admin or
   dispatcher read-across path is added for personal data — `saved_locations`
   contains a home address and `fuel_entries` contains spending.
3. **Server-side key allowlist for preferences.** The server rejects any key
   outside its own allowlist, so `local_access_pin_hash` cannot be uploaded
   even by a modified client. The client filters too, but the server is the
   authority.
4. **`local_access_*` never leaves the device.** It is the offline PIN-unlock
   cache; `pwa-backup.ts` already strips it from backups, and the sync channel
   must strip it in the same way.
5. **Payload validation.** Reuse the `insertRow` column guard
   (`/^[a-z][a-z0-9_]*$/`) plus a per-entity column allowlist derived from
   `PRAGMA table_info`, so a pulled payload can never write to an unexpected
   column. Cap payload size per item and item count per batch, as
   `readBody(..., 8_000_000)` already caps the request.
6. **No new credential type.** Same session cookie / bearer token, same
   `authenticateApiRequest`, same rate limiting.
7. **Cross-account device hygiene.** `routes.owner_employee_id` plus a
   `device_data_owner` check must prevent employee B's device from pushing
   employee A's leftover local routes into B's account (§14.4). This is a
   security fix, not a feature.
8. **Organization readiness.** When vehicles become org-shared: read for
   employees of the org, write for `admin`/`dispatcher` or the assigned
   driver, enforced by `requireRole` — the mechanism already exists.

---

## 10. Deployment / migration strategy

Sequenced so no step can strand a device. **This document deploys nothing.**

1. **Schema first, client-only.** Ship v16 in an app release that does *not*
   yet call the new endpoint. Migrations are additive; older server code is
   unaffected. Verify `npm run validate:schema` and the schema-pinned tests.
2. **Server next, additive.** Deploy `account-sync-store.ts` and the two route
   branches via the existing `npm run cloud-run:deploy`. Old clients never
   call the new paths; `isEmployeePath` gating means unknown paths still 404
   as before.
3. **Enable phase 1 in the client.** Push-then-pull for saved locations and
   the two preference keys.
4. **Physically verify on two devices** (phone + tablet), the same way route
   sync v1 was validated: change the warehouse on the phone, confirm it
   appears on the tablet; change the planning mode on the tablet, confirm it
   appears on the phone; confirm the theme and navigation provider do **not**
   cross over.
5. **Phase 2 (vehicles) as a separate release**, with schema v17 shipped one
   release ahead of the client code that syncs vehicles, and
   `routes.vehicle_id` un-nulled only after vehicles are confirmed to apply
   before routes.
6. **Rollback.** Each phase is disabled by not calling the client engine —
   the schema columns are inert if unused. Nothing is destructive, so rollback
   never requires a data restore. `pwa-backup.ts` export remains the
   device-level escape hatch.
7. **Never** deploy a schema bump and a server contract change in the same
   release; the version-pinned backup format makes that combination hard to
   diagnose.

---

## 11. Test strategy

Mirror the existing patterns exactly — in-memory `node:sqlite` adapter for the
client (`tests/unit/route-cloud-sync.test.ts`), pure decision functions for the
server (`tests/unit/route-sync-store.test.ts`), no Firestore in unit tests.

### 11.1 Server (pure, no Firestore)

- `decideAccountPushOutcome` per entity: first write, newer write, stale write,
  wrong owner, non-allowlisted preference key, malformed payload → `rejected`
  without failing the batch.
- Composite-id derivation and the id/session mismatch rejection.
- Vehicle registration-number uniqueness guard.
- Fuel append-only semantics (phase 4): re-pushing the same id is a no-op; a
  tombstone never resurrects.

### 11.2 Client (in-memory SQLite)

- Phase 1: first upload of both saved locations; second-device download into an
  empty DB; per-key preference merge; **`local_access_*` and `theme_preference`
  are never pushed** (explicit negative test).
- Repeat-sync idempotency (two passes, no duplicate rows).
- Offline: fetch rejects → local rows unchanged, `cloud_synced_at` still null.
- Cursor: an item deferred by a guard does **not** advance the cursor past
  itself, and is re-offered on the next pull (regression test for §14.5).
- Account switch: cursors are per `employee_id`; employee B's first sync does
  not inherit employee A's cursor (regression test for §14.9).
- Cross-account push guard: routes owned by A are not pushed while B is signed
  in (regression test for §14.4).
- Phase 2: vehicle applies before routes in one pass; a route carrying
  `vehicle_id` never violates the FK; the default-sentinel vehicle is not
  pushed over a real one.
- Phase 3: `deliveryAttempts` union-merge keeps attempts recorded on both
  devices; a snapshot without the key is treated as `[]`.

### 11.3 Schema and defect probes

`npm run validate:schema` plus a probe harness that rebuilds v1..N in memory.
The four probes used to produce §14 (reproducible, ~70 lines, `node:sqlite`):

| Probe | Result |
|---|---|
| A — delete a route referenced by `trip_sheet_routes` | **`FOREIGN KEY constraint failed`** |
| B — delete+reinsert a route | `delivery_attempts` 1→0, `route_sync_state` 1→0, `vehicle_id` → `null` |
| C — two non-terminal routes | `UNIQUE constraint failed: index 'one_active_route'` (device-wide) |
| D — route with zero stops | inserts fine locally; server `validateSnapshot` demands ≥1 |

Probe A should become a permanent regression test once §14.1 is fixed: *"a
route that belongs to a trip sheet can still be applied from the cloud."*

### 11.4 Physical verification

Every phase ends with a two-device manual pass, because that is what actually
validated v1. Unit tests cannot catch an ordering bug between two real devices
with real clocks.

---

## 12. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Shipping phase 1+ on top of the unfixed v1 defects.** §14.1 already breaks sync permanently on any device with trip sheets; more entities means more silent loss | **critical** | Phase 0 is mandatory and blocking |
| R2 | **`vehicle-primary` id collision** becomes data loss the moment a second vehicle exists | high | Do not re-key now; gate multi-vehicle support behind an id migration performed by one authoritative device |
| R3 | **Fresh-device default vehicle overwrites the real one** via `ensureVehicle()` + newer `updated_at` | high | Skip pushing vehicles that still hold both default sentinels and were never user-edited |
| R4 | **Preference allowlist drift** — a future key holding a secret gets synced by accident | high | `sync_scope` defaults to `'device'` in the schema; server-side allowlist as the authority |
| R5 | **Cross-account contamination** on a shared device (§14.4) | high | `routes.owner_employee_id` + device-owner guard before any push |
| R6 | **Route↔vehicle FK ordering** — a route arrives referencing an unknown vehicle | medium | Fixed apply order per pass; skip-and-defer rather than throw |
| R7 | **Firestore read cost** once fuel entries accumulate under the no-composite-index rule | medium | Add the composite index for `tsp_fuel_entries` only, at phase 4 |
| R8 | **Divergent active routes** — two devices each create an active route offline; the cloud has no one-active-route constraint, so each defers the other forever | medium | Surface it in the UI as a real state; do not silently defer (coordinate with the sync-UX work) |
| R9 | **Backup format churn** — every schema bump invalidates existing `.json` backups by design | low | Bundle the `pwa-backup.ts` update in the same commit; tell the user to re-export |
| R10 | **Scope creep into routing** — `location_preferences.is_hard_constraint` feeds the optimizer | low | Phase 5 is explicitly a separate decision with its own routing tests |

---

## 13. Recommended implementation phases

Each phase is one coherent commit series, independently shippable and
independently revertible.

**Phase 0 — correctness groundwork (blocking, no new entities) — DONE, see §16**
1. `applyRouteSnapshot`: replace delete-and-reinsert with an upsert that
   preserves satellite rows (§14.1, §14.2).
2. Stop nulling `vehicle_id` on export *or* stop writing the null back on
   apply (§14.3).
3. Account-scope the dirty-route query and the cursor (§14.4, §14.9).
4. Cursor = max applied `serverUpdatedAt` (§14.5).
5. Apply pulled tombstones (§14.6).
6. Per-item push results instead of a batch-fatal 400 (§14.7).
7. Regression tests, including probe A.
*Owner note: items 1–7 all live in files the concurrent sync-UX work may also
touch. Sequence with that work; do not land both blind.*

**Phase 1 — account preferences channel**
`sync_cursors`, `sync_scope`, new endpoint + store + client engine,
`saved_locations` and two preference keys. Two-device verification.

**Phase 2 — vehicles**
Schema v17, vehicle sync, apply-ordering, sentinel guard, then un-null
`routes.vehicle_id`.

**Phase 3 — delivery attempts in the route snapshot**
Extend `RouteSnapshot` with `deliveryAttempts`, union-merge, backward-
compatible validation.

**Phase 4 — fuel entries, with the fuel feature**
Build the feature sync-native: generated ids, `updated_at`, tombstones,
append-only. Add the one composite index.

**Phase 5 — location preferences, with that feature**
Explicit decision about routing impact.

**Not planned:** trip sheets (regenerate after pull instead), imports,
journals, routing traces, matrix cache, device preferences, `local_access_*`.

---

## 14. Defects found in the shipped v1 implementation

All ten were **fixed in Phase 0** on this branch (§16), except §14.10, which is
a product decision rather than a defect. Each subsection keeps the original
root-cause analysis and now ends with how it was resolved. Every claim below was
verified by reading the code, and §14.1–§14.3 additionally by an isolated
in-memory SQLite probe (§11.3); all ten now have regression tests.

### 14.1 CRITICAL — a route in a trip sheet cannot be pulled; sync dies silently

`applyRouteSnapshot` (`route-assignment-sync.ts:41-47`) does
`DELETE FROM routes WHERE id = ?` before reinserting.
`trip_sheet_routes.route_id` is `REFERENCES routes(id) ON DELETE RESTRICT`
(`migrations.ts:198`). Probe A: the delete fails with
`FOREIGN KEY constraint failed`.

Blast radius: the exception propagates out of `pullRemoteRoutes` before
`setSyncCursor`, so the cursor never advances, the same route is returned on
every subsequent pull, and it fails again — forever. The home screen catches
and logs to `__DEV__` only, so **the user sees nothing**. And the trigger is
routine: pull returns the device's *own* routes right after push
(`serverUpdatedAt > since`), so the first sync pass on a device that has ever
pressed "Atnaujinti iš užbaigtų maršrutų" breaks permanently.

Recommended fix: upsert the route row (`INSERT … ON CONFLICT(id) DO UPDATE`)
instead of delete-and-reinsert; reconcile stops by id rather than wiping them.
Do not weaken the constraint.

### 14.2 HIGH — pull-apply silently destroys local satellite data

The same delete cascades. Probe B, on one applied route:
`delivery_attempts` 1→0, `route_sync_state` 1→0. By the same cascade:
`action_journal`, `route_order_snapshots`, `import_sources`,
`route_creation_commands`, `route_stop_constraints` (via `delivery_stops`),
and any routing/optimization rows for that route.

Two of these matter operationally: `delivery_attempts` is real delivery
history (§3.1), and `route_sync_state` is what
`pushRouteAssignmentProgress()` looks up — once it is gone, that function
returns `false` and **the dispatcher stops receiving progress** for an
assigned route until the next assignment pull re-creates the row.

### 14.3 HIGH — the route↔vehicle link is erased by a sync round trip

`exportRouteSnapshot` writes `vehicle_id: null` into the snapshot
(`route-assignment-sync.ts:24`) — correct for the assignment flow, where the
receiving device has different vehicles. But cloud sync reuses the same
export, and `applyRouteSnapshot` writes the snapshot back over the local row.
Probe B: `vehicle_id` becomes `null` on the originating device. The route's
vehicle association is destroyed by syncing, permanently, with no user-visible
signal.

### 14.4 HIGH — cross-account data leak on a shared device

`pushDirtyRoutes` selects `FROM routes WHERE cloud_synced_at IS NULL OR …`
with no owner predicate, and logout (`local-access-gate.tsx:120-129`) clears
only session state — the SQLite database is untouched. So when employee B
signs in on a device employee A used, B's first sync **uploads A's routes into
B's cloud account**, where `ownerEmployeeId` is stamped as B. There is no way
back: the server now believes B owns them.

Note this is the exact scenario the app's own account-switcher UI invites
(commits `d86617a`, `c98b3bd`).

### 14.5 MEDIUM-HIGH — deferred routes are lost, contradicting the v1 design doc

`docs/CLOUD_SYNC_ARCHITECTURE.md` §7 states a deferred route is left
unapplied but "the cursor still advances past it so a *later* pull re-checks
it". It cannot: `pull()` returns only `serverUpdatedAt > since`, and the
cursor is set to the server's wall clock at request time
(`route-sync-store.ts:127`). Once the cursor passes a deferred route's
`serverUpdatedAt`, that route is never offered again unless another device
touches it. A route deferred by the one-active-route guard therefore never
arrives on the second device.

Fix: cursor = `max(serverUpdatedAt)` over *applied* items only.

### 14.6 MEDIUM — deletion is not implemented in either direction

`pullRemoteRoutes` reads `pulledRoute.deleted` into its type but never
branches on it — a tombstoned route is applied as a normal route. And nothing
in the entire codebase ever *writes* `cloud_deleted_at` (verified by grep:
only the migration, the dirty-route select, and tests reference it). Deletion
propagation is effectively absent, not merely incomplete.

### 14.7 MEDIUM — one invalid route disables all sync

Server `validateSnapshot` throws `EmployeeApiError(400)` for a snapshot with
0 stops or >500 stops (`employee-auth-store.ts:360-367`), and it throws from
inside `push()` *before* the per-item transaction, so the whole `POST` returns
400. The client's `employeeApi` throws, `pushDirtyRoutes` throws, and
`syncRoutesWithCloud` never reaches the pull. A zero-stop route is
representable locally (probe D; `DeleteDraftStop` removes stops one at a time
with no minimum-count guard), so a single such route stops **all** sync — push
and pull — until it is fixed or deleted.

Fix: validate per item inside the loop and report `rejected` for that item
only, as §5.3 specifies for the new channel.

### 14.8 MEDIUM — dispatchers never cloud-sync at all

`src/app/index.tsx:57-60`: the focus effect returns immediately for
`profile.role === 'dispatcher'` (redirect to `/dispatcher`), and
`syncRoutesWithCloud` is called nowhere else. `local-access-gate.tsx` calls
only `pullAssignedRoutes`. So a dispatcher planning a route on the desktop and
continuing on a tablet gets nothing; their routes reach the cloud only as a
side effect of `createAssignment` seeding `tsp_routes` under the *driver's*
id.

**Answer to the audit question "does the dispatcher role need its own sync
trigger path?" — yes.** Not a different protocol, but a trigger on the
dispatcher workspace (`src/app/dispatcher.tsx`) equivalent to the home
screen's. That file is part of the concurrent sync-UX work, so it is
documented here rather than changed.

### 14.9 LOW-MEDIUM — the sync cursor is device-global, not per-account

`route_cloud_sync_cursor` is a single `app_preferences` key
(`route-cloud-sync.ts:6`). After an account switch, the new account's first
pull uses the previous account's cursor and silently skips everything older
than it. Fixed by the `sync_cursors` table in §6.1.

### 14.10 LOW — no cloud-side one-active-route invariant

SQLite enforces one non-terminal route per *device* (probe C). The cloud has
no equivalent rule, so two devices can each create an active route offline and
both push successfully. Each then defers the other's forever (worsened by
§14.5). This is a product decision, not a bug — but it currently resolves as
invisible divergence.

---

## 15. Answers to the specific audit questions

**Does the dispatcher role need its own sync trigger path?**
Yes — see §14.8. Same protocol, missing trigger.

**Should settings be account-level or device-level?**
Both, split per key, with the split stored in the schema and device-local as
the default. Account: `last_route_end_kind`, `last_planning_mode`. Device:
theme, navigation provider, all PWA diagnostics, all sync cursors, and — as an
absolute rule — `local_access_*`. See §3.1.

**Should saved locations be personal or shared?**
Personal (class A). They include a home address and a driver-specific loading
point. No dispatcher/admin read path.

**Should vehicles belong to user, organization, or both?**
Organization by nature, user in practice today. Ship account-scoped with an
`organizationId` field written from day one, so promoting them to
organization-owned later is a backfill plus a role check rather than a
re-model. See §3.1.

**Is syncing each of these actually worth the complexity?** (see §16 for what
Phase 0 changed)
Saved locations and preferences: yes, decisively — tiny and they unblock
planning on a second device. Vehicles: yes, mainly as the prerequisite for
fuel, trip-sheet accuracy and the route↔vehicle link. Delivery attempts: yes,
nearly free. Trip sheets: no — regenerate. Fuel and location preferences: yes
eventually, but only alongside the features that write them. Everything else:
no.

---

## 16. Phase 0 implementation record

Phase 0 shipped on `agent/claude-sync-v2` as seven commits. Nothing from phases
1–5 was started: no new entity syncs.

### 16.1 Where the implementation differs from §6.1

| Design (§6.1) | Shipped in v16 | Why |
|---|---|---|
| `routes.owner_employee_id` | same | — |
| `sync_cursors(entity, employee_id)` | same | — |
| device-owner key in `app_preferences` | **`sync_accounts(employee_id, claim_from)`** | A single device-owner key cannot answer *"is this route mine or my colleague's?"* for routes created **after** an account switch. A per-account claim boundary can: the first account to sync claims everything already on the device (the migration path), every later account claims only routes created after it started using the device. Both accounts keep working; neither can upload the other's history. |
| — | **`route_sync_deferrals`** | §14.5 needs somewhere durable to keep a pull that could not be applied. Rewinding the cursor instead would re-fetch the whole tail on every pass and still lose the route if the blocker outlived the server's retention. |
| `saved_locations` / `app_preferences.sync_scope` columns | **not in v16** | Phase 1 work; adding unused columns now would be schema churn. |

Two fixes were added that the audit had not identified as separate defects:

- **Pull no longer overwrites newer local work.** v1 applied every pulled
  snapshot unconditionally, so a stale cloud copy could discard local changes.
  The apply is now skipped when the local `updated_at` is newer; the local copy
  is still dirty and wins on the next push, which is the server's own rule.
- **`markRouteDeletedForCloud` stamps monotonically.** A tombstone stamped with
  a device clock that lags behind the last sync would never count as dirty and
  would lose latest-write-wins anyway. The stamp is forced past both
  `updated_at` and `cloud_synced_at`. Found by a test, not by review.

### 16.2 Defect status

| Defect | Status | Fix |
|---|---|---|
| §14.1 route in a trip sheet cannot be pulled | fixed | route row updated in place instead of deleted + reinserted |
| §14.2 pull-apply destroys satellite rows | fixed | same, plus `delivery_attempts` carried across the stop replacement by hand |
| §14.3 `vehicle_id` erased by a round trip | fixed | incoming null keeps the local value; incoming value wins |
| §14.4 cross-account upload | fixed | `owner_employee_id` + claim boundary + identity from `GET /api/auth/me` |
| §14.5 deferred routes lost | fixed | `route_sync_deferrals`, retried before every pull |
| §14.6 deletion not implemented | fixed | `markRouteDeletedForCloud`, tombstone push, pull-side purge with an `in_progress` guard |
| §14.7 one invalid route disables all sync | fixed | per-item validation and per-item transactions server-side; per-route export and a `rejected` outcome client-side |
| §14.8 dispatchers never sync | fixed | sync pass on the dispatcher workspace refresh |
| §14.9 device-global cursor | fixed | `sync_cursors` keyed by account |
| §14.10 no cloud-side one-active-route rule | **open, by design** | product decision; divergence is now at least visible (`deferred` count and a durable deferral row) rather than silent |

### 16.3 Verification

`npm run typecheck`, `npm test` (620/620), `npm run gateway:test` (52/52),
`npm run validate:schema` (v16, 32 tables), `npm run pwa:build`, `npm run
pwa:test` (8/8 plus a clean production-bundle secret scan) — all green.

Not verified: two physical devices. Phase 0 changes what happens on a real
account switch and on a real trip-sheet device, and unit tests cannot prove the
two-device behaviour that validated v1 in the first place (§11.4).

### 16.4 Integration with the event-driven sync UX

`agent/codex-sync-ux` was merged on top of Phase 0 in `agent/integration-sync`.
Both merges were textually clean; the reconciliation that was required is
recorded here.

- **Trigger ownership moved to the coordinator.** `RouteCloudSyncProvider`
  wraps the whole navigation stack inside `LocalAccessGate`, so its startup,
  foreground, window-focus, network-restored and mutation triggers are
  role-agnostic and already cover dispatchers — the gap §14.8 described. The
  dispatcher-specific `syncRoutesWithCloud` call was therefore removed: keeping
  it would have run a second pass concurrently with a lifecycle one, outside the
  coordinator's serialisation and invisible to the status indicator. The
  workspace refresh now requests `'dispatcher-refresh'` through the coordinator,
  which preserves the fix without the duplication.
- **The engine itself is untouched by the merge.** The coordinator calls
  `syncRoutesWithCloud(db)` and ignores its return value, so every Phase 0
  guarantee — ownership claiming, per-account cursors, non-destructive apply,
  tombstones, deferrals, bad-record isolation — survives the UX layer unchanged.
- **Semantic conflict found by the merged tests:** the in-memory cloud fake did
  not serve `/api/auth/me`, which Phase 0 made the first call of every pass. The
  fake now answers it like the real server, rather than the engine being
  loosened to tolerate a missing identity.
- **Known gap, not a regression:** `RouteCloudSyncResult.foreign`, `.rejected`
  and `.deferred` are computed but never surfaced, because the coordinator's
  `sync` callback is typed `() => Promise<unknown>`. Routes held back because
  they belong to another account, or rejected as unsyncable, are therefore
  invisible in the UI. Worth wiring into `CloudSyncStatus` in a follow-up.

---

## 17. Phase 1 implementation record

Phase 1 shipped on `agent/claude-sync-v2-phase1` as three commits, moving the
schema to v17. Scope: `saved_locations` and two allowlisted `app_preferences`
keys. Vehicles, fuel entries, trip sheets and `location_preferences` were not
touched — they remain phases 2–5.

### 17.1 What was built, and where it differs from §5/§6

| Design | Shipped | Note |
|---|---|---|
| `/api/account-sync` GET/POST, own store | as designed | `server/account-sync-store.ts`, wired into `employee-api.ts` behind existing session auth |
| Composite doc ids `${employeeId}--${localId}` | as designed | ownership enforced by the key itself, plus a stored `ownerEmployeeId` check |
| `saved_locations` cloud columns | as designed | plus `owner_employee_id` |
| `app_preferences.sync_scope` | as designed | plus `owner_employee_id`, `cloud_synced_at` |
| per-entity cursors | as designed | reuses `sync_cursors` from v16, keyed by (entity, employee_id) |
| — | **`sync_accounts` claim boundary reused** | §3.1 did not say how ownership of pre-existing rows is decided; phase 0's rule is reused verbatim rather than inventing a second one |
| — | **cursor = newest record returned** | not the server clock, correcting §14.5's mistake by construction |

`saved_locations` deliberately keeps `kind` as its primary key. Re-keying to
`(owner, kind)` would have forced `SavedLocationRepository` and
`ResolveRouteLocations` to become account-aware, and breaking route planning was
explicitly out of bounds. Ownership rides alongside instead.

### 17.2 The consequence of that decision, stated plainly

Because the table is a device-level singleton, **on a shared device the arriving
account's cloud copy replaces the local row** (and takes ownership of it), and a
second account cannot create saved locations of its own on that device — it can
only receive its own from the cloud. This is the safe direction: no data is ever
uploaded into the wrong account, nothing is deleted, and planning keeps working
throughout. The limitation only exists on a genuinely shared device; on the
one-driver-one-device reality this app is built for, it is invisible.

A first account that edits saved locations and never syncs before handing the
device over could have those edits replaced by the second account's cloud copy.
Same assumption phase 0 already makes for routes.

### 17.3 Preference allowlist

`src/application/sync/account-preference-allowlist.ts` — two gates:

- **Allowed:** `last_route_end_kind`, `last_planning_mode`. Nothing else.
- **Never, whatever the list says:** `local_access_*` (offline PIN credential),
  `pwa_*` (installation diagnostics), plus `theme_preference`,
  `default_navigation_provider`, sync cursors — device-specific by product
  decision, not by accident.

Enforced in four places: the schema (`sync_scope` defaults to `'device'`), the
client push filter, the client pull filter, and the server's own independent
copy. A test asserts the client and server lists cannot drift apart.

### 17.4 Verification

`npm run typecheck`, `npm test` (**656/656**), `npm run gateway:test` (52/52),
`npm run pwa:test` (8/8 + clean bundle scan), `npm run validate:schema` (v17, 32
tables), `npm run pwa:build` — all green.

15 new tests cover: first upload, clean-device download, the full new-device
acceptance scenario including `ResolveRouteLocations` resolving a warehouse on
device B, two-device round trip, account isolation, account switch, allowlist
enforcement, security-preference exclusion (asserting the PIN hash never appears
in any payload), deletion propagation, offline then reconnect, repeated-sync
idempotency, legacy migration, and per-account cursors.

### 17.5 Remaining risks

- Not yet validated on two physical devices.
- The shared-device singleton behaviour in §17.2.
- `saved_locations` has no delete UI; `markSavedLocationDeletedForCloud` is
  tested but unwired, ready for whenever one appears.
- Account data rides in the same coordinator pass as routes, so a failing route
  sync surfaces as one combined status. Acceptable, but a per-channel status
  would be more precise if account sync ever grows.
