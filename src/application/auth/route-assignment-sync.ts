import type { SQLiteDatabase } from 'expo-sqlite';

import { LocalAccessService } from '@/application/auth/local-access';
import { AdminCompleteRoute } from '@/application/routes/route-workday';
import {
  employeeApi,
  getEmployeeSession,
  type EmployeeProfile,
  type RouteSnapshot,
  type ServerRouteAssignment,
} from '@/infrastructure/auth/employee-session';

const SNAPSHOT_TABLES = ['routes', 'delivery_stops', 'shipment_lines'] as const;
type WritableTable = typeof SNAPSHOT_TABLES[number] | 'delivery_attempts';

// Local bookkeeping that must never travel inside a snapshot: it describes this
// device's relationship with the cloud, not the route. `vehicle_id` is stripped
// because vehicles do not sync yet, so the receiving device's own vehicle rows
// are the only valid ones (see applyRouteSnapshot for the merge rule that stops
// this null from erasing a local assignment).
const DEVICE_LOCAL_ROUTE_COLUMNS = {
  vehicle_id: null,
  cloud_synced_at: null,
  cloud_deleted_at: null,
  owner_employee_id: null,
} as const;

export async function exportRouteSnapshot(db: SQLiteDatabase, routeId: string): Promise<RouteSnapshot> {
  const route = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM routes WHERE id = ?', routeId);
  if (!route) throw new Error('Maršrutas nerastas.');
  const stops = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM delivery_stops WHERE route_id = ? ORDER BY COALESCE(active_order, optimized_order, original_order)',
    routeId,
  );
  const shipmentLines = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM shipment_lines WHERE route_id = ? ORDER BY created_at, id',
    routeId,
  );
  return {
    route: { ...route, ...DEVICE_LOCAL_ROUTE_COLUMNS },
    stops,
    shipmentLines,
  };
}

/**
 * Applies a snapshot pulled from another device onto the local route, without
 * deleting the local route row.
 *
 * The route row is updated in place rather than deleted and reinserted, because
 * a delete is not survivable: `trip_sheet_routes.route_id` is ON DELETE
 * RESTRICT, so a route that belongs to a trip sheet cannot be deleted at all
 * (the whole pull used to fail, permanently, once the device had generated a
 * trip sheet), and everything else hanging off `routes` — route_sync_state,
 * action_journal, route_order_snapshots, import_sources,
 * route_creation_commands — cascades away with it.
 *
 * Stops and shipment lines are still replaced wholesale, because the cloud copy
 * is authoritative for them. `delivery_attempts` hang off `delivery_stops` with
 * ON DELETE CASCADE and are not part of RouteSnapshot yet, so they are carried
 * across that replacement by hand instead of being destroyed by it.
 */
export async function applyRouteSnapshot(
  db: SQLiteDatabase,
  snapshot: RouteSnapshot,
  cloudSyncedAt: string,
  ownerEmployeeId: string | null = null,
): Promise<void> {
  validateSnapshot(snapshot);
  const routeId = String(snapshot.route.id ?? '');
  if (!routeId) throw new Error('Maršruto ID nenurodytas.');
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM routes WHERE id = ?', routeId);
    const attempts = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM delivery_attempts WHERE route_id = ?',
      routeId,
    );
    const route = {
      ...snapshot.route,
      id: routeId,
      // An incoming null vehicle means "this snapshot carries no vehicle
      // information", never "the route has no vehicle": exportRouteSnapshot
      // always strips it. Keeping the local value is what stops a sync round
      // trip from erasing the driver's own vehicle assignment.
      vehicle_id: snapshot.route.vehicle_id ?? existing?.vehicle_id ?? null,
      // Ownership is decided by the caller from the authenticated session, never
      // by whatever the sending device happened to have in its own column.
      owner_employee_id: ownerEmployeeId ?? existing?.owner_employee_id ?? null,
      cloud_synced_at: cloudSyncedAt,
      cloud_deleted_at: null,
    };
    if (existing) {
      await updateRow(db, 'routes', routeId, route);
    } else {
      await insertRow(db, 'routes', route);
    }
    await db.runAsync('DELETE FROM shipment_lines WHERE route_id = ?', routeId);
    await db.runAsync('DELETE FROM delivery_stops WHERE route_id = ?', routeId);
    for (const stop of snapshot.stops) await insertRow(db, SNAPSHOT_TABLES[1], stop);
    for (const line of snapshot.shipmentLines) await insertRow(db, SNAPSHOT_TABLES[2], line);
    const restoredStops = new Set(snapshot.stops.map((stop) => String(stop.id ?? '')));
    for (const attempt of attempts) {
      if (restoredStops.has(String(attempt.stop_id ?? ''))) await insertRow(db, 'delivery_attempts', attempt);
    }
  });
}

