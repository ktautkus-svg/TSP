import { routingCoordinates } from '@/domain/location-park-memory';
import { createBaseRequest } from '@/domain/routing/scenarios';
import type { OptimizationStop, RouteOptimizationRequest } from '@/domain/routing/models';
import type { DeliveryStop, Route } from '@/domain/route';

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
  options: { priorityRank?: number; deliverBeforeStopIds?: string[] } = {},
): OptimizationStop {
  const coords = routingCoordinates(stop);
  if (stop.addressValidationState !== 'auto_confirmed' || !coords || !stop.normalizedAddress) {
    throw new Error(`Taškas „${stop.originalAddress}“ dar neturi patvirtintų koordinačių.`);
  }
  const priorityRank = options.priorityRank ?? (stop.priorityFirst ? 1 : 0);
  return {
    id: stop.id,
    location: {
      id: stop.id,
      label: stop.recipient || stop.normalizedAddress,
      address: stop.normalizedAddress,
      latitude: coords.latitude,
      longitude: coords.longitude,
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
    // Higher rank → earlier along the way; other stops may still insert between.
    priority: priorityRank > 0 ? Math.max(2, 12 - priorityRank) : 1,
    deliverBeforeStopIds: options.deliverBeforeStopIds ?? [],
    deliverAfterStopIds: [],
    preferEarly: priorityRank > 0,
    preferLate: false,
    mustBeFirst: false,
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
    if (stop.addressValidationState !== 'auto_confirmed' || !routingCoordinates(stop) || !stop.normalizedAddress) {
      throw new Error(`Taškas „${stop.originalAddress}“ dar neturi patvirtintų koordinačių.`);
    }
  }
  const base = createBaseRequest(stops.length);
  // Keep the driver's chosen start (e.g. 04:00) even when planning the night
  // before. Live "from now" ETAs begin only after StartRoute. Providers that
  // refuse a past departureTime bump it themselves in the gateway adapters.
  const plannedDepartureAt = resolvePlannedDeparture(route.plannedDepartureAt);
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
  const priorityOrdered = stops
    .filter((stop) => stop.priorityFirst)
    .sort((left, right) =>
      (left.priorityRank ?? Number.MAX_SAFE_INTEGER) - (right.priorityRank ?? Number.MAX_SAFE_INTEGER)
      || left.originalOrder - right.originalOrder
      || left.id.localeCompare(right.id));
  const priorityRankById = new Map(priorityOrdered.map((stop, index) => [stop.id, index + 1]));
  const optimizationStops = stops.map((stop) => {
    const rank = priorityRankById.get(stop.id) ?? 0;
    const nextPriority = rank > 0 ? priorityOrdered[rank]?.id : undefined;
    return buildOptimizationStop(stop, route, plannedDepartureAt, {
      priorityRank: rank,
      deliverBeforeStopIds: nextPriority ? [nextPriority] : [],
    });
  });
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
    // createBaseRequest's maxIterations/maxCalculationMs/randomSeeds are sized
    // for fast, deterministic unit tests (2 iterations, 1s), not for actually
    // solving a real multi-stop route: local search's neighbourhood generator
    // yields swap moves, then reversals, then relocations, capped at
    // min(300, stopCount^2) evaluations per iteration — for a route with more
    // than a handful of stops, that cap is exhausted by swaps+reversals alone,
    // so the relocate moves (the ones that fix a single mis-sequenced stop,
    // e.g. a far-away address slotted mid-route by a time-window heuristic)
    // are barely reached, and 2 iterations rarely escapes a bad starting seed.
    // NOTE: this budget applies PER heuristic seed (routing-engine.ts runs
    // local search once per seed, ~14 seeds), so it is not a global cap —
    // measured against a real 16-stop/1-outlier route, 8 iterations / 2s per
    // seed already captured ~95% of the improvement 32 iterations / 8s gave
    // (173.7km vs 173.6km), while quadrupling the wall-clock cost (~8s vs
    // ~21s total). Past that point more search mostly just re-confirms the
    // same local optimum — it does not fix a badly-shaped starting sequence,
    // which is a scoring-function problem, not a search-budget one. Scale
    // modestly with stop count instead of maxing out the knob.
    ...searchBudgetFor(optimizationStops.length),
    vehicle: {
      ...base.vehicle,
      startLocation,
      defaultEndLocation: endLocation,
    },
  };
}

function searchBudgetFor(
  stopCount: number,
): Pick<RouteOptimizationRequest, 'maxIterations' | 'maxCalculationMs' | 'maxTotalCalculationMs' | 'randomSeeds'> {
  const perSeedMs = Math.min(2_500, Math.max(1_200, stopCount * 150));
  return {
    maxIterations: Math.min(15, Math.max(6, Math.round(stopCount * 0.5))),
    maxCalculationMs: perSeedMs,
    // 16 seeds x perSeedMs would be up to 40 s of frozen UI. All seeds are still
    // evaluated; only refinement stops once this shared budget runs out.
    maxTotalCalculationMs: Math.max(perSeedMs, Math.min(4_000, stopCount * 120)),
    randomSeeds: [7, 42, 2026, 101, 512],
  };
}

function requireEndpoint(endpoint: Route['startLocation'], label: string) {
  if (!endpoint?.normalizedAddress || endpoint.latitude === null || endpoint.longitude === null) {
    throw new Error(`Maršruto ${label} vieta nepatvirtinta.`);
  }
  return endpoint;
}

function resolvePlannedDeparture(value: string | null): string {
  if (!value) return new Date().toISOString();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Neteisingas planuojamo išvykimo laikas.');
  return value;
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
