import type { SQLiteDatabase } from 'expo-sqlite';

import type { VehicleFault } from '@/domain/vehicle-and-trip';

type FaultRow = {
  id: string;
  vehicle_id: string;
  comment: string;
  reported_by: string | null;
  reported_at: string;
  notified_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
};

function mapFault(row: FaultRow): VehicleFault {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    comment: row.comment,
    reportedBy: row.reported_by,
    reportedAt: row.reported_at,
    notifiedAt: row.notified_at,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
  };
}

export class VehicleFaultRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listOpen(vehicleId: string): Promise<VehicleFault[]> {
    const rows = await this.db.getAllAsync<FaultRow>(
      `SELECT * FROM vehicle_faults
       WHERE vehicle_id = ? AND acknowledged_at IS NULL
       ORDER BY reported_at DESC`,
      vehicleId,
    );
    return rows.map(mapFault);
  }

  async listAll(vehicleId: string): Promise<VehicleFault[]> {
    const rows = await this.db.getAllAsync<FaultRow>(
      `SELECT * FROM vehicle_faults WHERE vehicle_id = ? ORDER BY reported_at DESC`,
      vehicleId,
    );
    return rows.map(mapFault);
  }

  async add(input: {
    vehicleId: string;
    comment: string;
    reportedBy?: string | null;
  }, now = new Date().toISOString()): Promise<VehicleFault> {
    const comment = input.comment.trim();
    if (!comment) throw new Error('Įveskite gedimo aprašymą.');
    const id = `fault-${Date.now().toString(36)}`;
    await this.db.runAsync(
      `INSERT INTO vehicle_faults (
         id, vehicle_id, comment, reported_by, reported_at, notified_at, acknowledged_at, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      id,
      input.vehicleId,
      comment,
      input.reportedBy ?? null,
      now,
      now,
    );
    const saved = await this.db.getFirstAsync<FaultRow>('SELECT * FROM vehicle_faults WHERE id = ?', id);
    return mapFault(saved!);
  }

  async markNotified(id: string, notifiedAt = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      'UPDATE vehicle_faults SET notified_at = ? WHERE id = ? AND notified_at IS NULL',
      notifiedAt,
      id,
    );
  }

  async acknowledge(id: string, acknowledgedAt = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      'UPDATE vehicle_faults SET acknowledged_at = ? WHERE id = ?',
      acknowledgedAt,
      id,
    );
  }
}
