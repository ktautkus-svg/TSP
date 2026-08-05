import type { MatrixCell, RoutingLocation } from '../../src/domain/routing/models';
import { PROVIDER_CAPABILITIES } from '../capabilities';
import type { GatewayResponseCache } from '../cache/file-response-cache';
import type {
  GatewayMatrixRequest,
  MatrixProviderAdapter,
  ProviderFetchOptions,
  ProviderFetchResult,
} from '../types';
import {
  fetchProviderJson,
  invalidProviderPayload,
  normalizeGoogleDepartureAt,
} from './adapter-utils';

type GoogleMatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code?: number; message?: string };
  condition?: string;
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
};

export type GoogleChunkFetchResult = {
  originChunk: { locations: RoutingLocation[]; startIndex: number };
  destChunk: { locations: RoutingLocation[]; startIndex: number };
  payload: unknown;
  headers: Headers;
  cacheHit?: boolean;
  elementCount?: number;
};

type GoogleMatrixAdapterOptions = {
  cache?: GatewayResponseCache;
  maxConcurrency?: number;
  liveCacheTtlMs?: number;
  noTrafficCacheTtlMs?: number;
};

export class GoogleMatrixAdapter implements MatrixProviderAdapter {
  readonly provider = 'google' as const;
  readonly version = 'google-routes-matrix-v2-2';
  readonly capabilities = PROVIDER_CAPABILITIES.google;

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly chunkSize = 25,
    private readonly options: GoogleMatrixAdapterOptions = {},
  ) {}

  async fetchMatrix(
    request: GatewayMatrixRequest,
    signal: AbortSignal,
    fetchOptions: ProviderFetchOptions = {},
  ): Promise<ProviderFetchResult> {
    const locations = allLocations(request);
    const totalSize = locations.length;
    const started = performance.now();

    const locationChunks: { locations: RoutingLocation[]; startIndex: number }[] = [];
    for (let i = 0; i < totalSize; i += this.chunkSize) {
      locationChunks.push({
        locations: locations.slice(i, i + this.chunkSize),
        startIndex: i,
      });
    }

    const subRequests: Array<() => Promise<GoogleChunkFetchResult>> = [];

    for (const originChunk of locationChunks) {
      for (const destChunk of locationChunks) {
        const body = {
          origins: originChunk.locations.map(toGoogleWaypoint),
          destinations: destChunk.locations.map(toGoogleWaypoint),
          travelMode: 'DRIVE',
          routingPreference:
            request.trafficMode === 'none' ? 'TRAFFIC_UNAWARE' : 'TRAFFIC_AWARE',
          ...(request.trafficMode === 'none'
            ? {}
            : { departureTime: normalizeGoogleDepartureAt(request.departureAt) }),
          languageCode: request.language,
          regionCode: request.regionCode,
          units: 'METRIC',
        };

        subRequests.push(() => this.fetchChunk(
          request,
          originChunk,
          destChunk,
          body,
          signal,
          fetchOptions.bypassCache === true,
        ));
      }
    }

    const chunkResults = await runWithConcurrency(
      subRequests,
      Math.max(1, this.options.maxConcurrency ?? 2),
    );
    const responseMs = performance.now() - started;

    return normalizeGoogleMatrixChunks(chunkResults, request, totalSize, responseMs);
  }

  private async fetchChunk(
    request: GatewayMatrixRequest,
    originChunk: { locations: RoutingLocation[]; startIndex: number },
    destChunk: { locations: RoutingLocation[]; startIndex: number },
    body: unknown,
    signal: AbortSignal,
    bypassCache: boolean,
  ): Promise<GoogleChunkFetchResult> {
    const cache = this.options.cache;
    const key = cache?.key('google-matrix-chunk', {
      adapterVersion: this.version,
      trafficMode: request.trafficMode,
      departureAt: request.departureAt,
      language: request.language,
      regionCode: request.regionCode,
      origins: originChunk.locations.map(locationIdentity),
      destinations: destChunk.locations.map(locationIdentity),
    });
    if (cache && key && !bypassCache) {
      const lookup = await cache.get<{ payload: unknown; providerRequestId: string | null }>('google-matrix-chunk', key);
      if (lookup.status === 'fresh') {
        const headers = new Headers();
        if (lookup.entry.value.providerRequestId) headers.set('x-goog-request-id', lookup.entry.value.providerRequestId);
        return {
          originChunk,
          destChunk,
          payload: lookup.entry.value.payload,
          headers,
          cacheHit: true,
          elementCount: originChunk.locations.length * destChunk.locations.length,
        };
      }
    }
    const { payload, headers } = await fetchProviderJson({
      provider: 'Google Routes',
      url: 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask':
            'originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration',
        },
        body: JSON.stringify(body),
        signal,
      },
      fetcher: this.fetcher,
    });
    const providerRequestId = headers.get('x-request-id') ?? headers.get('x-goog-request-id');
    if (cache && key) {
      await cache.set(
        'google-matrix-chunk',
        key,
        { payload, providerRequestId },
        request.trafficMode === 'none'
          ? this.options.noTrafficCacheTtlMs ?? 24 * 60 * 60_000
          : this.options.liveCacheTtlMs ?? 15 * 60_000,
      );
    }
    return {
      originChunk,
      destChunk,
      payload,
      headers,
      cacheHit: false,
      elementCount: originChunk.locations.length * destChunk.locations.length,
    };
  }
}

