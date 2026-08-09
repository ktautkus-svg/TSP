import type { MatrixCell, RoutingLocation } from '../../src/domain/routing/models';
import { PROVIDER_CAPABILITIES } from '../capabilities';
import type {
  GatewayMatrixRequest,
  MatrixProviderAdapter,
  ProviderFetchResult,
} from '../types';
import {
  fetchProviderJson,
  invalidProviderPayload,
  normalizeGoogleDepartureAt,
} from './adapter-utils';

type HereMatrixPayload = {
  matrixId?: string;
  matrix?: {
    numOrigins?: number;
    numDestinations?: number;
    travelTimes?: number[];
    distances?: number[];
    errorCodes?: number[];
  };
};

export class HereMatrixAdapter implements MatrixProviderAdapter {
  readonly provider = 'here' as const;
  readonly version = 'here-matrix-v8-1';
  readonly capabilities = PROVIDER_CAPABILITIES.here;

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async fetchMatrix(
    request: GatewayMatrixRequest,
    signal: AbortSignal,
  ): Promise<ProviderFetchResult> {
    const locations = allLocations(request);
    const url = new URL('https://matrix.router.hereapi.com/v8/matrix');
    url.searchParams.set('async', 'false');
    url.searchParams.set('apiKey', this.apiKey);
    const requestBody = {
      origins: locations.map(toHereLocation),
      destinations: locations.map(toHereLocation),
      regionDefinition: { type: 'autoCircle' },
      matrixAttributes: ['travelTimes', 'distances'],
      routingMode: 'fast',
      transportMode: request.vehicle.type === 'truck' ? 'truck' : 'car',
      departureTime:
        request.trafficMode === 'none'
          ? 'any'
          : normalizeGoogleDepartureAt(request.departureAt),
      ...(request.vehicle.type === 'truck' &&
      request.vehicle.useRoadRestrictions
        ? { vehicle: toHereVehicle(request) }
        : {}),
    };
    const { payload, headers, responseMs } = await fetchProviderJson({
      provider: 'HERE',
      url: url.toString(),
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.matrixId,
        },
        body: JSON.stringify(requestBody),
        signal,
      },
      fetcher: this.fetcher,
    });
    return normalizeHereMatrix(payload, request, responseMs, headers);
  }
}

export function normalizeHereMatrix(
  input: unknown,
  request: GatewayMatrixRequest,
  responseMs: number,
  headers = new Headers(),
): ProviderFetchResult {
  if (!input || typeof input !== 'object') {
    invalidProviderPayload('HERE', 'trūksta objekto');
  }
  const payload = input as HereMatrixPayload;
  const matrix = payload.matrix;
  const locations = allLocations(request);
  const size = locations.length;
  const count = size * size;
  if (
    !matrix ||
    matrix.numOrigins !== size ||
    matrix.numDestinations !== size ||
    !Array.isArray(matrix.travelTimes) ||
    !Array.isArray(matrix.distances) ||
    matrix.travelTimes.length !== count ||
    matrix.distances.length !== count
  ) {
    invalidProviderPayload('HERE', 'matricos dydis arba atributai');
  }
  const errors =
    Array.isArray(matrix.errorCodes) && matrix.errorCodes.length === count
      ? matrix.errorCodes
      : Array(count).fill(0);
  const warnings = new Set<string>();
  const cells: MatrixCell[][] = Array.from({ length: size }, (_, origin) =>
    Array.from({ length: size }, (_, destination) => {
      const index = origin * size + destination;
      const code = errors[index] ?? 0;
      const distance = matrix.distances![index];
      const duration = matrix.travelTimes![index];
      const reachable =
        (code === 0 || code === 3) &&
        Number.isFinite(distance) &&
        Number.isFinite(duration);
      const restrictionWarnings: string[] = [];
      if (code === 3) {
        restrictionWarnings.push('HERE_ROUTE_WITH_VIOLATIONS');
        warnings.add('Kai kurios HERE atkarpos apskaičiuotos su apribojimų pažeidimais.');
      } else if (code !== 0) {
        warnings.add(`HERE matricoje yra nepasiekiamų atkarpų (kodas ${code}).`);
      }
      return {
        distanceKm: reachable ? distance / 1000 : null,
        durationMinutes: reachable ? duration / 60 : null,
        reachable,
        maneuverPenalty: 0,
        restrictionWarnings,
      };
    }),
  );
  const reachableCount = cells.flat().filter((cell) => cell.reachable).length;
  warnings.add('HERE Matrix API nepateikia palyginamos manevrų metrikos.');
  return {
    matrix: {
      provider: 'HERE',
      executionMode: 'real',
      nodeIds: locations.map(({ id }) => id),
      cells,
      fetchedAt: new Date().toISOString(),
      trafficMode: request.trafficMode,
      departureAt: request.departureAt,
      warnings: [...warnings],
      version: 'here-matrix-v8-1',
    },
    providerRequestId:
      payload.matrixId ??
      headers.get('x-request-id') ??
      headers.get('x-correlation-id'),
    responseMs,
    completenessRatio: reachableCount / count,
    warnings: [...warnings],
  };
}

function allLocations(request: GatewayMatrixRequest): RoutingLocation[] {
  return [request.startLocation, ...request.stops, request.endLocation];
}

function toHereLocation(location: RoutingLocation) {
  return { lat: location.latitude, lng: location.longitude };
}

function toHereVehicle(request: GatewayMatrixRequest) {
  const vehicle = request.vehicle;
  return {
    ...(vehicle.grossWeightKg
      ? {
          grossWeight: Math.round(vehicle.grossWeightKg),
          currentWeight: Math.round(vehicle.grossWeightKg),
        }
      : {}),
    ...(vehicle.heightM
      ? { height: Math.round(vehicle.heightM * 100) }
      : {}),
    ...(vehicle.widthM ? { width: Math.round(vehicle.widthM * 100) } : {}),
    ...(vehicle.lengthM
      ? { length: Math.round(vehicle.lengthM * 100) }
      : {}),
  };
}

