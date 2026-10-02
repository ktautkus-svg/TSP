import type { SQLiteDatabase } from 'expo-sqlite';

import type { ResolvedAddressCandidate } from '@/domain/import/models';
import { isAddressLocalityCompatible } from '@/domain/import/address-locality';

type AddressMemoryRow = {
  source_address: string;
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
        `SELECT source_address, normalized_address, latitude, longitude, place_id, confidence
         FROM address_resolution_memory WHERE address_key = ?`,
        key,
      );
      // The exact normalized source text is a confirmed mapping. A looser
      // street+house match is reusable only when its returned locality still
      // matches this query; this prevents equal street names in neighbouring
      // settlements from poisoning one another.
      if (
        row
        && !isExactAddressMemoryKey(key)
        && !isAddressLocalityCompatible(sourceAddress, row.normalized_address)
      ) {
        row = null;
        continue;
      }
      if (row) { matchedKey = key; break; }
    }
    if (!row || !matchedKey) {
      const historical = await this.findInRouteHistory(sourceAddress, keys);
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
      trustedMemory: true,
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

  private async findInRouteHistory(sourceAddress: string, keys: string[]): Promise<ResolvedAddressCandidate | null> {
    try {
      const expected = new Set(keys);
      const exactKeys = new Set(keys.filter(isExactAddressMemoryKey));
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
        const exactMatch = aliases.some((alias) => addressMemoryKeys(alias).some((key) => exactKeys.has(key)));
        const semanticMatch = aliases.some((alias) => addressMemoryKeys(alias).some((key) => expected.has(key)));
        if (!semanticMatch) continue;
        if (
          !exactMatch
          && !isAddressLocalityCompatible(
            sourceAddress,
            row.normalized_address ?? row.address ?? row.original_address,
          )
        ) continue;
        return {
          normalizedAddress: row.normalized_address ?? row.address ?? row.original_address,
          latitude: row.latitude,
          longitude: row.longitude,
          placeId: null,
          confidence: 1,
          trustedMemory: true,
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
  const keys = [exact];
  const canonical = canonicalAddressMemoryKey(value);
  if (canonical) keys.push(canonical);
  const street = semanticStreetKey(exact);
  if (street && street !== exact) keys.push(street);
  return keys;
}

/**
 * The same delivery address arrives in several textual shapes: the raw
 * multi-line Excel cell ("UAB Lambda LT\r\nVarnių g. 10A\r\n\r\nŠilalė\r\nLietuva"),
 * the import's single-line form ("Varnių g. 10A Šilalė Lietuva") and comma
 * separated variants. They differ only in line breaks, commas, the supplier
 * name and the country, so they share one canonical key. A match on it is as
 * trustworthy as an exact match: no locality guessing is involved.
 */
export function canonicalAddressMemoryKey(value: string): string | null {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Company / recipient lines above a multi-line address carry no digits;
  // the import itself starts the address at the first street line.
  const firstStreetLine = lines.length > 1 ? lines.findIndex((line) => /\d/.test(line)) : -1;
  const addressText = (firstStreetLine > 0 ? lines.slice(firstStreetLine) : lines).join(' ');
  const key = addressMemoryKey(addressText)
    .replace(/[,;]/g, ' ')
    .replace(/^(?:uab\s+)?(?:lambda(?:\s+lt)?|galiasas)(?=\s|$)/u, ' ')
    .replace(/(?:^|\s)lietuva\s*$/u, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key ? `canon:${key}` : null;
}

function isExactAddressMemoryKey(key: string): boolean {
  return !key.startsWith('street:');
}

function semanticStreetKey(value: string): string | null {
  // Initials are formatted inconsistently in source files ("P.Puzino" vs
  // "P. Puzino"). They are not part of the street identity.
  const withoutInitials = value.replace(/\b[\p{L}]\.\s*(?=[\p{L}])/gu, '');
  const match = withoutInitials.match(/([a-z0-9ąćęėįšųūž.'’-]{2,})\s+(g(?:atve)?|pr(?:ospektas)?|pl(?:entas)?|al(?:eja)?|skg|kelias)\.?\s*(\d+[a-z]?)/iu);
  if (!match) return null;
  return `street:${match[1]!.replace(/[^a-z0-9ąćęėįšųūž]/giu, '')}:${match[2]!.slice(0, 2)}:${match[3]}`;
}
