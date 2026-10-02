import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import {
  AddressResolutionMemoryRepository,
  addressMemoryKeys,
} from '../../src/database/repositories/address-resolution-memory-repository';
import { isAddressLocalityCompatible } from '../../src/domain/import/address-locality';
import { extractAddressText, stripSupplierPrefix } from '../../src/application/import/logistics-excel-v1';

class MemoryDatabase {
  readonly raw = new DatabaseSync(':memory:');
  constructor() {
    this.raw.exec(`CREATE TABLE address_resolution_memory (
      address_key TEXT PRIMARY KEY, source_address TEXT NOT NULL, normalized_address TEXT NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL, place_id TEXT, confidence REAL NOT NULL,
      use_count INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE delivery_stops (
      address TEXT NOT NULL, original_address TEXT NOT NULL, geocoding_query TEXT,
      normalized_address TEXT, latitude REAL, longitude REAL,
      address_validation_state TEXT NOT NULL, delivered_at TEXT, updated_at TEXT NOT NULL
    )`);
  }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
}

const RAW_SILALE = 'UAB Lambda LT\r\nVarnių g. 10A\r\n\r\nŠilalė  \r\nLietuva';
const RAW_KALTINENAI = 'UAB Lambda LT\r\nVarnių gatvė 22, 75451 Kaltinėnai\r\n\r\nŠilalės r.Kaltinėnai  75451\r\nLietuva';

function importedForm(raw: string): string {
  return extractAddressText(stripSupplierPrefix(raw).cleaned)!;
}

const confirmed = (normalizedAddress: string, latitude: number, longitude: number) => ({
  normalizedAddress, latitude, longitude, placeId: null, confidence: 1,
});

describe('multi-line Excel addresses keep confirmed coordinates', () => {
  it('gives the raw cell and the imported single-line form one shared exact key', () => {
    const rawKeys = addressMemoryKeys(RAW_SILALE);
    const importedKeys = addressMemoryKeys(importedForm(RAW_SILALE));
    const shared = rawKeys.filter((key) => importedKeys.includes(key) && !key.startsWith('street:'));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('a coordinate confirmed for the raw cell is found again for the imported text (and back)', async () => {
    const memory = new AddressResolutionMemoryRepository(new MemoryDatabase() as never);
    // The driver confirmed the real point (Laukuva gimnazija), not Šilalė town.
    await memory.remember(RAW_SILALE, confirmed('Varnių g. 10A, Laukuva, Lietuva', 55.6125, 22.2311));
    await expect(memory.find(importedForm(RAW_SILALE))).resolves.toMatchObject({ latitude: 55.6125, trustedMemory: true });

    const other = new AddressResolutionMemoryRepository(new MemoryDatabase() as never);
    await other.remember(importedForm(RAW_KALTINENAI), confirmed('Varnių g. 22, Kaltinėnai, Lietuva', 55.5701, 22.4502));
    await expect(other.find(RAW_KALTINENAI)).resolves.toMatchObject({ latitude: 55.5701, trustedMemory: true });
  });

  it('reads the settlement of a multi-line cell instead of the supplier or district noise', () => {
    expect(isAddressLocalityCompatible(RAW_KALTINENAI, 'Varnių g. 22, Kaltinėnai, 75451 Šilalės r. sav., Lietuva')).toBe(true);
    expect(isAddressLocalityCompatible(importedForm(RAW_KALTINENAI), 'Varnių g. 22, Kaltinėnai, Lietuva')).toBe(true);
    expect(isAddressLocalityCompatible(RAW_SILALE, 'Varnių g. 10A, Šilalė, Lietuva')).toBe(true);
    expect(isAddressLocalityCompatible(RAW_SILALE, 'Varnių g. 10A, Telšiai, Lietuva')).toBe(false);
  });

  it('a street-only match from another town is still not reused', async () => {
    const memory = new AddressResolutionMemoryRepository(new MemoryDatabase() as never);
    await memory.remember(RAW_SILALE, confirmed('Varnių g. 10A, Šilalė, Lietuva', 55.49, 22.18));
    await expect(memory.find('Varnių g. 10A, Telšiai')).resolves.toBeNull();
  });
});
