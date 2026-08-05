import type { SQLiteDatabase } from 'expo-sqlite';

import type { RouteEndpoint, SavedLocation, SavedLocationKind } from '@/domain/route';

type SavedLocationRow = {
  kind: SavedLocationKind;
  label: string;
  endpoint_json: string;
  created_at: string;
  updated_at: string;
};

export class SavedLocationRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(kind: SavedLocationKind): Promise<SavedLocation | null> {
    const row = await this.db.getFirstAsync<SavedLocationRow>(
      'SELECT * FROM saved_locations WHERE kind = ?',
      kind,
    );
    return row ? mapRow(row) : null;
  }

  async list(): Promise<SavedLocation[]> {
    const rows = await this.db.getAllAsync<SavedLocationRow>(
      "SELECT * FROM saved_locations ORDER BY CASE kind WHEN 'warehouse' THEN 1 ELSE 2 END",
    );
    return rows.map(mapRow);
  }

  async save(kind: SavedLocationKind, label: string, endpoint: RouteEndpoint, now: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO saved_locations (kind, label, endpoint_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET
         label = excluded.label,
         endpoint_json = excluded.endpoint_json,
         updated_at = excluded.updated_at`,
      kind,
      label.trim(),
      JSON.stringify(endpoint),
      now,
      now,
    );
  }
}

function mapRow(row: SavedLocationRow): SavedLocation {
  return {
    kind: row.kind,
    label: row.label,
    endpoint: JSON.parse(row.endpoint_json) as RouteEndpoint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
