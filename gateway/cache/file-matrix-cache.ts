import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderFetchResult } from '../types';
import type { GatewayMatrixRequest } from '../types';

type CacheEntry = {
  key: string;
  storedAt: string;
  expiresAt: string;
  result: ProviderFetchResult;
};

export type CacheLookup =
  | { status: 'miss' }
  | { status: 'fresh' | 'stale'; entry: CacheEntry };

export interface MatrixResultCache {
  createKey(
    request: GatewayMatrixRequest,
    adapterVersion: string,
  ): string;
  get(key: string, now?: Date): Promise<CacheLookup>;
  set(
    key: string,
    result: ProviderFetchResult,
    ttlMs: number,
    now?: Date,
  ): Promise<void>;
}

export class FileMatrixResultCache implements MatrixResultCache {
  constructor(private readonly directory: string) {}

  createKey(
    request: GatewayMatrixRequest,
    adapterVersion: string,
  ): string {
    return createMatrixCacheKey(request, adapterVersion);
  }

  async get(key: string, now = new Date()): Promise<CacheLookup> {
    try {
      const entry = JSON.parse(
        await readFile(join(this.directory, `${key}.json`), 'utf8'),
      ) as CacheEntry;
      if (
        entry.key !== key ||
        !entry.result?.matrix?.cells ||
        !Number.isFinite(Date.parse(entry.expiresAt))
      ) {
        return { status: 'miss' };
      }
      return {
        status: Date.parse(entry.expiresAt) > now.getTime() ? 'fresh' : 'stale',
        entry,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'miss' };
      }
      return { status: 'miss' };
    }
  }

  async set(
    key: string,
    result: ProviderFetchResult,
    ttlMs: number,
    now = new Date(),
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const entry: CacheEntry = {
      key,
      storedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      result,
    };
    await writeFile(
      join(this.directory, `${key}.json`),
      JSON.stringify(entry, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );
  }
}

export class MemoryMatrixResultCache implements MatrixResultCache {
  private readonly entries = new Map<string, CacheEntry>();

  createKey(
    request: GatewayMatrixRequest,
    adapterVersion: string,
  ): string {
    return createMatrixCacheKey(request, adapterVersion);
  }

  async get(key: string, now = new Date()): Promise<CacheLookup> {
    const entry = this.entries.get(key);
    if (!entry) return { status: 'miss' };
    return {
      status: Date.parse(entry.expiresAt) > now.getTime() ? 'fresh' : 'stale',
      entry,
    };
  }

  async set(
    key: string,
    result: ProviderFetchResult,
    ttlMs: number,
    now = new Date(),
  ): Promise<void> {
    this.entries.set(key, {
      key,
      storedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      result,
    });
  }
}

export function createMatrixCacheKey(
  request: GatewayMatrixRequest,
  adapterVersion: string,
): string {
  const locations = [
    request.startLocation,
    ...request.stops,
    request.endLocation,
  ].map(({ id, latitude, longitude }) => ({
    id,
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  }));
  const identity = {
    provider: request.provider,
    locations,
    vehicle: {
      type: request.vehicle.type,
      maximumPayloadKg: request.vehicle.maximumPayloadKg,
      heightM: request.vehicle.heightM ?? null,
      widthM: request.vehicle.widthM ?? null,
      lengthM: request.vehicle.lengthM ?? null,
      grossWeightKg: request.vehicle.grossWeightKg ?? null,
      useRoadRestrictions: request.vehicle.useRoadRestrictions,
    },
    departureAt: request.departureAt,
    trafficMode: request.trafficMode,
    adapterVersion,
  };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

