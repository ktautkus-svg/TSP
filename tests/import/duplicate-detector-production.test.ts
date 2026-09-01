import { describe, expect, it } from 'vitest';

import { detectDuplicates } from '../../src/domain/import/duplicate-detector';
import type { ParsedDelivery } from '../../src/domain/import/models';
import { deliveryFixture } from './helpers';

const cases = Array.from({ length: 20 }, (_, index) => ({ index, mode: index % 3 }));

describe('duplicate detector (20 cases)', () => {
  it.each(cases)('detects duplicate scenario $index', ({ index, mode }) => {
    const left = deliveryFixture(index + 1, `Gedimino pr. ${index + 1}, Vilnius`);
    const right = deliveryFixture(index + 100, mode === 2
      ? `Gedimino pr. ${index + 1}, Vilnus`
      : `Gedimino pr. ${index + 1}, Vilnius`);
    if (mode === 0) right.orderNumber = { ...left.orderNumber };
    const findings = detectDuplicates([left, right]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].reason).toBe(mode === 0 ? 'same-order-number' : mode === 1 ? 'same-address' : 'similar-address');
  });
});

describe('Lambda / Panevėžio ligoninė unload identities', () => {
  it('does not recommend merging kavinė vs ne-kavinė at Smėlynės 25', () => {
    const cafe = hospitalDelivery('cafe', 'UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė (kavinė)');
    const other = hospitalDelivery('other', 'UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė (ne kavinė)');
    expect(detectDuplicates([cafe, other])).toEqual([]);
  });

  it('still merges true same-address copies that share no distinct unload identity', () => {
    const left = deliveryFixture(1, 'Dainų g. 11, Šiauliai');
    const right = deliveryFixture(2, 'Dainų g. 11, Šiauliai');
    left.id = 'dainu-a';
    right.id = 'dainu-b';
    const findings = detectDuplicates([left, right]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ reason: 'same-address', recommendation: 'merge' });
  });

  it('still merges two Smėlynės 25 lines when both are the same unloading', () => {
    const left = hospitalDelivery('a', 'UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė');
    const right = hospitalDelivery('b', 'UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė');
    const findings = detectDuplicates([left, right]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ reason: 'same-address', recommendation: 'merge' });
  });
});

function hospitalDelivery(id: string, recipient: string): ParsedDelivery {
  const delivery = deliveryFixture(id === 'cafe' || id === 'a' ? 1 : 2, 'Smėlynės g. 25, Panevėžys');
  delivery.id = `hospital-${id}`;
  delivery.recipient = { value: recipient, confidence: 0.9, evidence: recipient, manuallyCorrected: false };
  delivery.rawText = `Smėlynės g. 25, Panevėžys\n${recipient}`;
  return delivery;
}
