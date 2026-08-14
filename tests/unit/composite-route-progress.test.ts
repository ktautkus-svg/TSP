import { describe, expect, it } from 'vitest';

import { calculateCompositeRouteProgress } from '../../src/application/routes/composite-route-progress';

describe('composite route progress', () => {
  it('combines stops, handled weight and completed planned distance using 40/40/20 weights', () => {
    const progress = calculateCompositeRouteProgress({
      completedStops: 4,
      totalStops: 10,
      processedWeightKg: 1_200,
      totalWeightKg: 1_500,
      completedDistanceKm: 250,
      totalDistanceKm: 500,
    });

    expect(progress).toMatchObject({ stopsFraction: 0.4, weightFraction: 0.8, distanceFraction: 0.5 });
    expect(progress.fraction).toBeCloseTo(0.58);
  });

  it('falls back to stop progress when weight or distance is unavailable', () => {
    expect(calculateCompositeRouteProgress({
      completedStops: 2,
      totalStops: 5,
      processedWeightKg: 0,
      totalWeightKg: 0,
      completedDistanceKm: 0,
      totalDistanceKm: null,
    }).fraction).toBeCloseTo(0.4);
  });

  it('clamps abnormal inputs and forces a completed route to 100 percent', () => {
    expect(calculateCompositeRouteProgress({
      completedStops: 10,
      totalStops: 10,
      processedWeightKg: 2_000,
      totalWeightKg: 1_500,
      completedDistanceKm: 800,
      totalDistanceKm: 500,
      completed: true,
    })).toEqual({ fraction: 1, stopsFraction: 1, weightFraction: 1, distanceFraction: 1 });
  });
});
