import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  calendarMonthDays,
  calendarPresetRange,
  dateFromKey,
  formatDateKey,
  formatDateRange,
  formatPeriodTitle,
  localDateKey,
  periodRange,
  validDateKey,
  withinPeriod,
} from '../../src/application/reporting/period-range';

describe('periodRange', () => {
  it('uses the local calendar day, not a UTC slice of an ISO timestamp', () => {
    const lateLocalEvening = new Date(2026, 7, 23, 23, 30, 0);
    expect(localDateKey(lateLocalEvening)).toBe('2026-08-23');
    expect(localDateKey(new Date(2026, 0, 5, 0, 15, 0))).toBe('2026-01-05');
  });

  it('a day is that calendar date, inclusive', () => {
    expect(periodRange('day', '2026-08-19', '', '')).toEqual({ from: '2026-08-19', to: '2026-08-19' });
  });

  it('a week is Monday to Sunday around the anchor date', () => {
    // 2026-08-19 is Wednesday.
    expect(periodRange('week', '2026-08-19', '', '')).toEqual({ from: '2026-08-17', to: '2026-08-23' });
    // Sunday belongs to the week that started the previous Monday.
    expect(periodRange('week', '2026-08-23', '', '')).toEqual({ from: '2026-08-17', to: '2026-08-23' });
    // Monday starts a new week.
    expect(periodRange('week', '2026-08-24', '', '')).toEqual({ from: '2026-08-24', to: '2026-08-30' });
  });

  it('a month is the first to last calendar day of that month', () => {
    expect(periodRange('month', '2026-02-19', '', '')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('month', '2024-02-19', '', '')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('swaps a reversed custom range instead of showing an empty screen', () => {
    expect(periodRange('custom', '2026-08-01', '2026-08-20', '2026-08-10')).toEqual({
      from: '2026-08-10',
      to: '2026-08-20',
    });
  });

  it('falls back to today when a custom bound is not a real date', () => {
    const today = localDateKey(new Date());
    expect(periodRange('custom', '2026-08-01', 'nope', 'also-nope')).toEqual({ from: today, to: today });
    expect(periodRange('custom', '2026-08-01', '2026-08-10', 'nope')).toEqual({ from: '2026-08-10', to: '2026-08-10' });
  });

  it('rejects impossible calendar dates', () => {
    expect(validDateKey('2026-02-30')).toBe(false);
    expect(validDateKey('2026-08-19')).toBe(true);
    expect(dateFromKey('2026-08-19').getHours()).toBe(12);
    expect(localDateKey(addDays(dateFromKey('2026-08-19'), 1))).toBe('2026-08-20');
  });

  it('withinPeriod is inclusive on both ends', () => {
    const range = { from: '2026-08-17', to: '2026-08-23' };
    expect(withinPeriod('2026-08-17', range)).toBe(true);
    expect(withinPeriod('2026-08-23', range)).toBe(true);
    expect(withinPeriod('2026-08-16', range)).toBe(false);
    expect(withinPeriod('2026-08-24', range)).toBe(false);
  });

  it('formats Lithuanian titles without inventing UTC days', () => {
    expect(formatDateKey('2026-08-19')).toMatch(/19/);
    expect(formatDateRange('2026-08-19', '2026-08-19')).toBe(formatDateKey('2026-08-19'));
    expect(formatDateRange('2026-08-17', '2026-08-23')).toContain('–');
    expect(formatPeriodTitle('month', '2026-08-01', '2026-08-31')).toMatch(/2026/);
  });

  it('keeps week and month labels in one shared catalog', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/application/reporting/period-range.ts'), 'utf8');
    expect(source).toContain("{ key: 'week', label: 'Savaitė' }");
    expect(source).toContain("{ key: 'month', label: 'Mėnuo' }");
    expect(source).toContain('date.getFullYear()');
  });

  it('builds a Monday-first six-week calendar grid and common quick ranges', () => {
    const days = calendarMonthDays('2026-08');
    expect(days).toHaveLength(42);
    expect(days[0]?.key).toBe('2026-07-27');
    expect(days.find((day) => day.key === '2026-08-31')).toMatchObject({ day: 31, inMonth: true });
    const sunday = new Date(2026, 7, 30, 12);
    expect(calendarPresetRange('thisWeek', sunday)).toEqual({ from: '2026-08-24', to: '2026-08-30' });
    expect(calendarPresetRange('lastMonth', sunday)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });
});
