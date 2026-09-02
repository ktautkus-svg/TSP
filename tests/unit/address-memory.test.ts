import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { AddressResolutionMemoryRepository, addressMemoryKeys } from '../../src/database/repositories/address-resolution-memory-repository';
import { knownAddressCorrection, knownSplitUnloadSite } from '../../src/domain/import/known-address-corrections';

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

describe('address correction memory', () => {
  it('maps Pajuosčio pl. 73 to the real unloading point', () => {
    expect(knownAddressCorrection('UAB Lambda LT Pajuosčio pl.73 Dembavos k.')).toMatchObject({
      latitude: 55.738356,
      longitude: 24.434709,
    });
  });

  it('remembers Lambda / Panevėžio ligoninė as a split-unload site and leaves other addresses alone', () => {
    expect(knownSplitUnloadSite('UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė')).toBe(true);
    expect(knownSplitUnloadSite('Smėlynės g. 25, Panevėžys')).toBe(true);
    expect(knownSplitUnloadSite('UAB Lambda LT Pajuosčio pl.73 Dembavos k.')).toBe(false);
    expect(knownSplitUnloadSite('Dainų g. 11, Šiauliai')).toBe(false);
  });

  it('uses a semantic street key across spacing and locality variants', async () => {
    const memory = new AddressResolutionMemoryRepository(new MemoryDatabase() as never);
    const candidate = {
      normalizedAddress: 'Pajuosčio pl. 73, Dembavos k., Lietuva',
      latitude: 55.738356,
      longitude: 24.434709,
      placeId: null,
      confidence: 1,
    };
    await memory.remember('Pajuosčio pl.73 Dembavos k. Velžio sen.', candidate);
    expect(addressMemoryKeys('Pajuosčio pl. 73, Panevėžio r.')).toContain('street:pajuoscio:pl:73');
    await expect(memory.find('Pajuosčio pl. 73, Panevėžio r.')).resolves.toMatchObject(candidate);
  });

  it('recovers a repeatedly driven address from confirmed route history', async () => {
    const database = new MemoryDatabase();
    database.raw.prepare(
      `INSERT INTO delivery_stops (
         address, original_address, geocoding_query, normalized_address,
         latitude, longitude, address_validation_state, delivered_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'auto_confirmed', ?, ?)`,
    ).run(
      'P. Puzino g. 12, Panevėžys',
      'P. Puzino g. 12, 35169 Panevėžys, Lietuva',
      'P. Puzino g. 12, Panevėžys',
      'P. Puzino g. 12, 35169 Panevėžys, Lietuva',
      55.734,
      24.357,
      '2026-09-01T08:00:00.000Z',
      '2026-09-01T08:00:00.000Z',
    );
    const memory = new AddressResolutionMemoryRepository(database as never);

    await expect(memory.find('P.Puzino g.12 Panevėžys LT-97123, Lietuva')).resolves.toMatchObject({
      latitude: 55.734,
      longitude: 24.357,
    });
    await expect(memory.find('P. Puzino g. 12, Panevėžys')).resolves.toMatchObject({
      latitude: 55.734,
      longitude: 24.357,
    });
  });
});
