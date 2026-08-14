export const COMPOSITE_ROUTE_PROGRESS_WEIGHTS = {
  stops: 0.4,
  weight: 0.4,
  distance: 0.2,
} as const;

export type CompositeRouteProgressInput = {
  completedStops: number;
  totalStops: number;
  processedWeightKg: number;
  totalWeightKg: number;
  completedDistanceKm: number | null;
  totalDistanceKm: number | null;
  completed?: boolean;
};

export type CompositeRouteProgress = {
  fraction: number;
  stopsFraction: number;
  weightFraction: number;
  distanceFraction: number;
};

/**
 * Operational route progress. Stops and handled cargo carry most of the score;
 * planned distance is deliberately capped at 20%, so driving without making
 * deliveries cannot make a route look nearly complete.
 */
export function calculateCompositeRouteProgress(input: CompositeRouteProgressInput): CompositeRouteProgress {
  const stopsFraction = ratio(input.completedStops, input.totalStops, 0);
  const weightFraction = ratio(input.processedWeightKg, input.totalWeightKg, stopsFraction);
  const distanceFraction = ratio(input.completedDistanceKm, input.totalDistanceKm, stopsFraction);

  if (input.completed && input.totalStops > 0) {
    return { fraction: 1, stopsFraction: 1, weightFraction: 1, distanceFraction: 1 };
  }

  return {
    fraction: clamp(
      stopsFraction * COMPOSITE_ROUTE_PROGRESS_WEIGHTS.stops
      + weightFraction * COMPOSITE_ROUTE_PROGRESS_WEIGHTS.weight
      + distanceFraction * COMPOSITE_ROUTE_PROGRESS_WEIGHTS.distance,
    ),
    stopsFraction,
    weightFraction,
    distanceFraction,
  };
}

function ratio(value: number | null, total: number | null, fallback: number): number {
  if (value === null || total === null || !Number.isFinite(total) || total <= 0) return fallback;
  return clamp((Number.isFinite(value) ? value : 0) / total);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
