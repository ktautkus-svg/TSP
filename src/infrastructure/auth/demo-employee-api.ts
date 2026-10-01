import type { SQLiteDatabase } from 'expo-sqlite';

import { validateFuelAmount } from '@/domain/shared-validation';
import { EmployeeClientError } from '@/infrastructure/auth/employee-client-error';

let demoDatabase: SQLiteDatabase | null = null;

export function bindDemoDatabase(database: SQLiteDatabase | null): void {
  demoDatabase = database;
}

/**
 * The demo driver never calls the real employee server. Reads that a normal
 * driver makes are empty, administrative paths are refused, and a route-fuel
 * save stays inside the demo database.
 */
export async function handleDemoEmployeeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const pathname = path.split('?')[0] ?? path;
  if (
    pathname.startsWith('/api/admin')
    || pathname.startsWith('/api/dispatcher')
    || pathname.startsWith('/api/financial')
    || pathname.startsWith('/api/mail')
  ) {
    throw new EmployeeClientError('FORBIDDEN', 'Demonstracinė paskyra neturi šios teisės.', 403);
  }
  const fuelMatch = pathname.match(/^\/api\/routes\/([^/]+)\/fuel-entries$/);
  if (fuelMatch && method === 'POST') {
    await saveDemoFuel(decodeURIComponent(fuelMatch[1]), init.body);
    return { entry: { id: 'demo-fuel-saved' } } as T;
  }
  if (method === 'PUT' && /^\/api\/assignments\/[^/]+\/progress$/.test(pathname)) {
    return { assignment: null } as T;
  }
  if (method === 'GET' && (pathname === '/api/assignments' || pathname.startsWith('/api/assignments/'))) {
    return { assignments: [] } as T;
  }
  if (method === 'GET' && pathname.startsWith('/api/trip-sheets')) {
    return { tripSheets: [] } as T;
  }
  if (method === 'GET' && pathname === '/api/operations/contacts') {
    return { contacts: [] } as T;
  }
  if (method === 'GET' || method === 'POST' || method === 'PUT') return {} as T;
  throw new EmployeeClientError('FORBIDDEN', 'Demonstracinė paskyra neturi šios teisės.', 403);
}

async function saveDemoFuel(routeId: string, body: BodyInit | null | undefined): Promise<void> {
  const db = demoDatabase;
  if (!db) throw new EmployeeClientError('DEMO_DATABASE_UNAVAILABLE', 'Demonstracinė bazė neparuošta.', 500);
  const payload = parseFuelBody(body);
  const liters = validateFuelAmount(payload.liters);
  const filledAt = payload.filledAt;
  const odometer = typeof payload.odometer === 'number' && Number.isFinite(payload.odometer) ? payload.odometer : 0;
  const receipt = payload.receiptNumber?.trim() || null;
  const id = `demo-fuel-${routeId}-${filledAt}-${liters}-${odometer}-${receipt ?? ''}`;
  const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM fuel_entries WHERE id = ?', id);
  if (existing) return;
  const now = new Date().toISOString();
  const existingVehicle = await db.getFirstAsync<{ id: string }>('SELECT id FROM vehicles ORDER BY updated_at DESC LIMIT 1');
  const vehicleId = existingVehicle?.id ?? 'demo-vehicle';
  if (!existingVehicle) {
    await db.runAsync(
      `INSERT INTO vehicles (id, name, registration_number, fuel_type, created_at, updated_at)
       VALUES ('demo-vehicle', 'Demonstracinis automobilis', 'DEMO001', 'diesel', ?, ?)`,
      now,
      now,
    );
  }
  await db.runAsync(
    `INSERT INTO fuel_entries (
       id, vehicle_id, trip_sheet_id, filled_at, odometer, liters, price_per_liter,
       total_cost, full_tank, fuel_type, station, receipt_number, notes, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, 0, 'diesel', 'Demo degalinė', ?, NULL, ?)`,
    id,
    vehicleId,
    filledAt,
    odometer,
    liters,
    receipt,
    now,
  );
}

function parseFuelBody(body: BodyInit | null | undefined): { filledAt: string; liters: number; odometer?: number; receiptNumber?: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof body === 'string' ? body : '{}');
  } catch {
    throw new EmployeeClientError('INVALID_REQUEST', 'Trūksta lauko: filledAt.', 400);
  }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  if (typeof record.filledAt !== 'string' || !record.filledAt.trim()) {
    throw new EmployeeClientError('INVALID_REQUEST', 'Trūksta lauko: filledAt.', 400);
  }
  if (typeof record.liters !== 'number') {
    throw new EmployeeClientError('INVALID_REQUEST', 'Trūksta skaitinio lauko: liters.', 400);
  }
  return {
    filledAt: record.filledAt,
    liters: record.liters,
    odometer: typeof record.odometer === 'number' ? record.odometer : undefined,
    receiptNumber: typeof record.receiptNumber === 'string' ? record.receiptNumber : null,
  };
}
