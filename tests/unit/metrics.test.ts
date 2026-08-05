import { describe, expect, it } from 'vitest';

import { calculateRouteMetrics } from '../../src/domain/metrics';

describe('calculateRouteMetrics', () => {
  it('counts only pending stops as remaining', () => {
    const metrics = calculateRouteMetrics([
      { weightKg: 10, deliveryStatus: 'delivered' },
      { weightKg: 20, deliveryStatus: 'failed' },
      { weightKg: 30, deliveryStatus: 'pending' },
    ]);

    expect(metrics).toMatchObject({
      totalStops: 3,
      remainingStops: 1,
      deliveredStops: 1,
      failedStops: 1,
      totalWeightKg: 60,
      remainingWeightKg: 30,
      deliveredWeightKg: 10,
    });
    expect(metrics.progressPercent).toBeCloseTo(100 / 3);
  });

  it('does not divide by zero for an empty draft', () => {
    expect(calculateRouteMetrics([]).progressPercent).toBe(0);
  });

  it('removes a retried failed stop from remaining after delivery', () => {
    expect(
      calculateRouteMetrics([{ weightKg: 12.5, deliveryStatus: 'delivered' }]),
    ).toMatchObject({
      remainingStops: 0,
      remainingWeightKg: 0,
      deliveredWeightKg: 12.5,
      progressPercent: 100,
    });
  });
});