export async function pullAssignedRoutes(db: SQLiteDatabase, profile: EmployeeProfile): Promise<{ imported: number; skipped: number }> {
  if (profile.role !== 'driver') return { imported: 0, skipped: 0 };
  const response = await employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/assignments');
  return reconcileAndImportAssignments(db, profile.id, response.assignments, (assignmentId) =>
    employeeApi<void>(`/api/assignments/${encodeURIComponent(assignmentId)}/downloaded`, { method: 'POST' }));
}

/**
 * Same pull as pullAssignedRoutes, for an admin/dispatcher device switched
 * into "driving as" a chosen driver (LocalAccessService.getActingDriver).
 * /api/assignments is driver-role-only, so this sources from
 * /api/admin/assignments (which admin/dispatcher can call) and filters to
 * the acting driver — without this, a route created or assigned from a
 * different device (e.g. the dispatcher desktop screen) never reaches this
 * device's local copy, and the "driving as" dashboard keeps showing whatever
 * route was already there locally.
 */
export async function pullAssignedRoutesForActingDriver(db: SQLiteDatabase, driverId: string): Promise<{ imported: number; skipped: number }> {
  const response = await employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments');
  const assignments = response.assignments.filter((assignment) => assignment.driverId === driverId);
  // /api/assignments/:id/downloaded is driver-role-only too; skipping it only
  // leaves the assignment's status at "assigned" instead of advancing to
  // "downloaded" for dispatcher visibility — cosmetic, not functional.
  return reconcileAndImportAssignments(db, driverId, assignments, async () => undefined);
}

// Completed assignments must also be applied here, not just cancelled ones
// skipped. Otherwise a second tab/device can keep an old in_progress copy
// forever even though the server already holds the final route and all
// delivery results.
async function reconcileAndImportAssignments(
  db: SQLiteDatabase,
  employeeId: string,
  assignments: readonly ServerRouteAssignment[],
  markDownloaded: (assignmentId: string) => Promise<void>,
): Promise<{ imported: number; skipped: number }> {
  await reconcileAssignedRouteCopies(db, employeeId, assignments);
  let imported = 0;
  let skipped = 0;
  for (const assignment of assignments.filter((item) => item.status !== 'cancelled')) {
    const existingSync = await db.getFirstAsync<{ route_id: string; server_revision: string | null }>(
      'SELECT route_id, server_revision FROM route_sync_state WHERE assignment_id = ?', assignment.id,
    );
    if (existingSync) {
      const local = await db.getFirstAsync<{ updated_at: string }>('SELECT updated_at FROM routes WHERE id = ?', existingSync.route_id);
      const incomingUpdatedAt = String(assignment.routeSnapshot.route.updated_at ?? '');
      if (assignment.updatedAt > String(existingSync.server_revision ?? '') && (!local || incomingUpdatedAt > local.updated_at)) {
        await applyRouteSnapshot(db, assignment.routeSnapshot, assignment.updatedAt, employeeId);
      }
      await db.runAsync(
        `UPDATE route_sync_state SET server_revision = ?, last_synced_at = ?, updated_at = ?
         WHERE assignment_id = ?`,
        assignment.updatedAt, new Date().toISOString(), new Date().toISOString(), assignment.id,
      );
      skipped += 1;
      continue;
    }
    await importAssignmentSnapshot(db, assignment, employeeId);
    await markDownloaded(assignment.id);
    imported += 1;
  }
  return { imported, skipped };
}

/**
 * A route worked without ever going through the dispatcher-assignment flow
 * (the same person creating and driving it, e.g. an admin/owner) has no
 * route_sync_state row and so never reaches the server — which made it
 * invisible in quality-control, not just unsynced. Self-assigning it (only
 * possible for admin/dispatcher, since /api/admin/assignments requires that
 * role) gives it the same server-side assignment record a dispatcher-pushed
 * route already has, before anything else here needs it to exist.
 *
 * An admin/dispatcher who has switched this device into "acting as driver X"
 * mode (LocalAccessService.getActingDriver) self-assigns to that driver
 * instead of their own account, so the route is attributed and visible in
 * quality-control under the driver actually being represented, without
 * logging out of the admin session.
 */
