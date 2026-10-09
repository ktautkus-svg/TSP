import type { SQLiteDatabase } from 'expo-sqlite';

import { addressMemoryKeys } from '@/database/repositories/address-resolution-memory-repository';
import {
  learnedCoordinateId,
  learnedSampleKey,
  type LearnedCoordinateSyncRecord,
} from '@/domain/learned-coordinate-sync';
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
  original_address?: string | null;
  normalized_address?: string | null;
  geocode_latitude?: number | null;
  geocode_longitude?: number | null;
  sync_status?: string | null;
  sample_key?: string | null;
  synced_sample_key?: string | null;
  server_version?: number | null;
};

export type ParkMemoryMeta = {
  originalAddress?: string | null;
  normalizedAddress?: string | null;
  geocodeLatitude?: number | null;
  geocodeLongitude?: number | null;
  sampleKey?: string | null;
  syncStatus?: 'pending' | 'synced';
  serverVersion?: number | null;
};

export type ParkMemorySyncRow = {
  record: LearnedCoordinateSyncRecord;
  syncStatus: string;
  syncedSampleKey: string | null;
  sampleKey: string;
};

export class LocationParkMemoryRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async find(sourceAddress: string): Promise<LearnedParkPin | null> {
    const keys = addressMemoryKeys(sourceAddress);
    const raw = sourceAddress.trim();
    if (raw && !keys.includes(raw)) keys.unshift(raw);
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

  async save(sourceAddress: string, pin: LearnedParkPin, now: string, meta: ParkMemoryMeta = {}): Promise<void> {
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
      await this.writeMeta(key, pin, meta);
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

  async listSyncRows(): Promise<ParkMemorySyncRow[]> {
    try {
      const rows = await this.db.getAllAsync<ParkMemoryRow>(
        `SELECT address_key, latitude, longitude, heading, accuracy_m, sample_count,
                last_sampled_at, created_at, updated_at, original_address, normalized_address,
                geocode_latitude, geocode_longitude, sync_status, sample_key, synced_sample_key, server_version
         FROM location_park_memory`,
      );
      return rows.map(toSyncRow);
    } catch (error) {
      if (/no such column/i.test(String(error))) return [];
      throw error;
    }
  }

  async findSyncRow(canonicalId: string): Promise<ParkMemorySyncRow | null> {
    const rows = await this.listSyncRows();
    return rows.find((row) => row.record.canonicalId === canonicalId) ?? null;
  }

  async markSynced(canonicalId: string, sampleKey: string, serverVersion: number | null): Promise<void> {
    try {
      await this.db.runAsync(
        `UPDATE location_park_memory
         SET sync_status = 'synced', synced_sample_key = ?, server_version = ?
         WHERE address_key = ? OR normalized_address = ? OR original_address = ?`,
        sampleKey,
        serverVersion,
        canonicalId,
        canonicalId,
        canonicalId,
      );
    } catch (error) {
      if (/no such column/i.test(String(error))) return;
      throw error;
    }
  }

  private async writeMeta(key: string, pin: LearnedParkPin, meta: ParkMemoryMeta): Promise<void> {
    if (!meta.originalAddress && !meta.normalizedAddress && !meta.sampleKey && !meta.syncStatus) return;
    try {
      await this.db.runAsync(
        `UPDATE location_park_memory
         SET original_address = COALESCE(?, original_address),
             normalized_address = COALESCE(?, normalized_address),
             geocode_latitude = COALESCE(?, geocode_latitude),
             geocode_longitude = COALESCE(?, geocode_longitude),
             sample_key = COALESCE(?, sample_key),
             sync_status = COALESCE(?, sync_status),
             server_version = COALESCE(?, server_version)
         WHERE address_key = ?`,
        meta.originalAddress ?? null,
        meta.normalizedAddress ?? null,
        meta.geocodeLatitude ?? null,
        meta.geocodeLongitude ?? null,
        meta.sampleKey ?? learnedSampleKey({
          lastSampledAt: pin.lastSampledAt,
          learnedLatitude: pin.latitude,
          learnedLongitude: pin.longitude,
          sampleCount: pin.sampleCount,
        }),
        meta.syncStatus ?? null,
        meta.serverVersion ?? null,
        key,
      );
    } catch (error) {
      if (/no such column/i.test(String(error))) return;
      throw error;
    }
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

function toSyncRow(row: ParkMemoryRow): ParkMemorySyncRow {
  const address = row.original_address || row.normalized_address || row.address_key;
  const normalizedAddress = row.normalized_address || row.original_address || row.address_key;
  const sampleKey = row.sample_key || learnedSampleKey({
    lastSampledAt: row.last_sampled_at,
    learnedLatitude: row.latitude,
    learnedLongitude: row.longitude,
    sampleCount: row.sample_count,
  });
  return {
    syncStatus: row.sync_status || 'pending',
    syncedSampleKey: row.synced_sample_key ?? null,
    sampleKey,
    record: {
      canonicalId: learnedCoordinateId(normalizedAddress || address),
      address,
      normalizedAddress,
      geocodeLatitude: row.geocode_latitude ?? null,
      geocodeLongitude: row.geocode_longitude ?? null,
      learnedLatitude: row.latitude,
      learnedLongitude: row.longitude,
      accuracyM: row.accuracy_m,
      sampleCount: row.sample_count,
      lastSampledAt: row.last_sampled_at,
      sampleKey,
      version: row.server_version ?? 0,
      appliedSampleKeys: [sampleKey],
      status: 'used',
    },
  };
}
