import { describe, expect, it } from 'vitest';
import { detectDuplicates } from '../../src/domain/import/duplicate-detector';
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
