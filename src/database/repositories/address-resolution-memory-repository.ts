import type { SQLiteDatabase } from 'expo-sqlite';

import type { ResolvedAddressCandidate } from '@/domain/import/models';

type AddressMemoryRow = {
  normalized_address: string;
  latitude: number;
  longitude: number;
  place_id: string | null;
  confidence: number;
};

export class AddressResolutionMemoryRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async find(sourceAddress: string): Promise<ResolvedAddressCandidate | null> {
    const key = addressMemoryKey(sourceAddress);
    if (!key) return null;
    const row = await this.db.getFirstAsync<AddressMemoryRow>(
      `SELECT normalized_address, latitude, longitude, place_id, confidence
       FROM address_resolution_memory WHERE address_key = ?`,
      key,
    );
    if (!row) return null;
    await this.db.runAsync(
      'UPDATE address_resolution_memory SET use_count = use_count + 1, updated_at = ? WHERE address_key = ?',
      new Date().toISOString(),
      key,
    );
    return {
      normalizedAddress: row.normalized_address,
      latitude: row.latitude,
      longitude: row.longitude,
      placeId: row.place_id,
      confidence: row.confidence,
    };
  }

  async remember(sourceAddress: string, candidate: ResolvedAddressCandidate): Promise<void> {
    const key = addressMemoryKey(sourceAddress);
    if (!key || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return;
    const now = new Date().toISOString();
    await this.db.runAsync(
      `INSERT INTO address_resolution_memory (
         address_key, source_address, normalized_address, latitude, longitude,
         place_id, confidence, use_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(address_key) DO UPDATE SET
         source_address = excluded.source_address,
         normalized_address = excluded.normalized_address,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         place_id = excluded.place_id,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at`,
      key,
      sourceAddress.trim(),
      candidate.normalizedAddress,
      candidate.latitude,
      candidate.longitude,
      candidate.placeId,
      candidate.confidence,
      now,
      now,
    );
  }
}

export function addressMemoryKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;])\s*/g, '$1')
    .trim();
}
