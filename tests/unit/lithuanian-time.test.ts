import { describe, expect, it } from 'vitest';

import {
  assessDeliveryTiming,
  completionPunctuality,
  lithuanianClockOnReferenceDay,
  lithuanianDateKey,
} from '../../src/domain/lithuanian-time';

describe('Lithuanian wall-clock handling', () => {
  it('resolves the Lithuanian calendar day across a UTC midnight boundary', () => {
    expect(lithuanianDateKey('2026-08-20T21:30:00.000Z')).toBe('2026-08-21');
    expect(lithuanianDateKey('not-a-date')).toBeNull();
  });

  it('uses daylight saving time in summer and standard time in winter', () => {
    expect(new Date(lithuanianClockOnReferenceDay('2026-08-11T08:00:00.000Z', '11:00')!).toISOString())
      .toBe('2026-08-11T08:00:00.000Z');
    expect(new Date(lithuanianClockOnReferenceDay('2026-01-11T09:00:00.000Z', '11:00')!).toISOString())
      .toBe('2026-01-11T09:00:00.000Z');
  });

  it('returns the same result regardless of whether the process runs in UTC or Lithuania', () => {
    const timing = assessDeliveryTiming({
      deliveredAt: '2026-08-11T08:20:00.000Z',
      deliveryTimeFrom: '10:00',
      deliveryTimeTo: '11:00',
    });
    expect(timing).toMatchObject({ state: 'late', differenceMinutes: 20, referenceAt: '2026-08-11T08:00:00.000Z' });
    expect(completionPunctuality({ deliveredAt: '2026-08-11T08:10:00.000Z', deliveryTimeTo: '11:00' })).toBe('on_time');
  });

  it('distinguishes early delivery from actual lateness while preserving summary compatibility', () => {
    const input = { deliveredAt: '2026-08-11T06:30:00.000Z', deliveryTimeFrom: '10:00', deliveryTimeTo: '11:00' };
    expect(assessDeliveryTiming(input)).toMatchObject({ state: 'early', differenceMinutes: -30 });
    expect(completionPunctuality(input)).toBe('late');
  });

  it('rejects malformed clocks instead of guessing', () => {
    expect(lithuanianClockOnReferenceDay('2026-08-11T08:00:00.000Z', '25:00')).toBeNull();
    expect(lithuanianClockOnReferenceDay('not-a-date', '11:00')).toBeNull();
  });
});
