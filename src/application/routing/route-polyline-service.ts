import type {
  RouteCandidate,
  RouteOptimizationRequest,
  RoutePolylineResult,
  RoutingLocation,
} from '@/domain/routing/models';
import type { GoogleRoutesAdapter } from '../../../gateway/providers/google-routes-adapter';

export function extractOrderedLocationsFromCandidate(
  candidate: RouteCandidate,
  request: RouteOptimizationRequest,
): {
  startLocation: RoutingLocation;
  orderedStops: RoutingLocation[];
  endLocation: RoutingLocation;
} {
  const stopMap = new Map(request.stops.map((stop) => [stop.id, stop.location]));
  const orderedStops = candidate.stopSequence
    .map((id) => stopMap.get(id))
    .filter((loc): loc is RoutingLocation => Boolean(loc));

  return {
    startLocation: request.startLocation,
    orderedStops,
    endLocation: request.endLocation,
  };
}

export class RoutePolylineService {
  constructor(private readonly routesAdapter: GoogleRoutesAdapter) {}

  async fetchPolylineForCandidate(
    candidate: RouteCandidate,
    request: RouteOptimizationRequest,
    signal?: AbortSignal,
  ): Promise<RoutePolylineResult> {
    const { startLocation, orderedStops, endLocation } =
      extractOrderedLocationsFromCandidate(candidate, request);

    return this.routesAdapter.fetchRoutePolyline(
      {
        schemaVersion: '1',
        provider: 'google',
        startLocation,
        orderedStops,
        endLocation,
        departureAt: request.plannedDepartureAt,
        trafficMode: request.trafficMode === 'synthetic' ? 'none' : request.trafficMode,
        language: 'lt-LT',
        regionCode: 'LT',
      },
      signal,
    );
  }
}
