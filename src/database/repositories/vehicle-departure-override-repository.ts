import type { SQLiteDatabase } from 'expo-sqlite';

export type VehicleDepartureOverride = {
  id: string;
  vehicleId: string;
  fingerprint: string;
  summary: string;
  status: 'pending' | 'approved';
  requestedBy: string | null;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type OverrideRow = {
  id: string;
  vehicle_id: string;
  fingerprint: string;
  summary: string;
  status: 'pending' | 'approved';
  requested_by: string | null;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

function mapOverride(row: OverrideRow): VehicleDepartureOverride {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    fingerprint: row.fingerprint,
    summary: row.summary,
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class VehicleDepartureOverrideRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getLatest(vehicleId: string): Promise<VehicleDepartureOverride | null> {
    const row = await this.db.getFirstAsync<OverrideRow>(
      `SELECT * FROM vehicle_departure_overrides
       WHERE vehicle_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      vehicleId,
    );
    return row ? mapOverride(row) : null;
  }

  async getForFingerprint(vehicleId: string, fingerprint: string): Promise<VehicleDepartureOverride | null> {
    const row = await this.db.getFirstAsync<OverrideRow>(
      `SELECT * FROM vehicle_departure_overrides
       WHERE vehicle_id = ? AND fingerprint = ?
       ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      vehicleId,
      fingerprint,
    );
    return row ? mapOverride(row) : null;
  }

  async request(input: {
    vehicleId: string;
    fingerprint: string;
    summary: string;
    requestedBy?: string | null;
  }, now = new Date().toISOString()): Promise<VehicleDepartureOverride> {
    const existing = await this.getForFingerprint(input.vehicleId, input.fingerprint);
    if (existing) return existing;
    const id = `override-${Date.now().toString(36)}`;
    await this.db.runAsync(
      `INSERT INTO vehicle_departure_overrides (
         id, vehicle_id, fingerprint, summary, status, requested_by, requested_at,
         approved_by, approved_at, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, ?, ?)`,
      id,
      input.vehicleId,
      input.fingerprint,
      input.summary,
      input.requestedBy ?? null,
      now,
      now,
      now,
    );
    const saved = await this.db.getFirstAsync<OverrideRow>('SELECT * FROM vehicle_departure_overrides WHERE id = ?', id);
    return mapOverride(saved!);
  }

  async approve(input: {
    vehicleId: string;
    fingerprint: string;
    summary: string;
    approvedBy: string;
    requestedBy?: string | null;
    note?: string | null;
  }, now = new Date().toISOString()): Promise<VehicleDepartureOverride> {
    const existing = await this.getForFingerprint(input.vehicleId, input.fingerprint);
    if (existing?.status === 'approved') return existing;
    if (existing) {
      await this.db.runAsync(
        `UPDATE vehicle_departure_overrides
         SET status = 'approved', approved_by = ?, approved_at = ?, note = ?, summary = ?, updated_at = ?
         WHERE id = ?`,
        input.approvedBy,
        now,
        input.note ?? existing.note,
        input.summary,
        now,
        existing.id,
      );
      const saved = await this.db.getFirstAsync<OverrideRow>('SELECT * FROM vehicle_departure_overrides WHERE id = ?', existing.id);
      return mapOverride(saved!);
    }
    const id = `override-${Date.now().toString(36)}`;
    await this.db.runAsync(
      `INSERT INTO vehicle_departure_overrides (
         id, vehicle_id, fingerprint, summary, status, requested_by, requested_at,
         approved_by, approved_at, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.vehicleId,
      input.fingerprint,
      input.summary,
      input.requestedBy ?? input.approvedBy,
      now,
      input.approvedBy,
      now,
      input.note ?? null,
      now,
      now,
    );
    const saved = await this.db.getFirstAsync<OverrideRow>('SELECT * FROM vehicle_departure_overrides WHERE id = ?', id);
    return mapOverride(saved!);
  }

  async upsertFromServer(input: VehicleDepartureOverride): Promise<VehicleDepartureOverride> {
    await this.db.runAsync(
      `INSERT INTO vehicle_departure_overrides (
         id, vehicle_id, fingerprint, summary, status, requested_by, requested_at,
         approved_by, approved_at, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         summary = excluded.summary,
         status = excluded.status,
         requested_by = excluded.requested_by,
         requested_at = excluded.requested_at,
         approved_by = excluded.approved_by,
         approved_at = excluded.approved_at,
         note = excluded.note,
         updated_at = excluded.updated_at`,
      input.id,
      input.vehicleId,
      input.fingerprint,
      input.summary,
      input.status,
      input.requestedBy,
      input.requestedAt,
      input.approvedBy,
      input.approvedAt,
      input.note,
      input.createdAt,
      input.updatedAt,
    );
    const saved = await this.db.getFirstAsync<OverrideRow>('SELECT * FROM vehicle_departure_overrides WHERE id = ?', input.id);
    return mapOverride(saved!);
  }
}
