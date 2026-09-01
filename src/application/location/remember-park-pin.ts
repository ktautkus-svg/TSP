import type { SQLiteDatabase } from 'expo-sqlite';

import { LocationParkMemoryRepository } from '@/database/repositories/location-park-memory-repository';
import { addressMemoryKeys } from '@/database/repositories/address-resolution-memory-repository';
import {
  evaluateParkSample,
  type GpsSample,
  type LearnedParkPin,
  type ParkSampleDecision,
} from '@/domain/location-park-memory';

export type StopParkAddress = {
  id: string;
  routeId: string;
  originalAddress: string;
  normalizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Phone-GPS courtyard learning. Never reverse-geocodes, never buys a matrix, never
 * overwrites the customer-facing address or rooftop pin.
 */
export async function rememberParkPinFromGps(
  db: SQLiteDatabase,
  stop: StopParkAddress,
  sample: GpsSample | null | undefined,
  now = new Date().toISOString(),
): Promise<ParkSampleDecision> {
  const address = stop.normalizedAddress ?? stop.originalAddress;
  const memory = new LocationParkMemoryRepository(db);
  const previous = await memory.find(address);
  const decision = evaluateParkSample({
    sample,
    rooftop: stop,
    previous,
    nowMs: Date.parse(now) || Date.now(),
  });
  if (!decision.accepted) return decision;
  await memory.save(address, decision.pin, now);
  await writeParkPinOntoMatchingStops(db, stop.routeId, address, decision.pin, now);
  return decision;
}

export async function forgetParkPin(
  db: SQLiteDatabase,
  stop: Pick<StopParkAddress, 'routeId' | 'originalAddress' | 'normalizedAddress'>,
  now = new Date().toISOString(),
): Promise<boolean> {
  const address = stop.normalizedAddress ?? stop.originalAddress;
  const removed = await new LocationParkMemoryRepository(db).forget(address);
  await writeParkPinOntoMatchingStops(db, stop.routeId, address, null, now);
  return removed;
}

export async function parkPinForAddress(
  db: SQLiteDatabase,
  address: string | null | undefined,
): Promise<LearnedParkPin | null> {
  if (!address?.trim()) return null;
  try {
    return await new LocationParkMemoryRepository(db).find(address);
  } catch (error) {
    // Pre-v28 / partially migrated clients must still import and start loading.
    if (/no such table: location_park_memory|no such column: park_|finalizing statement/i.test(String(error))) {
      return null;
    }
    throw error;
  }
}

export async function hydrateStopParkPins<T extends StopParkAddress>(
  db: SQLiteDatabase,
  stops: T[],
): Promise<T[]> {
  if (stops.length === 0) return stops;
  try {
    const memory = new LocationParkMemoryRepository(db);
    const hydrated: T[] = [];
    for (const stop of stops) {
      const pin = await memory.find(stop.normalizedAddress ?? stop.originalAddress);
      hydrated.push(pin ? withParkPin(stop, pin) : stop);
    }
    return hydrated;
  } catch (error) {
    if (/no such table: location_park_memory|no such column: park_|finalizing statement/i.test(String(error))) {
      return stops;
    }
    throw error;
  }
}

async function writeParkPinOntoMatchingStops(
  db: SQLiteDatabase,
  routeId: string,
  address: string,
  pin: LearnedParkPin | null,
  now: string,
): Promise<void> {
  const keys = new Set(addressMemoryKeys(address));
  if (keys.size === 0) return;
  const rows = await db.getAllAsync<{ id: string; original_address: string; normalized_address: string | null }>(
    'SELECT id, original_address, normalized_address FROM delivery_stops WHERE route_id = ?',
    routeId,
  );
  for (const row of rows) {
    const stopKeys = addressMemoryKeys(row.normalized_address ?? row.original_address);
    if (!stopKeys.some((key) => keys.has(key))) continue;
    try {
      await db.runAsync(
        `UPDATE delivery_stops
         SET park_latitude = ?, park_longitude = ?, park_heading = ?, park_accuracy_m = ?,
             park_sample_count = ?, park_sampled_at = ?, updated_at = ?
         WHERE id = ?`,
        pin?.latitude ?? null,
        pin?.longitude ?? null,
        pin?.heading ?? null,
        pin?.accuracyM ?? null,
        pin?.sampleCount ?? null,
        pin?.lastSampledAt ?? null,
        now,
        row.id,
      );
    } catch (error) {
      if (/no such column: park_|finalizing statement/i.test(String(error))) return;
      throw error;
    }
  }
}

function withParkPin<T extends StopParkAddress>(stop: T, pin: LearnedParkPin): T {
  return {
    ...stop,
    parkLatitude: pin.latitude,
    parkLongitude: pin.longitude,
    parkHeading: pin.heading,
    parkAccuracyM: pin.accuracyM,
    parkSampleCount: pin.sampleCount,
    parkSampledAt: pin.lastSampledAt,
  };
}
