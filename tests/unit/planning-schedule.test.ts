import { describe, expect, it } from 'vitest';

import {
  defaultPlanningDate,
  defaultPlanningTime,
  planningDepartureIso,
  suggestPlanningTimeFromWindows,
} from '@/application/routes/planning-schedule';

describe('planning schedule', () => {
  it('defaults planning to the creation day itself on a weekday', () => {
    expect(defaultPlanningDate(new Date(2026, 7, 7, 12))).toBe('2026-08-07'); // Friday
    expect(defaultPlanningDate(new Date(2026, 7, 5, 12))).toBe('2026-08-05'); // Wednesday
  });

  it('rolls a weekend creation forward to Monday', () => {
    expect(defaultPlanningDate(new Date(2026, 7, 8, 12))).toBe('2026-08-10'); // Saturday
    expect(defaultPlanningDate(new Date(2026, 7, 9, 12))).toBe('2026-08-10'); // Sunday
  });

  it('defaults route departure to 04:00 when no windows are known', () => {
    expect(defaultPlanningTime()).toBe('04:00');
  });

  it('suggests departure from the earliest window minus a travel buffer', () => {
    expect(suggestPlanningTimeFromWindows([
      { from: '06:00' },
      { from: '07:00' },
      { from: '08:00' },
    ])).toBe('05:30');
    expect(suggestPlanningTimeFromWindows([
      { from: '08:00' },
      { from: '06:00' },
    ])).toBe('05:30');
    expect(suggestPlanningTimeFromWindows([{ from: null }, { from: undefined }])).toBe('04:00');
  });

  it('builds a real local departure and rejects invalid input', () => {
    expect(planningDepartureIso('2026-08-10', '07:00')).toMatch(/^2026-08-10T/);
    expect(planningDepartureIso('2026-02-31', '07:00')).toBeNull();
    expect(planningDepartureIso('2026-08-10', '25:00')).toBeNull();
  });
});
