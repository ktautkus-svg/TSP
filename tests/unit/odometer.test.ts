import { describe, expect, it } from 'vitest';

import { validateOdometer } from '../../src/application/services/odometer';

describe('validateOdometer', () => {
  it('calculates driven distance', () => {
    expect(validateOdometer(120_000, 120_184)).toEqual({ ok: true, distanceKm: 184 });
  });

  it('allows a zero distance', () => {
    expect(validateOdometer(100, 100)).toEqual({ ok: true, distanceKm: 0 });
  });

  it('rejects an end reading before the start', () => {
    const result = validateOdometer(500, 499);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('END_BEFORE_START');
  });

  it('rejects non-finite and negative values', () => {
    expect(validateOdometer(Number.NaN, 10)).toMatchObject({ ok: false, code: 'NOT_A_NUMBER' });
    expect(validateOdometer(-1, 10)).toMatchObject({ ok: false, code: 'NEGATIVE' });
  });

  it('flags a configurable implausible distance', () => {
    expect(validateOdometer(100, 701, 600)).toMatchObject({
      ok: false,
      code: 'IMPLAUSIBLE_DISTANCE',
    });
  });
});
