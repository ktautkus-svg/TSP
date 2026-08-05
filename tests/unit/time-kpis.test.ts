import { describe, expect, it } from 'vitest';

import { calculateTimeKpis } from '../../src/application/services/time-kpis';

describe('time KPIs', () => {
  it('separates schedule performance from productive-time utilization', () => {
    const result = calculateTimeKpis(480, 510, {
      driving: 300,
      service: 90,
      waiting: 60,
      break: 30,
      unplannedIdle: 20,
      other: 10,
    });

    expect(result.schedulePerformancePercent).toBeCloseTo((480 / 510) * 100);
    expect(result.savedOrLostMinutes).toBe(-30);
    expect(result.productiveTimePercent).toBeCloseTo((390 / 510) * 100);
  });

  it('keeps the raw over-100 result but caps only the main display value', () => {
    const result = calculateTimeKpis(480, 450);

    expect(result.schedulePerformancePercent).toBeCloseTo((480 / 450) * 100);
    expect(result.schedulePerformanceDisplayPercent).toBe(100);
    expect(result.savedOrLostMinutes).toBe(30);
  });

  it('does not invent KPI values when timing data is missing', () => {
    expect(calculateTimeKpis(480, null)).toEqual({
      schedulePerformancePercent: null,
      schedulePerformanceDisplayPercent: null,
      savedOrLostMinutes: null,
      productiveTimePercent: null,
    });
  });
});
