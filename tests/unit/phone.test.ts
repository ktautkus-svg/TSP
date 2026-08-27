import { describe, expect, it } from 'vitest';

import { normalizePhone } from '../../src/domain/phone';

describe('normalizePhone', () => {
  it('normalizes standard Lithuanian formats', () => {
    expect(normalizePhone('+37061234567')).toBe('+37061234567');
    expect(normalizePhone('861234567')).toBe('+37061234567');
    expect(normalizePhone('61234567')).toBe('+37061234567');
    expect(normalizePhone('00370 6 123 4567')).toBe('+37061234567');
  });

  it('strips a leading trunk 0 instead of producing a literal "+0..." number', () => {
    expect(normalizePhone('061234567')).toBe('+37061234567');
    expect(normalizePhone('0 612 345 67')).toBe('+37061234567');
  });
});
