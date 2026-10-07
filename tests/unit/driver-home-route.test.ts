import { describe, expect, it } from 'vitest';

import { routeDayLabel, selectDriverHomeRoute } from '../../src/application/routes/driver-home-route';

describe('driver home day selection', () => {
  it('shows Wednesday when Thursday is also assigned and today is Wednesday', () => {
    const selected = selectDriverHomeRoute([
      { id: 'thu', date: '2026-10-08', status: 'planned' },
      { id: 'wed', date: '2026-10-07', status: 'planned' },
    ], '2026-10-07');
    expect(selected?.id).toBe('wed');
    expect(routeDayLabel('2026-10-08', '2026-10-07', 'ketvirtadienis, spalio 8')).toContain('rytojaus maršrutas');
  });

  it('does not present a finished past route as today', () => {
    const selected = selectDriverHomeRoute([
      { id: 'old', date: '2026-10-06', status: 'completed' },
      { id: 'today', date: '2026-10-07', status: 'planned' },
    ], '2026-10-07');
    expect(selected?.id).toBe('today');
  });
});
