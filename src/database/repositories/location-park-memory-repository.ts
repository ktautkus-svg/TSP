import type { SQLiteDatabase } from 'expo-sqlite';

import { addressMemoryKeys } from '@/database/repositories/address-resolution-memory-repository';
import type { LearnedParkPin } from '@/domain/location-park-memory';

type ParkMemoryRow = {
  address_key: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  accuracy_m: number | null;
  sample_count: number;
  last_sampled_at: string;
  created_at: string;
  updated_at: string;
};

export class LocationParkMemoryRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async find(sourceAddress: string): Promise<LearnedParkPin | null> {
    const keys = addressMemoryKeys(sourceAddress);
    if (keys.length === 0) return null;
    for (const key of keys) {
      const row = await this.db.getFirstAsync<ParkMemoryRow>(
        `SELECT address_key, latitude, longitude, heading, accuracy_m, sample_count,
                last_sampled_at, created_at, updated_at
         FROM location_park_memory WHERE address_key = ?`,
        key,
      );
      if (row) return mapRow(row);
    }
    return null;
  }

  async save(sourceAddress: string, pin: LearnedParkPin, now: string): Promise<void> {
    const keys = addressMemoryKeys(sourceAddress);
    if (keys.length === 0) return;
    for (const key of keys) {
      await this.db.runAsync(
        `INSERT INTO location_park_memory (
           address_key, latitude, longitude, heading, accuracy_m, sample_count,
           last_sampled_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address_key) DO UPDATE SET
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           heading = excluded.heading,
           accuracy_m = excluded.accuracy_m,
           sample_count = excluded.sample_count,
           last_sampled_at = excluded.last_sampled_at,
           updated_at = excluded.updated_at`,
        key,
        pin.latitude,
        pin.longitude,
        pin.heading,
        pin.accuracyM,
        pin.sampleCount,
        pin.lastSampledAt,
        now,
        now,
      );
    }
  }

  async forget(sourceAddress: string): Promise<boolean> {
    const keys = addressMemoryKeys(sourceAddress);
    if (keys.length === 0) return false;
    let removed = false;
    for (const key of keys) {
      const result = await this.db.runAsync('DELETE FROM location_park_memory WHERE address_key = ?', key);
      if ((result?.changes ?? 0) > 0) removed = true;
    }
    return removed;
  }
}

function mapRow(row: ParkMemoryRow): LearnedParkPin {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    heading: row.heading,
    accuracyM: row.accuracy_m,
    sampleCount: row.sample_count,
    lastSampledAt: row.last_sampled_at,
  };
}
