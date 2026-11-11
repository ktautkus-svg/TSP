import type { SQLiteDatabase } from 'expo-sqlite';

type Row = Record<string, unknown>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Route columns that describe progress/outcome of one particular day. A copy
// starts again from "planned" with nothing loaded, delivered or recorded.
const ROUTE_RESET_COLUMNS = [
  'actual_distance_km', 'start_odometer', 'end_odometer', 'started_at', 'completed_at', 'cancelled_at',
  'start_odometer_recorded_at', 'start_odometer_skipped_at', 'end_odometer_recorded_at',
  'completion_summary_json', 'completion_started_at', 'completion_end_odometer_draft',
  'return_destination_kind', 'return_started_at', 'return_arrived_at',
  'cloud_synced_at', 'cloud_deleted_at',
];

const STOP_RESET_COLUMNS = [
  'failure_comment', 'failure_reason', 'loaded_at', 'delivered_at', 'failed_at',
  'planned_arrival_at', 'planned_departure_at', 'latest_estimated_arrival_at',
  'eta_updated_at',
];

async function insertRow(db: SQLiteDatabase, table: string, row: Row): Promise<void> {
  const columns = Object.keys(row);
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`,
    ...columns.map((column) => row[column] as never),
  );
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Copies a route (with its stops, their current order and shipment lines) to a
 * new date. The copy keeps the manual stop order but starts fresh: planned,
 * nothing loaded or delivered, no odometer, not assigned. The original route is
 * never changed. Returns the id of the new route.
 */
export async function duplicateRouteToDate(db: SQLiteDatabase, routeId: string, date: string): Promise<string> {
  if (!DATE_PATTERN.test(date)) throw new Error('Nurodykite datą formatu MMMM-MM-DD.');
  const source = await db.getFirstAsync<Row>('SELECT * FROM routes WHERE id = ?', routeId);
  if (!source) throw new Error('Maršrutas nerastas.');
  const stops = await db.getAllAsync<Row>(
    'SELECT * FROM delivery_stops WHERE route_id = ? ORDER BY original_order',
    routeId,
  );
  if (stops.length === 0) throw new Error('Maršrute nėra taškų, kopijuoti nėra ko.');
  const lines = await db.getAllAsync<Row>('SELECT * FROM shipment_lines WHERE route_id = ?', routeId);
  const stopIds = stops.map((stop) => String(stop.id));
  const constraints = await db.getAllAsync<Row>(
    `SELECT * FROM route_stop_constraints WHERE delivery_stop_id IN (${stopIds.map(() => '?').join(', ')})`,
    ...stopIds,
  );

  const now = new Date().toISOString();
  const newRouteId = newId();
  const stopIdMap = new Map<string, string>(stopIds.map((id) => [id, newId()]));
  const totalWeight = Number(source.total_weight_kg ?? 0);
  const totalStops = Number(source.total_stops ?? stops.length);
  const unknownWeight = Number(source.unknown_weight_stops ?? 0);

  await db.withTransactionAsync(async () => {
    const route: Row = { ...source, id: newRouteId, date, status: 'planned', created_at: now, updated_at: now };
    for (const column of ROUTE_RESET_COLUMNS) if (column in route) route[column] = null;
    route.remaining_weight_kg = totalWeight;
    route.remaining_stops = totalStops;
    route.remaining_unknown_weight_stops = unknownWeight;
    await insertRow(db, 'routes', route);

    for (const stop of stops) {
      const copy: Row = {
        ...stop,
        id: stopIdMap.get(String(stop.id)),
        route_id: newRouteId,
        loading_status: 'pending',
        delivery_status: 'pending',
        created_at: now,
        updated_at: now,
      };
      for (const column of STOP_RESET_COLUMNS) if (column in copy) copy[column] = null;
      await insertRow(db, 'delivery_stops', copy);
    }

    for (const line of lines) {
      await insertRow(db, 'shipment_lines', {
        ...line,
        id: newId(),
        route_id: newRouteId,
        delivery_stop_id: stopIdMap.get(String(line.delivery_stop_id)) ?? line.delivery_stop_id,
        created_at: now,
      });
    }

    for (const constraint of constraints) {
      await insertRow(db, 'route_stop_constraints', {
        ...constraint,
        id: newId(),
        delivery_stop_id: stopIdMap.get(String(constraint.delivery_stop_id)) ?? constraint.delivery_stop_id,
        related_stop_id: constraint.related_stop_id
          ? stopIdMap.get(String(constraint.related_stop_id)) ?? null
          : null,
        created_at: now,
      });
    }
  });

  return newRouteId;
}