async function ensureSelfAssignment(db: SQLiteDatabase, routeId: string): Promise<boolean> {
  const session = await getEmployeeSession();
  const profile = session?.profile;
  if (!profile || (profile.role !== 'admin' && profile.role !== 'dispatcher')) return false;
  const actingDriver = await new LocalAccessService(db).getActingDriver();
  const driverId = actingDriver?.id ?? profile.id;
  try {
    const routeSnapshot = await exportRouteSnapshot(db, routeId);
    const response = await employeeApi<{ assignment: ServerRouteAssignment }>('/api/admin/assignments', {
      method: 'POST',
      body: JSON.stringify({ driverId, routeSnapshot }),
    });
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO route_sync_state
       (assignment_id, route_id, employee_id, server_revision, sync_status, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'synced', ?, ?, ?)
       ON CONFLICT(assignment_id) DO NOTHING`,
      response.assignment.id, routeId, driverId, response.assignment.updatedAt, now, now, now,
    );
    await db.runAsync('UPDATE routes SET owner_employee_id = COALESCE(owner_employee_id, ?) WHERE id = ?', driverId, routeId);
    return true;
  } catch {
    return false;
  }
}

export async function pushRouteAssignmentProgress(db: SQLiteDatabase, routeId: string): Promise<boolean> {
  let sync = await db.getFirstAsync<{ assignment_id: string }>(
    'SELECT assignment_id FROM route_sync_state WHERE route_id = ?', routeId,
  );
  if (!sync) {
    if (!await ensureSelfAssignment(db, routeId)) return false;
    sync = await db.getFirstAsync<{ assignment_id: string }>(
      'SELECT assignment_id FROM route_sync_state WHERE route_id = ?', routeId,
    );
    if (!sync) return false;
  }
  const routeSnapshot = await exportRouteSnapshot(db, routeId);
  await employeeApi(`/api/assignments/${encodeURIComponent(sync.assignment_id)}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ routeSnapshot }),
  });
  await db.runAsync(
    `UPDATE route_sync_state
     SET sync_status = 'synced', last_synced_at = ?, updated_at = ?
     WHERE assignment_id = ?`,
    new Date().toISOString(), new Date().toISOString(), sync.assignment_id,
  );
  return true;
}

