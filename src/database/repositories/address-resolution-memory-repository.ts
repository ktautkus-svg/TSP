import type { SQLiteDatabase } from 'expo-sqlite';

import type { ResolvedAddressCandidate } from '@/domain/import/models';

type AddressMemoryRow = {
  normalized_address: string;
  latitude: number;
  longitude: number;
  place_id: string | null;
  confidence: number;
};

type HistoricalStopRow = {
  address: string;
  original_address: string;
  geocoding_query: string | null;
  normalized_address: string | null;
  latitude: number;
  longitude: number;
};

export class AddressResolutionMemoryRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async find(sourceAddress: string): Promise<ResolvedAddressCandidate | null> {
    const keys = addressMemoryKeys(sourceAddress);
    if (keys.length === 0) return null;
    let matchedKey: string | null = null;
    let row: AddressMemoryRow | null = null;
    for (const key of keys) {
      row = await this.db.getFirstAsync<AddressMemoryRow>(
        `SELECT normalized_address, latitude, longitude, place_id, confidence
         FROM address_resolution_memory WHERE address_key = ?`,
        key,
      );
      if (row) { matchedKey = key; break; }
    }
    if (!row || !matchedKey) {
      const historical = await this.findInRouteHistory(keys);
      if (!historical) return null;
      await this.remember(sourceAddress, historical);
      return historical;
    }
    await this.db.runAsync(
      'UPDATE address_resolution_memory SET use_count = use_count + 1, updated_at = ? WHERE address_key = ?',
      new Date().toISOString(),
      matchedKey,
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
    const keys = addressMemoryKeys(sourceAddress);
    if (keys.length === 0 || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return;
    const now = new Date().toISOString();
    for (const key of keys) {
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

  private async findInRouteHistory(keys: string[]): Promise<ResolvedAddressCandidate | null> {
    try {
      const expected = new Set(keys);
      const rows = await this.db.getAllAsync<HistoricalStopRow>(
        `SELECT address, original_address, geocoding_query, normalized_address,
                latitude, longitude
         FROM delivery_stops
         WHERE latitude IS NOT NULL
           AND longitude IS NOT NULL
           AND address_validation_state = 'auto_confirmed'
         ORDER BY COALESCE(delivered_at, updated_at) DESC
         LIMIT 1000`,
      );
      for (const row of rows) {
        const aliases = [
          row.address,
          row.original_address,
          row.geocoding_query,
          row.normalized_address,
        ].filter((value): value is string => Boolean(value));
        if (!aliases.some((alias) => addressMemoryKeys(alias).some((key) => expected.has(key)))) continue;
        return {
          normalizedAddress: row.normalized_address ?? row.address ?? row.original_address,
          latitude: row.latitude,
          longitude: row.longitude,
          placeId: null,
          confidence: 1,
        };
      }
    } catch {
      // Older/minimal databases may not have route history yet. In that case
      // the normal provider lookup remains available.
    }
    return null;
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

export function addressMemoryKeys(value: string): string[] {
  const exact = addressMemoryKey(value);
  if (!exact) return [];
  const street = semanticStreetKey(exact);
  return street && street !== exact ? [exact, street] : [exact];
}

function semanticStreetKey(value: string): string | null {
  // Initials are formatted inconsistently in source files ("P.Puzino" vs
  // "P. Puzino"). They are not part of the street identity.
  const withoutInitials = value.replace(/\b[\p{L}]\.\s*(?=[\p{L}])/gu, '');
  const match = withoutInitials.match(/([a-z0-9ąćęėįšųūž.'’-]{2,})\s+(g(?:atve)?|pr(?:ospektas)?|pl(?:entas)?|al(?:eja)?|skg|kelias)\.?\s*(\d+[a-z]?)/iu);
  if (!match) return null;
  return `street:${match[1]!.replace(/[^a-z0-9ąćęėįšųūž]/giu, '')}:${match[2]!.slice(0, 2)}:${match[3]}`;
}
