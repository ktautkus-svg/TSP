import type { RoutePolylineLeg, RoutePolylineResult } from '../../src/domain/routing/models';
import type { GatewayPolylineRequest } from '../types';
import { fetchProviderJson, invalidProviderPayload, normalizeGoogleDepartureAt } from './adapter-utils';

type GoogleRouteLegElement = {
  distanceMeters?: number;
  duration?: string;
  polyline?: {
    encodedPolyline?: string;
  };
  startLocation?: unknown;
  endLocation?: unknown;
};

type GoogleRouteElement = {
  distanceMeters?: number;
  duration?: string;
  polyline?: {
    encodedPolyline?: string;
  };
  legs?: GoogleRouteLegElement[];
};

type GoogleComputeRoutesResponse = {
  routes?: GoogleRouteElement[];
};

export class GoogleRoutesAdapter {
  readonly provider = 'google' as const;
  readonly version = 'google-compute-routes-v2';

  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async fetchRoutePolyline(
    request: GatewayPolylineRequest,
    signal?: AbortSignal,
  ): Promise<RoutePolylineResult> {
    const body = {
      origin: toGoogleWaypoint(request.startLocation),
      destination: toGoogleWaypoint(request.endLocation),
      intermediates: request.orderedStops.map(toGoogleWaypoint),
      travelMode: 'DRIVE',
      routingPreference:
        request.trafficMode === 'none' ? 'TRAFFIC_UNAWARE' : 'TRAFFIC_AWARE',
      ...(request.trafficMode && request.trafficMode !== 'none' && request.departureAt
        ? { departureTime: normalizeGoogleDepartureAt(request.departureAt) }
        : {}),
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
      languageCode: request.language ?? 'lt-LT',
      units: 'METRIC',
    };

    const { payload } = await fetchProviderJson({
      provider: 'Google Routes (ComputeRoutes)',
      url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask':
            'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation',
        },
        body: JSON.stringify(body),
        signal,
      },
      fetcher: this.fetcher,
    });

    return normalizeGoogleComputeRoutes(payload);
  }
}

export function normalizeGoogleComputeRoutes(
  payload: unknown,
): RoutePolylineResult {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as GoogleComputeRoutesResponse).routes) ||
    (payload as GoogleComputeRoutesResponse).routes!.length === 0
  ) {
    invalidProviderPayload('Google Routes', 'grąžintas tuščias maršrutų sąrašas');
  }

  const response = payload as GoogleComputeRoutesResponse;
  const route = response.routes![0];
  const encodedPolyline = route.polyline?.encodedPolyline ?? '';
  const distanceMeters = route.distanceMeters ?? 0;
  const durationSeconds = parseDurationSeconds(route.duration) ?? 0;

  const legs: RoutePolylineLeg[] = (route.legs ?? []).map((leg) => ({
    distanceMeters: leg.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(leg.duration) ?? 0,
    encodedPolyline: leg.polyline?.encodedPolyline ?? '',
    startLocation: leg.startLocation,
    endLocation: leg.endLocation,
  }));

  const warnings: string[] = [];
  if (!encodedPolyline) {
    warnings.push('Google Routes negrąžino encodedPolyline tekstinio rašto.');
  }

  return {
    provider: 'Google Routes',
    executionMode: 'real',
    encodedPolyline,
    distanceMeters,
    durationSeconds,
    legs,
    warnings,
    fetchedAt: new Date().toISOString(),
    version: 'google-compute-routes-v2',
  };
}

function toGoogleWaypoint(location: { latitude: number; longitude: number }) {
  return {
    location: {
      latLng: {
        latitude: location.latitude,
        longitude: location.longitude,
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