/** Publishes a newly selected route sequence to an existing driver assignment. */
export async function pushRouteAssignmentRevision(
  db: SQLiteDatabase,
  routeId: string,
  canInspectAdminAssignments = false,
): Promise<boolean> {
  if (await pushRouteAssignmentProgress(db, routeId)) return true;
  if (!canInspectAdminAssignments) return false;
  const response = await employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments');
  const assignment = response.assignments.find((item) =>
    item.routeId === routeId && !['completed', 'cancelled'].includes(item.status),
  );
  if (!assignment) return false;
  const routeSnapshot = await exportRouteSnapshot(db, routeId);
  await employeeApi(`/api/assignments/${encodeURIComponent(assignment.id)}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ routeSnapshot }),
  });
  return true;
}

export async function reconcileAssignedRouteCopies(
  db: SQLiteDatabase,
  employeeId: string,
  assignments: readonly ServerRouteAssignment[],
): Promise<number> {
  const serverById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const local = await db.getAllAsync<{ assignment_id: string; route_id: string }>(
    'SELECT assignment_id, route_id FROM route_sync_state WHERE employee_id = ?',
    employeeId,
  );
  let removed = 0;
  for (const copy of local) {
    const assignment = serverById.get(copy.assignment_id);
    if (assignment?.status === 'completed') continue;
    if (assignment && assignment.status !== 'cancelled') continue;
    await purgeAssignedRouteCopy(db, copy.route_id);
    removed += 1;
  }
  return removed;
}

async function purgeAssignedRouteCopy(db: SQLiteDatabase, routeId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM trip_sheet_routes WHERE route_id = ?', routeId);
    await db.runAsync('DELETE FROM routes WHERE id = ?', routeId);
  });
}

export async function pushCompletedRouteAssignmentProgress(db: SQLiteDatabase): Promise<number> {
  const routes = await db.getAllAsync<{ route_id: string }>(
    `SELECT route_sync_state.route_id
     FROM route_sync_state
     JOIN routes ON routes.id = route_sync_state.route_id
     WHERE routes.status = 'completed'
     ORDER BY routes.completed_at, routes.id`,
  );
  let synced = 0;
  for (const route of routes) {
    if (await pushRouteAssignmentProgress(db, route.route_id)) synced += 1;
  }
  return synced;
}

/**
 * Closes a hanging assignment from the dispatcher/admin device. Local copies
 * are completed first so this device's SQLite matches the server snapshot.
 */
export async function completeAssignedRoute(
  db: SQLiteDatabase,
  assignment: ServerRouteAssignment,
  localRouteId: string | null,
): Promise<void> {
  if (localRouteId) {
    await new AdminCompleteRoute(db).execute(localRouteId);
    try {
      if (await pushRouteAssignmentRevision(db, localRouteId, true)) return;
    } catch {
      // Fall through to the explicit complete endpoint so a progress push
      // failure cannot leave the assignment hanging on the server.
    }
  }
  await employeeApi(`/api/admin/assignments/${encodeURIComponent(assignment.id)}/complete`, { method: 'POST' });
}

export async function assignRouteToDriver(db: SQLiteDatabase, routeId: string, driverId: string, vehicleId?: string): Promise<ServerRouteAssignment> {
  const routeSnapshot = await exportRouteSnapshot(db, routeId);
  const response = await employeeApi<{ assignment: ServerRouteAssignment }>('/api/admin/assignments', {
    method: 'POST',
    body: JSON.stringify({ driverId, vehicleId, routeSnapshot }),
  });
  // The shared cloud copy is transferred to the assigned driver by the
  // server. Mirror that ownership locally so this administrator device does
  // not keep retrying a now-foreign stale copy before it can pull progress.
  await db.runAsync(
    'UPDATE routes SET owner_employee_id = ?, cloud_synced_at = updated_at WHERE id = ?',
    driverId,
    routeId,
  );
  return response.assignment;
}

export async function importAssignmentSnapshot(db: SQLiteDatabase, assignment: ServerRouteAssignment, employeeId: string): Promise<void> {
  validateSnapshot(assignment.routeSnapshot);
  const existingRoute = await db.getFirstAsync<{ id: string }>('SELECT id FROM routes WHERE id = ?', assignment.routeId);
  if (existingRoute) {
    await applyRouteSnapshot(db, assignment.routeSnapshot, assignment.updatedAt, employeeId);
  }
  await db.withTransactionAsync(async () => {
    if (!existingRoute) {
      await insertRow(db, SNAPSHOT_TABLES[0], {
        ...assignment.routeSnapshot.route,
        owner_employee_id: employeeId,
      });
      for (const stop of assignment.routeSnapshot.stops) await insertRow(db, SNAPSHOT_TABLES[1], stop);
      for (const line of assignment.routeSnapshot.shipmentLines) await insertRow(db, SNAPSHOT_TABLES[2], line);
    }
    await db.runAsync(
      'UPDATE routes SET owner_employee_id = COALESCE(owner_employee_id, ?) WHERE id = ?',
      employeeId,
      assignment.routeId,
    );
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO route_sync_state
       (assignment_id, route_id, employee_id, server_revision, sync_status, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'synced', ?, ?, ?)
       ON CONFLICT(assignment_id) DO UPDATE SET
         server_revision = excluded.server_revision,
         sync_status = 'synced',
         last_synced_at = excluded.last_synced_at,
         updated_at = excluded.updated_at`,
      assignment.id, assignment.routeId, employeeId, assignment.updatedAt, now, now, now,
    );
  });
}

export async function insertRow(db: SQLiteDatabase, table: WritableTable, row: Record<string, unknown>): Promise<void> {
  const columns = assertColumns(table, Object.keys(row));
  const placeholders = columns.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    ...columns.map((column) => row[column] as string | number | null),
  );
}

async function updateRow(db: SQLiteDatabase, table: WritableTable, id: string, row: Record<string, unknown>): Promise<void> {
  const columns = assertColumns(table, Object.keys(row).filter((column) => column !== 'id'));
  await db.runAsync(
    `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
    ...columns.map((column) => row[column] as string | number | null),
    id,
  );
}

function assertColumns(table: WritableTable, columns: string[]): string[] {
  if (columns.length === 0) throw new Error(`Tuščias ${table} įrašas.`);
  if (columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error('Neleistinas duomenų laukas.');
  return columns;
}

function validateSnapshot(snapshot: RouteSnapshot): void {
  if (!snapshot.route || !Array.isArray(snapshot.stops) || snapshot.stops.length === 0 || !Array.isArray(snapshot.shipmentLines)) {
    throw new Error('Serverio maršruto kopija nepilna.');
  }
}
