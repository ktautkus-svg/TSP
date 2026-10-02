import { describe, expect, it } from 'vitest';

import {
  estimateLoadingMinutes,
  loadingMinutesBetween,
  type LoadingHistorySample,
} from '../../src/application/routes/loading-duration';

describe('loadingMinutesBetween', () => {
  it('measures the gap from loading start to route start', () => {
    expect(
      loadingMinutesBetween('2026-09-02T05:30:00.000Z', '2026-09-02T06:12:00.000Z'),
    ).toBe(42);
  });

  it('returns null when either timestamp is missing', () => {
    expect(loadingMinutesBetween(null, '2026-09-02T06:12:00.000Z')).toBeNull();
    expect(loadingMinutesBetween('2026-09-02T05:30:00.000Z', null)).toBeNull();
  });

  it('returns null when the route started before loading (bad data)', () => {
    expect(
      loadingMinutesBetween('2026-09-02T06:12:00.000Z', '2026-09-02T05:30:00.000Z'),
    ).toBeNull();
  });

  it('discards an overnight gap that is not a real loading duration', () => {
    expect(
      loadingMinutesBetween('2026-09-01T18:00:00.000Z', '2026-09-02T07:00:00.000Z'),
    ).toBeNull();
  });
});

describe('estimateLoadingMinutes', () => {
  const history: LoadingHistorySample[] = [
    { minutes: 40, weightKg: 1200, stops: 12 },
    { minutes: 55, weightKg: 2400, stops: 20 },
    { minutes: 25, weightKg: 500, stops: 6 },
  ];

  it('leans toward the closest past loadings by weight and stop count', () => {
    const light = estimateLoadingMinutes(history, 550, 6);
    const heavy = estimateLoadingMinutes(history, 2300, 19);
    expect(light).toBeLessThan(heavy);
    expect(light).toBeGreaterThanOrEqual(20);
    expect(heavy).toBeLessThanOrEqual(60);
  });

  it('falls back to a size-based rule with no history', () => {
    expect(estimateLoadingMinutes([], 800, 10)).toBeGreaterThan(10);
  });

  it('never returns an implausibly small estimate', () => {
    expect(estimateLoadingMinutes([{ minutes: 1, weightKg: 100, stops: 1 }], 100, 1)).toBeGreaterThanOrEqual(5);
  });
});
