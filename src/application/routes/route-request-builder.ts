import { createBaseRequest } from '@/domain/routing/scenarios';
import type { OptimizationStop, RouteOptimizationRequest } from '@/domain/routing/models';
import type { DeliveryStop, Route } from '@/domain/route';
import { normalizeProviderDepartureAt } from '@/application/parsing/text-parser';

/**
 * Shared DeliveryStop -> OptimizationStop mapping, used both for the initial
 * plan (buildOptimizationRequestFromRoute) and for mid-route recalculation
 * (route-recalculation.ts), so a stop added after the route already started
 * gets exactly the same shape as one planned from the start.
 */
export function buildOptimizationStop(
  stop: DeliveryStop,
  route: Pick<Route, 'planningMode'>,
  plannedDepartureAt: string,
): OptimizationStop {
  if (stop.addressValidationState !== 'auto_confirmed' || stop.latitude === null || stop.longitude === null || !stop.normalizedAddress) {
    throw new Error(`Taškas „${stop.originalAddress}“ dar neturi patvirtintų koordinačių.`);
  }
  return {
    id: stop.id,
    location: {
      id: stop.id,
      label: stop.recipient || stop.normalizedAddress,
      address: stop.normalizedAddress,
      latitude: stop.latitude,
      longitude: stop.longitude,
    },
    weightKg: stop.weightKg,
    serviceDurationMinutes: stop.serviceDurationMinutes,
    informationalTimeWindow:
      stop.deliveryTimeFrom && stop.deliveryTimeTo
        ? absoluteWindow(stop.deliveryTimeFrom, stop.deliveryTimeTo, plannedDepartureAt)
        : undefined,
    requiredTimeWindow:
      route.planningMode === 'with_time_windows' && stop.requiredTimeWindow && stop.deliveryTimeFrom && stop.deliveryTimeTo
        ? absoluteWindow(stop.deliveryTimeFrom, stop.deliveryTimeTo, plannedDepartureAt)
        : undefined,
    priority: stop.priorityFirst ? 5 : 1,
    deliverBeforeStopIds: [],
    deliverAfterStopIds: [],
    preferEarly: false,
    preferLate: false,
    mustBeFirst: stop.priorityFirst,
    mustBeLast: false,
  };
}

export function buildOptimizationRequestFromRoute(
  route: Route,
  stops: DeliveryStop[],
): RouteOptimizationRequest {
  const start = requireEndpoint(route.startLocation, 'starto');
  const end = requireEndpoint(route.endLocation ?? route.startLocation, 'pabaigos');
  if (stops.length === 0) throw new Error('Maršrutas neturi pristatymo taškų.');
  for (const stop of stops) {
    if (
      stop.addressValidationState !== 'auto_confirmed' ||
      stop.latitude === null || stop.longitude === null || !stop.normalizedAddress
    ) {
      throw new Error(`Taškas „${stop.originalAddress}“ dar neturi patvirtintų koordinačių.`);
    }
  }
  const base = createBaseRequest(stops.length);
  const plannedDepartureAt = normalizeProviderDepartureAt(
    route.plannedDepartureAt ?? new Date().toISOString(),
  );
  const startLocation = {
    id: 'route-start',
    label: 'Startas',
    address: start.normalizedAddress!,
    latitude: start.latitude!,
    longitude: start.longitude!,
  };
  const endLocation = {
    id: 'route-end',
    label: 'Grįžimas',
    address: end.normalizedAddress!,
    latitude: end.latitude!,
    longitude: end.longitude!,
  };
  const optimizationStops = stops.map((stop) => buildOptimizationStop(stop, route, plannedDepartureAt));
  return {
    ...base,
    routeId: route.id,
    startLocation,
    endLocation,
    plannedDepartureAt,
    stops: optimizationStops,
    planningMode: route.planningMode ?? (optimizationStops.some((stop) => stop.requiredTimeWindow)
      ? 'with_time_windows'
      : 'ignore_time_windows'),
    trafficMode: 'live',
    // createBaseRequest is only a source of calibrated scoring/limits. Its
    // fixed synthetic workday date must never leak into a real route.
    workdayEndAt: undefined,
    vehicle: {
      ...base.vehicle,
      startLocation,
      defaultEndLocation: endLocation,
    },
  };
}

function requireEndpoint(endpoint: Route['startLocation'], label: string) {
  if (!endpoint?.normalizedAddress || endpoint.latitude === null || endpoint.longitude === null) {
    throw new Error(`Maršruto ${label} vieta nepatvirtinta.`);
  }
  return endpoint;
}

function absoluteWindow(from: string, to: string, departureAt: string) {
  const start = timeOnDay(from, departureAt);
  const end = timeOnDay(to, departureAt);
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function timeOnDay(value: string, day: string): Date {
  const result = new Date(day);
  const [hours, minutes] = value.split(':').map(Number);
  result.setHours(hours, minutes, 0, 0);
  return result;
}
