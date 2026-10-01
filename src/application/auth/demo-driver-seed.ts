import type { SQLiteDatabase } from 'expo-sqlite';

import { OperationalContactRepository } from '@/database/repositories/operational-contact-repository';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import {
  CreateDraftRoute,
  ReplaceDraftStops,
  type DraftStopInput,
} from '@/application/routes/route-commands';
import {
  CompleteRoute,
  ConfirmRouteReturnArrival,
  MarkStopDelivered,
  MarkStopLoaded,
  SaveStartOdometer,
  StartRoute,
  StartRouteReturn,
} from '@/application/routes/route-workday';
import {
  DEMO_DATABASE_MARKER,
  DEMO_DRIVER_ID,
} from '@/domain/demo-driver';
import type { RouteEndpoint } from '@/domain/route';

const LOADING_ROUTE_ID = 'demo-route-loading';
const ACTIVE_ROUTE_ID = 'demo-route-active';
const DONE_ROUTE_ID = 'demo-route-done';

const warehouse: RouteEndpoint = {
  originalAddress: 'Demonstracinis sandėlis, Pramonės g. 8, Šiauliai',
  geocodingQuery: 'Pramonės g. 8, Šiauliai',
  normalizedAddress: 'Pramonės g. 8, Šiauliai, Lietuva',
  latitude: 55.934,
  longitude: 23.314,
};

export async function markDemoDatabase(db: SQLiteDatabase, now = new Date().toISOString()): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_preferences (key, value, updated_at) VALUES ('database_role', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    DEMO_DATABASE_MARKER,
    now,
  );
}

