import type {
  MatrixRequest,
  TravelCostProvider,
  TravelMatrix,
} from '@/domain/routing/models';

export interface MatrixCache {
  get(key: string): Promise<TravelMatrix | null>;
  set(key: string, matrix: TravelMatrix, expiresAt: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryMatrixCache implements MatrixCache {
  private readonly entries = new Map<
    string,
    { matrix: TravelMatrix; expiresAtMs: number }
  >();

  async get(key: string): Promise<TravelMatrix | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return { ...entry.matrix, executionMode: 'cache' };
  }

  async set(key: string, matrix: TravelMatrix, expiresAt: string): Promise<void> {
    this.entries.set(key, { matrix, expiresAtMs: Date.parse(expiresAt) });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

export class CachedTravelCostProvider implements TravelCostProvider {
  readonly name: string;

  constructor(
    private readonly provider: TravelCostProvider,
    private readonly cache: MatrixCache,
    private readonly ttlMs = 15 * 60_000,
  ) {
    this.name = provider.name;
  }

  async getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    const key = matrixCacheKey(this.name, request);
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const matrix = await this.provider.getMatrix(request);
    await this.cache.set(key, matrix, new Date(Date.now() + this.ttlMs).toISOString());
    return matrix;
  }
}

export function matrixCacheKey(provider: string, request: MatrixRequest): string {
  const departureBucket = new Date(request.departureAt);
  departureBucket.setUTCMinutes(
    Math.floor(departureBucket.getUTCMinutes() / 15) * 15,
    0,
    0,
  );
  return JSON.stringify({
    matrixVersion: 'matrix-contract-v1',
    provider,
    trafficMode: request.trafficMode,
    departureBucket: departureBucket.toISOString(),
    vehicle: {
      type: request.vehicle.type,
      heightM: request.vehicle.heightM,
      widthM: request.vehicle.widthM,
      lengthM: request.vehicle.lengthM,
      grossWeightKg: request.vehicle.grossWeightKg,
      useRoadRestrictions: request.vehicle.useRoadRestrictions,
    },
    locations: request.locations.map((location) => [
      location.id,
      round(location.latitude, 5),
      round(location.longitude, 5),
    ]),
  });
}

function round(value: number, precision: number): number {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}
