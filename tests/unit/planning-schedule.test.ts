import { describe, expect, it } from 'vitest';

import { defaultPlanningDate, defaultPlanningTime, planningDepartureIso } from '@/application/routes/planning-schedule';

describe('planning schedule', () => {
  it('defaults Friday planning to Monday', () => {
    expect(defaultPlanningDate(new Date(2026, 7, 7, 12))).toBe('2026-08-10');
  });

  it('defaults a normal weekday to the next day', () => {
    expect(defaultPlanningDate(new Date(2026, 7, 5, 12))).toBe('2026-08-06');
  });

  it('defaults route departure to 04:00', () => {
    expect(defaultPlanningTime()).toBe('04:00');
  });

  it('builds a real local departure and rejects invalid input', () => {
    expect(planningDepartureIso('2026-08-10', '07:00')).toMatch(/^2026-08-10T/);
    expect(planningDepartureIso('2026-02-31', '07:00')).toBeNull();
    expect(planningDepartureIso('2026-08-10', '25:00')).toBeNull();
  });
});
