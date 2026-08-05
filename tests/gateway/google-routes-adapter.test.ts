import { describe, expect, it, vi } from 'vitest';
import {
  GoogleRoutesAdapter,
  normalizeGoogleComputeRoutes,
} from '../../gateway/providers/google-routes-adapter';
import type { GatewayPolylineRequest } from '../../gateway/types';

function polylineRequest(): GatewayPolylineRequest {
  return {
    schemaVersion: '1',
    provider: 'google',
    startLocation: { id: 'start', label: 'Startas', latitude: 54.68, longitude: 25.27 },
    orderedStops: [
      { id: 'stop-2', label: 'Antras', latitude: 54.70, longitude: 25.29 },
      { id: 'stop-1', label: 'Pirmas', latitude: 54.69, longitude: 25.28 },
    ],
    endLocation: { id: 'end', label: 'Pabaiga', latitude: 54.73, longitude: 25.23 },
    departureAt: '2026-08-03T04:30:00.000Z',
    trafficMode: 'live',
  };
}

describe('GoogleRoutesAdapter (computeRoutes API v2)', () => {
  it('constructs correct HTTP request and normalizes encodedPolyline response', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
      expect(init?.headers).toMatchObject({
        'content-type': 'application/json',
        'x-goog-api-key': 'server-key',
      });
      const body = JSON.parse(String(init?.body));
      expect(body.origin.location.latLng).toEqual({ latitude: 54.68, longitude: 25.27 });
      expect(body.destination.location.latLng).toEqual({ latitude: 54.73, longitude: 25.23 });
      expect(body.intermediates).toHaveLength(2);
      expect(body.intermediates[0].location.latLng).toEqual({ latitude: 54.70, longitude: 25.29 });
      expect(body.travelMode).toBe('DRIVE');
      expect(body.routingPreference).toBe('TRAFFIC_AWARE');
      expect(Date.parse(body.departureTime)).toBeGreaterThan(Date.now());

      return new Response(
        JSON.stringify({
          routes: [
            {
              distanceMeters: 18500,
              duration: '1440s',
              polyline: {
                encodedPolyline: '_p~iF~ps|U_ulLnnqC_gH',
              },
              legs: [
                {
                  distanceMeters: 5500,
                  duration: '420s',
                  polyline: { encodedPolyline: '_p~iF~ps|U' },
                },
                {
                  distanceMeters: 6000,
                  duration: '480s',
                  polyline: { encodedPolyline: '_ulLnnqC' },
                },
                {
                  distanceMeters: 7000,
                  duration: '540s',
                  polyline: { encodedPolyline: '_gH' },
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const adapter = new GoogleRoutesAdapter('server-key', fetcher as typeof fetch);
    const result = await adapter.fetchRoutePolyline(polylineRequest());

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.provider).toBe('Google Routes');
    expect(result.encodedPolyline).toBe('_p~iF~ps|U_ulLnnqC_gH');
    expect(result.distanceMeters).toBe(18500);
    expect(result.durationSeconds).toBe(1440);
    expect(result.legs).toHaveLength(3);
    expect(result.legs[0]).toEqual({
      distanceMeters: 5500,
      durationSeconds: 420,
      encodedPolyline: '_p~iF~ps|U',
    });
  });

  it('throws PROVIDER_INVALID_RESPONSE if routes payload is empty', () => {
    expect(() => normalizeGoogleComputeRoutes({})).toThrowError();
    expect(() => normalizeGoogleComputeRoutes({ routes: [] })).toThrowError();
  });
});
