import type { SQLiteDatabase } from 'expo-sqlite';

import type { FuelEntry, FuelType, SavedLocation, TripSheet, Vehicle } from '@/domain/vehicle-and-trip';

type VehicleRow = {
  id: string;
  name: string;
  registration_number: string;
  fuel_type: FuelType;
  base_fuel_norm_l_per_100_km: number | null;
  length_m: number | null;
  width_m: number | null;
  height_m: number | null;
  empty_weight_kg: number | null;
  maximum_payload_kg: number | null;
  maximum_gross_weight_kg: number | null;
  home_location_json: string | null;
  warehouse_location_json: string | null;
  created_at: string;
  updated_at: string;
};

type TripSheetRow = {
  id: string;
  date: string;
  vehicle_id: string;
  start_location_json: string;
  end_location_json: string;
  start_odometer: number | null;
  end_odometer: number | null;
  actual_distance_km: number | null;
  planned_distance_km: number | null;
  planned_start_at: string | null;
  actual_start_at: string | null;
  planned_end_at: string | null;
  actual_end_at: string | null;
  planned_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  schedule_performance_percent: number | null;
  productive_time_percent: number | null;
  total_delivered_weight_kg: number;
  total_stops: number;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
};

type CompletedRouteRow = {
  id: string;
  date: string;
  estimated_distance_km: number | null;
  actual_distance_km: number | null;
  estimated_duration_minutes: number | null;
  start_odometer: number | null;
  end_odometer: number | null;
  planned_departure_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  start_location_json: string | null;
  end_location_json: string | null;
};

type FuelEntryRow = {
  id: string;
  vehicle_id: string;
  trip_sheet_id: string | null;
  filled_at: string;
  odometer: number;
  liters: number;
  price_per_liter: number | null;
  total_cost: number | null;
  full_tank: number;
  fuel_type: FuelType;
  station: string | null;
  notes: string | null;
  created_at: string;
};

export type TripSheetWithRoutes = TripSheet & { routeIds: string[]; vehicleName: string };

function parseLocation(value: string | null, fallbackLabel: string): SavedLocation {
  if (!value) return { label: fallbackLabel, address: null, latitude: null, longitude: null };
  try {
    const parsed = JSON.parse(value) as {
      label?: string;
      originalAddress?: string;
      normalizedAddress?: string | null;
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    };
    return {
      label: parsed.label ?? fallbackLabel,
      address: parsed.normalizedAddress ?? parsed.originalAddress ?? parsed.address ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
    };
  } catch {
    return { label: fallbackLabel, address: null, latitude: null, longitude: null };
  }
}

function parseSavedLocation(value: string | null): SavedLocation | null {
  if (!value) return null;
  try { return JSON.parse(value) as SavedLocation; } catch { return null; }
}

function mapVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    name: row.name,
    registrationNumber: row.registration_number,
    fuelType: row.fuel_type,
    baseFuelNormLPer100Km: row.base_fuel_norm_l_per_100_km,
    lengthM: row.length_m,
    widthM: row.width_m,
    heightM: row.height_m,
    emptyWeightKg: row.empty_weight_kg,
    maximumPayloadKg: row.maximum_payload_kg,
    maximumGrossWeightKg: row.maximum_gross_weight_kg,
    homeLocation: parseSavedLocation(row.home_location_json),
    warehouseLocation: parseSavedLocation(row.warehouse_location_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTripSheet(row: TripSheetRow): TripSheet {
  return {
    id: row.id,
    date: row.date,
    vehicleId: row.vehicle_id,
    startLocation: parseLocation(row.start_location_json, 'Pradžia'),
    endLocation: parseLocation(row.end_location_json, 'Pabaiga'),
    startOdometer: row.start_odometer,
    endOdometer: row.end_odometer,
    actualDistanceKm: row.actual_distance_km,
    plannedDistanceKm: row.planned_distance_km,
    plannedStartAt: row.planned_start_at,
    actualStartAt: row.actual_start_at,
    plannedEndAt: row.planned_end_at,
    actualEndAt: row.actual_end_at,
    plannedDurationMinutes: row.planned_duration_minutes,
    actualDurationMinutes: row.actual_duration_minutes,
    schedulePerformancePercent: row.schedule_performance_percent,
    productiveTimePercent: row.productive_time_percent,
    totalDeliveredWeightKg: row.total_delivered_weight_kg,
    totalStops: row.total_stops,
    notes: row.notes,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapFuelEntry(row: FuelEntryRow): FuelEntry {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    tripSheetId: row.trip_sheet_id,
    filledAt: row.filled_at,
    odometer: row.odometer,
    liters: row.liters,
    pricePerLiter: row.price_per_liter,
    totalCost: row.total_cost,
    fullTank: row.full_tank === 1,
    fuelType: row.fuel_type,
    station: row.station,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function optionalSum(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

export class TripSheetRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getVehicle(): Promise<Vehicle | null> {
    const row = await this.db.getFirstAsync<VehicleRow>('SELECT * FROM vehicles ORDER BY updated_at DESC, id LIMIT 1');
    return row ? mapVehicle(row) : null;
  }

  async saveVehicle(input: { name: string; registrationNumber: string; fuelType: FuelType }, now = new Date().toISOString()): Promise<Vehicle> {
    const existing = await this.getVehicle();
    const id = existing?.id ?? 'vehicle-primary';
    await this.db.runAsync(
      `INSERT INTO vehicles (id, name, registration_number, fuel_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         registration_number = excluded.registration_number,
         fuel_type = excluded.fuel_type,
         updated_at = excluded.updated_at`,
      id,
      input.name.trim() || 'Darbinis automobilis',
      input.registrationNumber.trim().toUpperCase() || 'NENURODYTA',
      input.fuelType,
      existing?.createdAt ?? now,
      now,
    );
    return (await this.getVehicle())!;
  }

  async ensureVehicle(now = new Date().toISOString()): Promise<Vehicle> {
    return await this.getVehicle() ?? this.saveVehicle({
      name: 'Darbinis automobilis',
      registrationNumber: 'NENURODYTA',
      fuelType: 'diesel',
    }, now);
  }

  async list(): Promise<TripSheetWithRoutes[]> {
    const rows = await this.db.getAllAsync<TripSheetRow & { vehicle_name: string }>(
      `SELECT trip_sheets.*, vehicles.name AS vehicle_name
       FROM trip_sheets
       JOIN vehicles ON vehicles.id = trip_sheets.vehicle_id
       ORDER BY trip_sheets.date DESC, trip_sheets.created_at DESC`,
    );
    if (rows.length === 0) return [];

    // One query for every link instead of one per trip sheet: the previous
    // per-row lookup made listing a few months of history hundreds of queries.
    const links = await this.db.getAllAsync<{ trip_sheet_id: string; route_id: string }>(
      'SELECT trip_sheet_id, route_id FROM trip_sheet_routes ORDER BY trip_sheet_id, route_order',
    );
    const routeIdsBySheet = new Map<string, string[]>();
    for (const link of links) {
      const existing = routeIdsBySheet.get(link.trip_sheet_id);
      if (existing) existing.push(link.route_id);
      else routeIdsBySheet.set(link.trip_sheet_id, [link.route_id]);
    }

    return rows.map((row) => ({
      ...mapTripSheet(row),
      routeIds: routeIdsBySheet.get(row.id) ?? [],
      vehicleName: row.vehicle_name,
    }));
  }

  async listFuelEntries(): Promise<FuelEntry[]> {
    const rows = await this.db.getAllAsync<FuelEntryRow>(
      'SELECT * FROM fuel_entries ORDER BY filled_at DESC, created_at DESC',
    );
    return rows.map(mapFuelEntry);
  }

  async saveFuelEntry(input: {
    tripSheetId: string;
    filledAt: string;
    odometer: number;
    liters: number;
    pricePerLiter: number | null;
    station: string | null;
    notes: string | null;
  }, now = new Date().toISOString()): Promise<FuelEntry> {
    const sheet = await this.db.getFirstAsync<{ vehicle_id: string }>('SELECT vehicle_id FROM trip_sheets WHERE id = ?', input.tripSheetId);
    if (!sheet) throw new Error('Kelionės lapas nerastas.');
    const vehicle = await this.db.getFirstAsync<{ fuel_type: FuelType }>('SELECT fuel_type FROM vehicles WHERE id = ?', sheet.vehicle_id);
    if (!vehicle) throw new Error('Kelionės lapo automobilis nerastas.');
    const id = `fuel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const totalCost = input.pricePerLiter === null ? null : Math.round(input.liters * input.pricePerLiter * 100) / 100;
    await this.db.runAsync(
      `INSERT INTO fuel_entries (
         id, vehicle_id, trip_sheet_id, filled_at, odometer, liters, price_per_liter,
         total_cost, full_tank, fuel_type, station, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      id, sheet.vehicle_id, input.tripSheetId, input.filledAt, input.odometer, input.liters,
      input.pricePerLiter, totalCost, vehicle.fuel_type, input.station, input.notes, now,
    );
    const row = await this.db.getFirstAsync<FuelEntryRow>('SELECT * FROM fuel_entries WHERE id = ?', id);
    if (!row) throw new Error('Kuro įrašo išsaugoti nepavyko.');
    return mapFuelEntry(row);
  }

  async syncCompletedDate(date: string, now = new Date().toISOString()): Promise<TripSheetWithRoutes> {
    const routes = await this.db.getAllAsync<CompletedRouteRow>(
      `SELECT id, date, estimated_distance_km, actual_distance_km, estimated_duration_minutes,
              start_odometer, end_odometer, planned_departure_at, started_at, completed_at,
              start_location_json, end_location_json
       FROM routes
       WHERE status = 'completed' AND date = ?
       ORDER BY COALESCE(started_at, created_at), id`,
      date,
    );
    if (routes.length === 0) throw new Error('Šiai dienai nėra užbaigtų maršrutų.');

    const vehicle = await this.ensureVehicle(now);
    const existing = await this.db.getFirstAsync<{ id: string; created_at: string }>(
      'SELECT id, created_at FROM trip_sheets WHERE vehicle_id = ? AND date = ? ORDER BY created_at LIMIT 1',
      vehicle.id,
      date,
    );
    const id = existing?.id ?? `trip-sheet-${date}-${vehicle.id}`;
    const first = routes[0];
    const last = routes[routes.length - 1];
    const startAt = routes.map((route) => route.started_at).find(Boolean) ?? null;
    const completedAt = [...routes].reverse().map((route) => route.completed_at).find(Boolean) ?? null;
    const actualDurationMinutes = startAt && completedAt
      ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startAt)) / 60_000))
      : null;
    const delivered = await this.db.getFirstAsync<{ weight_kg: number; stops: number }>(
      `SELECT COALESCE(SUM(CASE WHEN delivery_status = 'delivered' THEN weight_kg ELSE 0 END), 0) AS weight_kg,
              COALESCE(SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END), 0) AS stops
       FROM delivery_stops WHERE route_id IN (${routes.map(() => '?').join(',')})`,
      ...routes.map((route) => route.id),
    );

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO trip_sheets (
           id, date, vehicle_id, start_location_json, end_location_json,
           start_odometer, end_odometer, actual_distance_km, planned_distance_km,
           planned_start_at, actual_start_at, planned_end_at, actual_end_at,
           planned_duration_minutes, actual_duration_minutes, total_delivered_weight_kg,
           total_stops, notes, created_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           start_location_json = excluded.start_location_json,
           end_location_json = excluded.end_location_json,
           start_odometer = excluded.start_odometer,
           end_odometer = excluded.end_odometer,
           actual_distance_km = excluded.actual_distance_km,
           planned_distance_km = excluded.planned_distance_km,
           planned_start_at = excluded.planned_start_at,
           actual_start_at = excluded.actual_start_at,
           planned_end_at = excluded.planned_end_at,
           actual_end_at = excluded.actual_end_at,
           planned_duration_minutes = excluded.planned_duration_minutes,
           actual_duration_minutes = excluded.actual_duration_minutes,
           total_delivered_weight_kg = excluded.total_delivered_weight_kg,
           total_stops = excluded.total_stops,
           completed_at = excluded.completed_at`,
        id,
        date,
        vehicle.id,
        first.start_location_json ?? JSON.stringify(parseLocation(null, 'Pradžia')),
        last.end_location_json ?? JSON.stringify(parseLocation(null, 'Pabaiga')),
        first.start_odometer,
        last.end_odometer,
        optionalSum(routes.map((route) => route.actual_distance_km)),
        optionalSum(routes.map((route) => route.estimated_distance_km)),
        first.planned_departure_at,
        startAt,
        null,
        completedAt,
        optionalSum(routes.map((route) => route.estimated_duration_minutes)),
        actualDurationMinutes,
        delivered?.weight_kg ?? 0,
        delivered?.stops ?? 0,
        null,
        existing?.created_at ?? now,
        completedAt,
      );
      await this.db.runAsync('DELETE FROM trip_sheet_routes WHERE trip_sheet_id = ?', id);
      for (const [index, route] of routes.entries()) {
        await this.db.runAsync(
          'INSERT INTO trip_sheet_routes (trip_sheet_id, route_id, route_order) VALUES (?, ?, ?)',
          id,
          route.id,
          index + 1,
        );
      }
    });

    return (await this.list()).find((sheet) => sheet.id === id)!;
  }

  async syncAllCompletedDates(now = new Date().toISOString()): Promise<TripSheetWithRoutes[]> {
    const dates = await this.db.getAllAsync<{ date: string }>(
      `SELECT DISTINCT date FROM routes WHERE status = 'completed' ORDER BY date DESC`,
    );
    for (const { date } of dates) await this.syncCompletedDate(date, now);
    return this.list();
  }
}
