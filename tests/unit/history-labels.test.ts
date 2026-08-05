import { describe, expect, it } from 'vitest';

import {
  deliveryStatusLabel,
  formatLithuanianDate,
  formatLithuanianDateTime,
  loadingStatusLabel,
} from '../../src/ui/history-labels';

describe('Lithuanian history presentation', () => {
  it('shows user-facing delivery and loading labels', () => {
    expect(deliveryStatusLabel('delivered')).toBe('Pristatyta');
    expect(deliveryStatusLabel('failed')).toBe('Nepavyko pristatyti');
    expect(deliveryStatusLabel('pending')).toBe('Nepristatyta');
    expect(loadingStatusLabel('loaded')).toBe('Pakrauta');
    expect(loadingStatusLabel('pending')).toBe('Nepakrauta');
  });

  it('formats ISO values for Lithuania without changing the stored value', () => {
    const iso = '2026-08-03T05:30:00.000Z';
    expect(formatLithuanianDateTime(iso)).toContain('2026');
    expect(formatLithuanianDateTime(iso)).not.toBe(iso);
    expect(formatLithuanianDate('2026-08-03')).toContain('2026');
    expect(formatLithuanianDateTime(null)).toBe('—');
  });
});
