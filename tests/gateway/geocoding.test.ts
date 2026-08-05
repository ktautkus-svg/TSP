import { describe, expect, it, vi } from 'vitest';

import { MemoryGatewayResponseCache } from '../../gateway/cache/file-response-cache';
import { MemoryMatrixResultCache } from '../../gateway/cache/file-matrix-cache';
import { loadGatewayConfig } from '../../gateway/config';
import { GoogleGeocodingAdapter, normalizeGoogleGeocoding } from '../../gateway/providers/google-geocoding-adapter';
import { OptimizationGatewayService } from '../../gateway/service';
import { parseGatewayGeocodeRequest } from '../../gateway/validation';
import type { MatrixProviderAdapter } from '../../gateway/types';

const unusedAdapter = {
  provider: 'google',
  version: 'test',
  capabilities: {
    trafficSupported: true,
    predictiveTrafficSupported: true,
    truckRestrictionsSupported: false,
    vehicleDimensionsSupported: false,
    asymmetricMatrixSupported: true,
    departureTimeSupported: true,
    maneuverMetadataSupported: false,
    maximumMatrixElements: 100,
    executionMode: 'real',
  },
  fetchMatrix: vi.fn(),
} satisfies MatrixProviderAdapter;

describe('gateway geocoding', () => {
  it('maps a disabled Geocoding API to a safe configuration error', () => {
    expect(() => normalizeGoogleGeocoding({
      status: 'REQUEST_DENIED',
      error_message: 'upstream details must not reach the client',
      results: [],
    })).toThrowError(expect.objectContaining({
      code: 'CONFIGURATION_ERROR',
      message: 'Google Geocoding API neįjungta arba serverio raktui neleidžiama jos naudoti.',
    }));
  });

  it('validates, trims and limits an address', () => {
    expect(parseGatewayGeocodeRequest({ address: '  Gedimino   pr. 9, Vilnius  ' }).address)
      .toBe('Gedimino pr. 9, Vilnius');
    expect(() => parseGatewayGeocodeRequest({ address: 'x' })).toThrow();
    expect(() => parseGatewayGeocodeRequest({ address: 'a'.repeat(301) })).toThrow();
    expect(() => parseGatewayGeocodeRequest({ address: 'Validus 1', url: 'https://evil.test' })).toThrow();
  });

  it('normalizes safe candidates and does not select among multiple results', async () => {
    const payload = {
      status: 'OK',
      results: [
        { formatted_address: 'A g. 1, Vilnius', place_id: 'a', types: ['street_address'], geometry: { location: { lat: 54.7, lng: 25.3 }, location_type: 'ROOFTOP' } },
        { formatted_address: 'A g. 1, Kaunas', place_id: 'b', types: ['street_address'], geometry: { location: { lat: 54.9, lng: 23.9 }, location_type: 'RANGE_INTERPOLATED' } },
      ],
    };
    expect(normalizeGoogleGeocoding(payload)).toHaveLength(2);
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(payload));
    const geocoder = new GoogleGeocodingAdapter('server-secret', fetcher as typeof fetch);
    const service = new OptimizationGatewayService(
      loadGatewayConfig({ GOOGLE_ROUTES_API_KEY: 'server-secret' }),
      { google: unusedAdapter, here: { ...unusedAdapter, provider: 'here' } },
      new MemoryMatrixResultCache(),
      undefined,
      undefined,
      geocoder,
      new MemoryGatewayResponseCache(),
    );
    const request = parseGatewayGeocodeRequest({ address: 'A g. 1, Lietuva' });
    const first = await service.geocode(request);
    const second = await service.geocode(request);
    expect(first.isUnambiguous).toBe(false);
    expect(first.result).toBeNull();
    expect(first.alternatives).toHaveLength(2);
    expect(first.gatewayMetadata.externalRequestCount).toBe(1);
    expect(second.executionMode).toBe('cache');
    expect(second.gatewayMetadata.externalRequestCount).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('maps.googleapis.com/maps/api/geocode/json');
  });

  it('sends a hard country restriction alongside the region bias', async () => {
    const payload = {
      status: 'OK',
      results: [
        { formatted_address: 'A g. 1, Vilnius', place_id: 'a', types: ['street_address'], geometry: { location: { lat: 54.7, lng: 25.3 }, location_type: 'ROOFTOP' } },
      ],
    };
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(payload));
    const geocoder = new GoogleGeocodingAdapter('server-secret', fetcher as typeof fetch);
    await geocoder.geocode(parseGatewayGeocodeRequest({ address: 'A g. 1, Lietuva' }));
    expect(String(fetcher.mock.calls[0][0])).toContain('components=country%3ALT');
  });

  it('refuses to auto-accept a single geographically implausible result (wrong country)', async () => {
    const payload = {
      status: 'OK',
      results: [
        // A single confident-looking match, but far outside Lithuania (e.g. Scandinavia).
        { formatted_address: 'Vilties gata 10, Stockholm, Sweden', place_id: 'z', types: ['street_address'], geometry: { location: { lat: 59.33, lng: 18.06 }, location_type: 'ROOFTOP' } },
      ],
    };
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(payload));
    const geocoder = new GoogleGeocodingAdapter('server-secret', fetcher as typeof fetch);
    const service = new OptimizationGatewayService(
      loadGatewayConfig({ GOOGLE_ROUTES_API_KEY: 'server-secret' }),
      { google: unusedAdapter, here: { ...unusedAdapter, provider: 'here' } },
      new MemoryMatrixResultCache(),
      undefined,
      undefined,
      geocoder,
      new MemoryGatewayResponseCache(),
    );
    const response = await service.geocode(parseGatewayGeocodeRequest({ address: 'Vilties g. 10' }));
    expect(response.isUnambiguous).toBe(false);
    expect(response.result).toBeNull();
    // The raw candidate is still surfaced as an alternative for visibility/debugging.
    expect(response.alternatives).toHaveLength(1);
  });
});