export function normalizeGoogleMatrixChunks(
  chunkResults: GoogleChunkFetchResult[],
  request: GatewayMatrixRequest,
  totalSize: number,
  responseMs: number,
): ProviderFetchResult {
  const locations = allLocations(request);
  const size = totalSize;
  const cells: MatrixCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => unreachableCell()),
  );
  const warnings = new Set<string>();
  const seen = new Set<string>();
  const requestIds: string[] = [];

  for (const { originChunk, destChunk, payload, headers } of chunkResults) {
    const requestId = headers.get('x-request-id') ?? headers.get('x-goog-request-id');
    if (requestId && !requestIds.includes(requestId)) {
      requestIds.push(requestId);
    }
    if (!Array.isArray(payload)) {
      invalidProviderPayload('Google Routes', 'tikėtasi elementų masyvo');
    }
    const elements = payload as GoogleMatrixElement[];
    for (const element of elements) {
      const localOrigin = element.originIndex;
      const localDest = element.destinationIndex;
      if (
        !Number.isInteger(localOrigin) ||
        !Number.isInteger(localDest) ||
        localOrigin! < 0 ||
        localDest! < 0 ||
        localOrigin! >= originChunk.locations.length ||
        localDest! >= destChunk.locations.length
      ) {
        invalidProviderPayload('Google Routes', 'neteisingas elemento indeksas');
      }
      const origin = originChunk.startIndex + localOrigin!;
      const destination = destChunk.startIndex + localDest!;
      const key = `${origin}:${destination}`;
      if (seen.has(key)) {
        invalidProviderPayload('Google Routes', 'pasikartojantis elemento indeksas');
      }
      seen.add(key);
      const statusCode = element.status?.code ?? 0;
      const durationSeconds = parseDurationSeconds(element.duration);
      const reachable =
        statusCode === 0 &&
        (element.condition === 'ROUTE_EXISTS' || !element.condition) &&
        Number.isFinite(element.distanceMeters) &&
        durationSeconds !== null;

      if (!reachable) {
        if (origin === destination) {
          cells[origin][destination] = {
            distanceKm: 0,
            durationMinutes: 0,
            reachable: true,
            maneuverPenalty: 0,
            restrictionWarnings: [],
          };
          continue;
        }
        warnings.add('Google matricoje yra nepasiekiamų arba klaidingų atkarpų.');
        continue;
      }
      cells[origin][destination] = {
        distanceKm: element.distanceMeters! / 1000,
        durationMinutes: durationSeconds! / 60,
        reachable: true,
        maneuverPenalty: 0,
        restrictionWarnings: [],
      };
    }
  }

  const count = size * size;
  const reachableCount = cells.flat().filter((cell) => cell.reachable).length;
  if (seen.size !== count) {
    invalidProviderPayload('Google Routes', `nepilna matrica (${seen.size}/${count} porų)`);
  }
  if (chunkResults.length > 1) {
    warnings.add(`Google matrica buvo sudaryta iš ${chunkResults.length} sub-užklausų blokų.`);
  }
  if (request.vehicle.type === 'truck' && request.vehicle.useRoadRestrictions) {
    warnings.add(
      'Google Routes Matrix nepalaiko sunkvežimio matmenų ir kelių apribojimų šiame adapteryje.',
    );
  }
  warnings.add('Google Routes Matrix nepateikia palyginamos manevrų metrikos.');
  return {
    matrix: {
      provider: 'Google Routes',
      executionMode: 'real',
      nodeIds: locations.map(({ id }) => id),
      cells,
      fetchedAt: new Date().toISOString(),
      trafficMode: request.trafficMode,
      departureAt: request.departureAt,
      warnings: [...warnings],
      version: 'google-routes-matrix-v2-2',
    },
    providerRequestId: requestIds.length > 0 ? requestIds.join(',') : null,
    responseMs,
    completenessRatio: reachableCount / count,
    warnings: [...warnings],
    externalRequestCount: chunkResults.filter((chunk) => !chunk.cacheHit).length,
    billableElementCount: chunkResults
      .filter((chunk) => !chunk.cacheHit)
      .reduce(
        (sum, chunk) => sum + (chunk.elementCount ?? chunk.originChunk.locations.length * chunk.destChunk.locations.length),
        0,
      ),
  };
}

export function normalizeGoogleMatrix(
  input: unknown,
  request: GatewayMatrixRequest,
  responseMs: number,
  headers = new Headers(),
): ProviderFetchResult {
  const locations = allLocations(request);
  return normalizeGoogleMatrixChunks(
    [
      {
        originChunk: { locations, startIndex: 0 },
        destChunk: { locations, startIndex: 0 },
        payload: input,
        headers,
      },
    ],
    request,
    locations.length,
    responseMs,
  );
}

function allLocations(request: GatewayMatrixRequest): RoutingLocation[] {
  return [request.startLocation, ...request.stops, request.endLocation];
}

function toGoogleWaypoint(location: RoutingLocation) {
  return {
    waypoint: {
      location: {
        latLng: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
      },
    },
  };
}

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function unreachableCell(): MatrixCell {
  return {
    distanceKm: null,
    durationMinutes: null,
    reachable: false,
    maneuverPenalty: 0,
    restrictionWarnings: [],
  };
}

function locationIdentity(location: RoutingLocation) {
  return {
    id: location.id,
    latitude: Math.round(location.latitude * 1e6) / 1e6,
    longitude: Math.round(location.longitude * 1e6) / 1e6,
  };
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, maximum: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(maximum, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}
