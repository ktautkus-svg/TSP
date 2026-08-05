import { InvalidMatrixError, ProviderRequestError } from '@/domain/routing/errors';
import type {
  MatrixRequest,
  ProviderExecutionMode,
  TrafficMode,
  TravelCostProvider,
  TravelMatrix,
} from '@/domain/routing/models';
import {
  gatewayEndpoint,
  normalizeEndpoint,
  platformFetch,
  readSafeGatewayError,
} from './gateway-client';

type GatewayMatrixResponse = {
  provider: string;
  executionMode?: ProviderExecutionMode;
  nodeIds: string[];
  cells: TravelMatrix['cells'];
  fetchedAt?: string;
  trafficMode?: TrafficMode;
  departureAt?: string;
  warnings?: string[];
  version?: string;
};

export type GatewayRequestAuthorizer = (
  rawBody: string,
) => Promise<Record<string, string>> | Record<string, string>;

export class GatewayTravelCostProvider implements TravelCostProvider {
  readonly endpoint: string;

  constructor(
    readonly name: string,
    endpoint: string = gatewayEndpoint('/v1/matrix'),
    readonly fetcher: typeof fetch = platformFetch,
    private readonly authorize: GatewayRequestAuthorizer = () => ({}),
  ) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  async getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      if (request.locations.length < 3) {
        throw new InvalidMatrixError(
          'Gateway užklausai reikia starto, bent vieno taško ir pabaigos.',
        );
      }
      const rawBody = JSON.stringify({
        schemaVersion: '1',
        provider: this.name,
        matrixId: `${this.name}-${Date.now()}`,
        startLocation: request.locations[0],
        stops: request.locations.slice(1, -1),
        endLocation: request.locations.at(-1),
        departureAt: request.departureAt,
        trafficMode: request.trafficMode === 'synthetic' ? 'none' : request.trafficMode,
        vehicle: request.vehicle,
        language: 'lt-LT',
        regionCode: 'LT',
      });
      const authorizationHeaders = await this.authorize(rawBody);
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authorizationHeaders },
        body: rawBody,
        signal: controller.signal,
      });
      if (!response.ok) {
        const safe = await readSafeGatewayError(
          response,
          response.status === 429
            ? 'Viršytas gateway užklausų limitas.'
            : `Gateway grąžino HTTP ${response.status}.`,
        );
        throw new ProviderRequestError(
          safe.code ? `[${safe.code}] ${safe.message}` : safe.message,
          this.name,
          response.status,
          { ...(safe.code ? { code: safe.code } : {}), message: safe.message },
        );
      }
      const payload = (await response.json()) as GatewayMatrixResponse;
      validateGatewayMatrix(payload, request);
      return {
        provider: payload.provider,
        executionMode: payload.executionMode ?? 'real',
        nodeIds: payload.nodeIds,
        cells: payload.cells,
        fetchedAt: payload.fetchedAt ?? new Date().toISOString(),
        trafficMode: payload.trafficMode ?? request.trafficMode,
        departureAt: payload.departureAt ?? request.departureAt,
        warnings: payload.warnings ?? [],
        version: payload.version ?? 'gateway-v1',
      };
    } catch (error) {
      if (error instanceof ProviderRequestError || error instanceof InvalidMatrixError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderRequestError('Gateway užklausa viršijo laiko limitą.', this.name, undefined, {
          reason: 'TIMEOUT',
        });
      }
      throw new ProviderRequestError(
        error instanceof Error ? error.message : 'Nežinoma tinklo klaida.',
        this.name,
        undefined,
        { reason: 'NETWORK_ERROR' },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class HereTravelCostProvider extends GatewayTravelCostProvider {
  constructor(
    endpoint: string = gatewayEndpoint('/v1/matrix'),
    fetcher?: typeof fetch,
    authorize?: GatewayRequestAuthorizer,
  ) {
    super('here', endpoint, fetcher, authorize);
  }
}

export class GoogleTravelCostProvider extends GatewayTravelCostProvider {
  constructor(
    endpoint: string = gatewayEndpoint('/v1/matrix'),
    fetcher?: typeof fetch,
    authorize?: GatewayRequestAuthorizer,
  ) {
    super('google', endpoint, fetcher, authorize);
  }
}

function validateGatewayMatrix(payload: GatewayMatrixResponse, request: MatrixRequest): void {
  const expected = request.locations.length;
  if (
    payload.nodeIds?.length !== expected ||
    payload.cells?.length !== expected ||
    payload.cells.some((row) => row.length !== expected)
  ) {
    throw new InvalidMatrixError(
      `Tikėtasi ${expected}×${expected} matricos, gautas neteisingas dydis.`,
    );
  }
  for (const row of payload.cells) {
    for (const cell of row) {
      if (
        typeof cell.reachable !== 'boolean' ||
        (cell.reachable &&
          (cell.distanceKm === null ||
            cell.durationMinutes === null ||
            cell.distanceKm < 0 ||
            cell.durationMinutes < 0))
      ) {
        throw new InvalidMatrixError('Gateway matricoje yra neteisinga celė.');
      }
    }
  }
}
