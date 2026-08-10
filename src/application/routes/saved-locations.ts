import type { SQLiteDatabase } from 'expo-sqlite';

import { SavedLocationRepository } from '@/database/repositories/saved-location-repository';
import type { PlanningMode, RouteEndpoint, SavedLocation, SavedLocationKind } from '@/domain/route';

export const DEFAULT_WAREHOUSE_ADDRESS = 'Savanorių pr. 180, Vilnius';
export const DEFAULT_HOME_ADDRESS = 'Alinkos g. 1A, Elektrėnai';
export type PreferredRouteEnd = 'warehouse' | 'home';

export class SaveDefaultLocation {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly clock = () => new Date().toISOString(),
  ) {}

  async execute(kind: SavedLocationKind, label: string, endpoint: RouteEndpoint): Promise<void> {
    if (!label.trim() || !endpoint.originalAddress.trim()) {
      throw new Error('Vietos pavadinimas ir adresas yra privalomi.');
    }
    await new SavedLocationRepository(this.db).save(kind, label, endpoint, this.clock());
  }
}

export class GetDefaultLocations {
  constructor(private readonly db: SQLiteDatabase) {}

  async execute(): Promise<{ warehouse: SavedLocation | null; home: SavedLocation | null }> {
    const repository = new SavedLocationRepository(this.db);
    const [warehouse, home] = await Promise.all([repository.get('warehouse'), repository.get('home')]);
    return { warehouse, home };
  }
}

export class RouteEndPreference {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<PreferredRouteEnd> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_preferences WHERE key = 'last_route_end_kind'",
    );
    return row?.value === 'home' ? 'home' : 'warehouse';
  }

  async save(value: PreferredRouteEnd, now = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at)
       VALUES ('last_route_end_kind', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      value,
      now,
    );
  }
}

export class PlanningModePreference {
  constructor(private readonly db: SQLiteDatabase) {}

  // Defaults to ignoring windows: most days the shortest drivable route matters
  // more than hitting advisory delivery windows, so the driver opts in instead.
  async get(): Promise<PlanningMode> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_preferences WHERE key = 'last_planning_mode'",
    );
    return row?.value === 'with_time_windows' ? 'with_time_windows' : 'ignore_time_windows';
  }

  async save(value: PlanningMode, now = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at)
       VALUES ('last_planning_mode', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      value,
      now,
    );
  }
}

export type StartLocationChoice =
  | { kind: 'warehouse' }
  | { kind: 'current'; endpoint: RouteEndpoint }
  | { kind: 'custom'; endpoint: RouteEndpoint };

export type EndLocationChoice =
  | { kind: 'warehouse' }
  | { kind: 'home' }
  | { kind: 'last_stop'; endpoint: RouteEndpoint }
  | { kind: 'custom'; endpoint: RouteEndpoint };

export class ResolveRouteLocations {
  constructor(private readonly db: SQLiteDatabase) {}

  async execute(start: StartLocationChoice, end: EndLocationChoice): Promise<{
    startLocation: RouteEndpoint;
    endLocation: RouteEndpoint;
  }> {
    const repository = new SavedLocationRepository(this.db);
    const startLocation = start.kind === 'warehouse'
      ? (await repository.get('warehouse'))?.endpoint
      : start.endpoint;
    const endLocation = end.kind === 'warehouse'
      ? (await repository.get('warehouse'))?.endpoint
      : end.kind === 'home'
        ? (await repository.get('home'))?.endpoint
        : end.endpoint;
    if (!startLocation) throw new Error('Numatytasis sandėlis nenustatytas. Pasirinkite maršruto pradžią.');
    if (!endLocation) throw new Error('Pasirinkta maršruto pabaigos vieta nenustatyta.');
    return { startLocation, endLocation };
  }
}
