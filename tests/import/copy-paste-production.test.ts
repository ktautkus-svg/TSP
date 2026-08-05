import { describe, expect, it } from 'vitest';
import { parseDeliveries } from '../../src/application/import/delivery-parser';

const cases = Array.from({ length: 20 }, (_, index) => index + 1);

describe('copy/paste import (20 cases)', () => {
  it.each(cases)('splits two delivery blocks in paste case %i', (index) => {
    const text = `Vilnius\nGedimino pr. ${index}, Vilnius\n${100 + index} kg\n08:00\n\nKaunas\nSavanorių pr. ${index}, Kaunas\n${200 + index} kg\n09:30`;
    const result = parseDeliveries(text);
    expect(result).toHaveLength(2);
    expect(result[0].address.value).toContain('Gedimino');
    expect(result[1].address.value).toContain('Savanorių');
    expect(result[0].weightKg.value).toBe(100 + index);
    expect(result[1].weightKg.value).toBe(200 + index);
  });
});
