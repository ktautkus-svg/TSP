import { GatewayError } from '../errors';
import type { GatewayGeocodeRequest, GeocodeCandidate } from '../types';
import { fetchProviderJson, invalidProviderPayload } from './adapter-utils';

type GoogleGeocodeResult = {
  formatted_address?: string;
  place_id?: string;
  types?: string[];
  geometry?: {
    location?: { lat?: number; lng?: number };
    location_type?: string;
  };
  partial_match?: boolean;
};

type GoogleGeocodePayload = {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodeResult[];
};

export class GoogleGeocodingAdapter {
  readonly version = 'google-geocoding-v1';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async geocode(request: GatewayGeocodeRequest, signal?: AbortSignal) {
    const query = new URLSearchParams({
      address: request.address,
      language: request.language,
      region: request.region,
      // region is only a soft bias — Google can still match an address in a
      // different country. components=country:LT hard-restricts results so a
      // short/ambiguous street name can't resolve to e.g. Scandinavia/Russia.
      components: 'country:LT',
      key: this.apiKey,
    });
    const { payload, responseMs } = await fetchProviderJson({
      provider: 'Google Geocoding',
      url: `https://maps.googleapis.com/maps/api/geocode/json?${query.toString()}`,
      init: { method: 'GET', signal },
      fetcher: this.fetcher,
    });
    return { candidates: normalizeGoogleGeocoding(payload), responseMs };
  }
}

export function normalizeGoogleGeocoding(payload: unknown): GeocodeCandidate[] {
  if (!payload || typeof payload !== 'object') {
    invalidProviderPayload('Google Geocoding', 'tikėtasi objekto');
  }
  const response = payload as GoogleGeocodePayload;
  if (response.status === 'ZERO_RESULTS') return [];
  if (response.status !== 'OK') {
    if (response.status === 'REQUEST_DENIED') {
      throw new GatewayError(
        'CONFIGURATION_ERROR',
        'Google Geocoding API neįjungta arba serverio raktui neleidžiama jos naudoti.',
        503,
        false,
        { provider: 'Google Geocoding', status: 'REQUEST_DENIED' },
      );
    }
    throw new GatewayError(
      response.status === 'OVER_QUERY_LIMIT' ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_INVALID_RESPONSE',
      'Google Geocoding nepavyko saugiai apdoroti adreso.',
      response.status === 'OVER_QUERY_LIMIT' ? 503 : 502,
      response.status === 'OVER_QUERY_LIMIT',
      { provider: 'Google Geocoding', status: response.status ?? 'UNKNOWN' },
    );
  }
  if (!Array.isArray(response.results)) {
    invalidProviderPayload('Google Geocoding', 'nėra rezultatų masyvo');
  }
  return response.results.slice(0, 5).map((item) => {
    const latitude = item.geometry?.location?.lat;
    const longitude = item.geometry?.location?.lng;
    if (
      !item.formatted_address ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      invalidProviderPayload('Google Geocoding', 'rezultate trūksta adreso arba koordinačių');
    }
    return {
      normalizedAddress: item.formatted_address,
      latitude: latitude!,
      longitude: longitude!,
      placeId: item.place_id ?? null,
      locationType: item.geometry?.location_type ?? 'UNKNOWN',
      resultTypes: Array.isArray(item.types) ? item.types.filter((value) => typeof value === 'string') : [],
    };
  });
}
