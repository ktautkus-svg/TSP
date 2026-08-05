import type { RoutePolylineResult, RoutingLocation, TrafficMode } from '@/domain/routing/models';
import {
  gatewayEndpoint,
  normalizeEndpoint,
  platformFetch,
  readSafeGatewayError,
} from './gateway-client';

export type FetchPolylineParams = {
  startLocation: RoutingLocation;
  orderedStops: RoutingLocation[];
  endLocation: RoutingLocation;
  departureAt?: string;
  trafficMode?: TrafficMode;
};

export class GatewayPolylineProvider {
  readonly gatewayEndpoint: string;

  constructor(
    endpoint: string = gatewayEndpoint('/v1/polyline'),
    readonly fetcher: typeof fetch = platformFetch,
  ) {
    this.gatewayEndpoint = normalizeEndpoint(endpoint);
  }

  async fetchPolyline(params: FetchPolylineParams): Promise<RoutePolylineResult> {
    const rawBody = JSON.stringify({
      schemaVersion: '1',
      provider: 'google',
      startLocation: params.startLocation,
      orderedStops: params.orderedStops,
      endLocation: params.endLocation,
      departureAt: params.departureAt,
      trafficMode: params.trafficMode === 'synthetic' ? 'none' : params.trafficMode ?? 'live',
      language: 'lt-LT',
      regionCode: 'LT',
    });
    const response = await this.fetcher(this.gatewayEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
    });
    if (!response.ok) {
      const safe = await readSafeGatewayError(
        response,
        `Gateway polyline užklausa atmesta su HTTP ${response.status}.`,
      );
      const error = new Error(
        safe.code ? `[${safe.code}] ${safe.message}` : safe.message,
      ) as Error & { code?: string; statusCode?: number };
      if (safe.code) error.code = safe.code;
      error.statusCode = response.status;
      throw error;
    }
    return (await response.json()) as RoutePolylineResult;
  }
}
