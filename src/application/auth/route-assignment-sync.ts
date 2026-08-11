import type { SQLiteDatabase } from 'expo-sqlite';

import {
  employeeApi,
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
  let imported = 0;
  let skipped = 0;
  for (const assignment of response.assignments.filter((item) => !['completed', 'cancelled'].includes(item.status))) {
    const existingSync = await db.getFirstAsync<{ route_id: string }>(
      'SELECT route_id FROM route_sync_state WHERE assignment_id = ?', assignment.id,
    );
    if (existingSync) {
      skipped += 1;
      continue;
    }
    const active = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM routes WHERE status NOT IN ('completed','cancelled') LIMIT 1",
    );
    if (active && active.id !== assignment.routeId) {
      skipped += 1;
      continue;
    }
    await importAssignmentSnapshot(db, assignment, profile.id);
    await employeeApi<void>(`/api/assignments/${encodeURIComponent(assignment.id)}/downloaded`, { method: 'POST' });
    imported += 1;
  }
  return { imported, skipped };
}

export async function pushRouteAssignmentProgress(db: SQLiteDatabase, routeId: string): Promise<boolean> {
  const sync = await db.getFirstAsync<{ assignment_id: string }>(
    'SELECT assignment_id FROM route_sync_state WHERE route_id = ?', routeId,
  );
  if (!sync) return false;
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

export async function assignRouteToDriver(db: SQLiteDatabase, routeId: string, driverId: string): Promise<ServerRouteAssignment> {
  const routeSnapshot = await exportRouteSnapshot(db, routeId);
  const response = await employeeApi<{ assignment: ServerRouteAssignment }>('/api/admin/assignments', {
    method: 'POST',
    body: JSON.stringify({ driverId, routeSnapshot }),
  });
  return response.assignment;
}

export async function importAssignmentSnapshot(db: SQLiteDatabase, assignment: ServerRouteAssignment, employeeId: string): Promise<void> {
  validateSnapshot(assignment.routeSnapshot);
  await db.withTransactionAsync(async () => {
    const existingRoute = await db.getFirstAsync<{ id: string }>('SELECT id FROM routes WHERE id = ?', assignment.routeId);
    if (!existingRoute) {
      await insertRow(db, SNAPSHOT_TABLES[0], assignment.routeSnapshot.route);
      for (const stop of assignment.routeSnapshot.stops) await insertRow(db, SNAPSHOT_TABLES[1], stop);
      for (const line of assignment.routeSnapshot.shipmentLines) await insertRow(db, SNAPSHOT_TABLES[2], line);
    }
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
