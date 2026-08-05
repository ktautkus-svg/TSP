import {
  gatewayEndpoint,
  normalizeEndpoint,
  platformFetch,
  readSafeGatewayError,
} from './gateway-client';

export type GeocodeCandidate = {
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
  locationType: string;
  resultTypes: string[];
};

export type GeocodeResponse = {
  query: string;
  isUnambiguous: boolean;
  result: GeocodeCandidate | null;
  alternatives: GeocodeCandidate[];
  executionMode: 'real' | 'cache';
  gatewayMetadata: {
    cacheHit: boolean;
    externalRequestCount: number;
    providerResponseMs: number;
  };
};

export class GatewayGeocodingProvider {
  readonly endpoint: string;

  constructor(
    endpoint: string = gatewayEndpoint('/v1/geocode'),
    readonly fetcher: typeof fetch = platformFetch,
  ) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  async geocode(address: string): Promise<GeocodeResponse> {
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!response.ok) {
      const safe = await readSafeGatewayError(
        response,
        `Gateway geokodavimo užklausa atmesta su HTTP ${response.status}.`,
      );
      const error = new Error(
        safe.code ? `[${safe.code}] ${safe.message}` : safe.message,
      ) as Error & { code?: string; statusCode?: number };
      if (safe.code) error.code = safe.code;
      error.statusCode = response.status;
      throw error;
    }
    return (await response.json()) as GeocodeResponse;
  }
}
