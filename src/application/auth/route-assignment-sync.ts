import type { SQLiteDatabase } from 'expo-sqlite';

import {
  employeeApi,
  type EmployeeProfile,
  type RouteSnapshot,
  type ServerRouteAssignment,
} from '@/infrastructure/auth/employee-session';

const SNAPSHOT_TABLES = ['routes', 'delivery_stops', 'shipment_lines'] as const;

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
  return { route: { ...route, vehicle_id: null }, stops, shipmentLines };
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

async function insertRow(db: SQLiteDatabase, table: typeof SNAPSHOT_TABLES[number], row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row);
  if (columns.length === 0) throw new Error(`Tuščias ${table} įrašas.`);
  if (columns.some((column) => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error('Neleistinas duomenų laukas.');
  const placeholders = columns.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    ...columns.map((column) => row[column] as string | number | null),
  );
}

function validateSnapshot(snapshot: RouteSnapshot): void {
  if (!snapshot.route || !Array.isArray(snapshot.stops) || snapshot.stops.length === 0 || !Array.isArray(snapshot.shipmentLines)) {
    throw new Error('Serverio maršruto kopija nepilna.');
  }
}