export async function seedDemoDriverDatabase(db: SQLiteDatabase, now = new Date()): Promise<void> {
  await assertDemoDatabase(db);
  const ready = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM routes WHERE id IN (?, ?, ?)`,
    LOADING_ROUTE_ID,
    ACTIVE_ROUTE_ID,
    DONE_ROUTE_ID,
  );
  if ((ready?.count ?? 0) === 3) return;
  await db.execAsync('DROP INDEX IF EXISTS one_working_route');
  const today = localDate(now, 0);
  const yesterday = localDate(now, -1);
  await createRoute(db, LOADING_ROUTE_ID, [
    stop('demo-load-1', 1, 'U-2401', 'UAB Šiaurės lenta', 'Vilniaus g. 12, Šiauliai', 420, '08:00', '12:00', '+37061230011'),
    stop('demo-load-2', 2, 'U-2402', 'Kavinė Pakalnė', 'Tilžės g. 44, Šiauliai', 85.5, '10:00', '14:00', '+37061230012'),
  ]);
  await db.runAsync(
    `UPDATE routes SET status = 'loading', date = ?, estimated_distance_km = 46, owner_employee_id = ? WHERE id = ?`,
    today,
    DEMO_DRIVER_ID,
    LOADING_ROUTE_ID,
  );

  const activeStops = await createRoute(db, ACTIVE_ROUTE_ID, [
    stop('demo-active-1', 1, 'U-2410', 'Maxima Bazė', 'Aido g. 8, Šiauliai', 310, '09:00', '13:00', '+37061230021'),
    stop('demo-active-2', 2, 'U-2411', 'Vaistinė Gintaras', 'Varpo g. 19, Šiauliai', 24, '11:00', '15:00', '+37061230022'),
  ]);
  await db.runAsync(`UPDATE routes SET status = 'loading', estimated_distance_km = 38, date = ? WHERE id = ?`, today, ACTIVE_ROUTE_ID);
  await new MarkStopLoaded(db).execute(ACTIVE_ROUTE_ID, activeStops[0]);
  await new MarkStopLoaded(db).execute(ACTIVE_ROUTE_ID, activeStops[1]);
  await new SaveStartOdometer(db).execute(ACTIVE_ROUTE_ID, 182340);
  await new StartRoute(db).execute(ACTIVE_ROUTE_ID);
  await new MarkStopDelivered(db).execute(ACTIVE_ROUTE_ID, activeStops[0]);
  await db.runAsync(`UPDATE routes SET owner_employee_id = ?, date = ? WHERE id = ?`, DEMO_DRIVER_ID, today, ACTIVE_ROUTE_ID);

  const doneStops = await createRoute(db, DONE_ROUTE_ID, [
    stop('demo-done-1', 1, 'U-2308', 'Mokykla Ringuvos', 'Dvaro g. 64, Šiauliai', 560, '08:30', '11:30', '+37061230031'),
    stop('demo-done-2', 2, 'U-2309', 'Kepykla Duona', 'Aušros al. 25, Šiauliai', 140, '12:00', '16:00', '+37061230032'),
  ]);
  await db.runAsync(`UPDATE routes SET status = 'loading', estimated_distance_km = 52, date = ? WHERE id = ?`, yesterday, DONE_ROUTE_ID);
  await new MarkStopLoaded(db).execute(DONE_ROUTE_ID, doneStops[0]);
  await new MarkStopLoaded(db).execute(DONE_ROUTE_ID, doneStops[1]);
  await new SaveStartOdometer(db).execute(DONE_ROUTE_ID, 181900);
  await new StartRoute(db).execute(DONE_ROUTE_ID);
  await new MarkStopDelivered(db).execute(DONE_ROUTE_ID, doneStops[0]);
  await new MarkStopDelivered(db).execute(DONE_ROUTE_ID, doneStops[1]);
  await new StartRouteReturn(db).execute(DONE_ROUTE_ID, 'warehouse', warehouse);
  await new ConfirmRouteReturnArrival(db).execute(DONE_ROUTE_ID);
  // Finish time is yesterday afternoon, so the stored start must be earlier the same day.
  await db.runAsync(`UPDATE routes SET started_at = ? WHERE id = ?`, `${yesterday}T06:00:00.000Z`, DONE_ROUTE_ID);
  await new CompleteRoute(db).execute(DONE_ROUTE_ID, {
    endOdometer: 181948,
    actualFinishedAt: `${yesterday}T15:40:00.000Z`,
  });
  await db.runAsync(
    `UPDATE routes SET owner_employee_id = ?, date = ? WHERE id = ?`,
    DEMO_DRIVER_ID,
    yesterday,
    DONE_ROUTE_ID,
  );
  const sheet = await new TripSheetRepository(db).syncCompletedDate(yesterday);
  await new TripSheetRepository(db).saveFuelEntry({
    tripSheetId: sheet.id,
    filledAt: `${yesterday}T07:10:00.000Z`,
    odometer: 181880,
    liters: 46.5,
    pricePerLiter: 1.49,
    station: 'Demo degalinė',
    receiptNumber: 'DEMO-1001',
    notes: 'Demonstracinis pylimas',
  });
  await db.runAsync(
    `UPDATE vehicles SET name = 'Demonstracinis automobilis', registration_number = 'DEMO001' WHERE id = ?`,
    sheet.vehicleId,
  );

  const contacts = new OperationalContactRepository(db);
  await contacts.save({
    id: 'demo-contact-dispatcher',
    kind: 'dispatcher',
    name: 'Demo dispečerė Ieva',
    roleLabel: 'Dispečeris',
    phone: '+37061230001',
    isEmergency: true,
    sortOrder: 1,
  });
  await contacts.save({
    id: 'demo-contact-warehouse',
    kind: 'warehouse',
    name: 'Demo sandėlis',
    roleLabel: 'Sandėlis',
    phone: '+37061230002',
    isEmergency: false,
    sortOrder: 2,
  });
}

export async function resetDemoDriverDatabase(db: SQLiteDatabase, now = new Date()): Promise<void> {
  await assertDemoDatabase(db);
  await db.execAsync(`
    DELETE FROM fuel_entries;
    DELETE FROM trip_sheet_routes;
    DELETE FROM trip_sheets;
    DELETE FROM delivery_attempts;
    DELETE FROM shipment_lines;
    DELETE FROM delivery_stops;
    DELETE FROM action_journal;
    DELETE FROM route_order_snapshots;
    DELETE FROM import_sources;
    DELETE FROM routes;
    DELETE FROM operational_contacts WHERE id LIKE 'demo-contact-%';
  `);
  await seedDemoDriverDatabase(db, now);
}

async function assertDemoDatabase(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM app_preferences WHERE key = 'database_role'`);
  if (row?.value !== DEMO_DATABASE_MARKER) {
    throw new Error('Demonstracinius duomenis galima kurti tik atskiroje demonstracinėje bazėje.');
  }
}

async function createRoute(db: SQLiteDatabase, routeId: string, stops: DraftStopInput[]): Promise<string[]> {
  await new CreateDraftRoute(db).execute({ id: routeId, startLocation: warehouse, endLocation: warehouse });
  let sequence = 0;
  const created = await new ReplaceDraftStops(
    db,
    undefined,
    (prefix) => `${prefix}-${routeId}-${++sequence}`,
  ).execute(routeId, stops);
  return created.stopIds;
}

function stop(
  id: string,
  order: number,
  orderNumber: string,
  recipient: string,
  address: string,
  weightKg: number,
  from: string,
  to: string,
  phone: string,
): DraftStopInput {
  return {
    id,
    originalOrder: order,
    orderNumber,
    recipient,
    originalAddress: address,
    geocodingQuery: address,
    normalizedAddress: `${address}, Lietuva`,
    addressValidationState: 'auto_confirmed',
    latitude: 55.93 + order / 100,
    longitude: 23.31 + order / 100,
    deliveryTimeFrom: from,
    deliveryTimeTo: to,
    requiredTimeWindow: true,
    weightKg,
    phone,
    notes: 'Demonstracinis užsakymas',
  };
}

function localDate(now: Date, offsetDays: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
