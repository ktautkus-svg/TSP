import type {
  RecalculationRequest,
  RecalculationResult,
  RouteOptimizer,
} from '@/domain/routing/models';

export async function recalculateRemainingRoute(
  optimizer: RouteOptimizer,
  input: RecalculationRequest,
): Promise<RecalculationResult> {
  const completed = new Set(input.completedStopIds);
  const remainingStops = input.originalRequest.stops.filter((stop) => !completed.has(stop.id));
  if (
    input.addedOrFailedStop &&
    !remainingStops.some((stop) => stop.id === input.addedOrFailedStop!.id)
  ) {
    remainingStops.push(input.addedOrFailedStop);
  }
  const optimization = await optimizer.optimize({
    ...input.originalRequest,
    routeId: `${input.originalRequest.routeId}-recalculation`,
    startLocation: input.currentLocation,
    plannedDepartureAt: input.currentTime,
    stops: remainingStops,
    initialLoadKg: input.remainingLoadKg,
  });
  const next = optimization.recommended;
  const previous = input.previousRemainingCandidate;
  return {
    optimization,
    preservedCompletedStopIds: [...input.completedStopIds],
    timeDeltaMinutes: next ? next.totalWorkMinutes - previous.totalWorkMinutes : null,
    distanceDeltaKm: next ? next.totalDistanceKm - previous.totalDistanceKm : null,
    changedStopIds: next
      ? next.stopSequence.filter((id, index) => previous.stopSequence[index] !== id)
      : [],
  };
}
