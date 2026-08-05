import { describe, expect, it } from 'vitest';
import { normalizeOcrText, parseDeliveries } from '../../src/application/import/delivery-parser';

const cases = Array.from({ length: 50 }, (_, index) => ({
  index,
  address: `Gedimino pr. ${index + 1}, Vilnius`,
  order: `ORD-${String(index + 1).padStart(4, '0')}`,
  weight: 100 + index,
  phone: `+3706${String(1000000 + index).padStart(7, '0')}`,
}));

describe('production delivery parser (50 cases)', () => {
  it.each(cases)('extracts structured fields from OCR case $index', ({ address, order, weight, phone }) => {
    const text = `${address}\nUžsakymas: ${order}\n${weight} kg\n08:00-10:00\n${phone}\nGavėjas: UAB Testas\nPastabos: Skambinti prieš atvykstant`;
    const result = parseDeliveries(text);
    expect(result).toHaveLength(1);
    expect(result[0].address.value).toBe(address);
    expect(result[0].orderNumber.value).toBe(order);
    expect(result[0].weightKg.value).toBe(weight);
    expect(result[0].phone.value).toBe(phone);
    expect(result[0].recipient.value).toBe('UAB Testas');
    expect(result[0].parserConfidence).toBeGreaterThan(0.7);
  });

  it('normalizes OCR whitespace and Unicode', () => {
    expect(normalizeOcrText('  A\r\n\tB  ')).toBe('A\n B');
  });
});

describe('named delivery places', () => {
  it('keeps a named facility with a city as an address candidate', () => {
    const [delivery] = parseDeliveries(
      'Lietuvos kariuomenės Karinių oro pajėgų Aviacijos bazė, Šiauliai',
    );
    expect(delivery.address.value).toBe(
      'Lietuvos kariuomenės Karinių oro pajėgų Aviacijos bazė, Šiauliai',
    );
    expect(delivery.address.confidence).toBeGreaterThan(0.7);
  });

  it('keeps postal code and city with the original street address', () => {
    const [delivery] = parseDeliveries('Stoties g. 9C, 77156 Šiauliai');
    expect(delivery.address.value).toBe('Stoties g. 9C, 77156 Šiauliai');
  });
});
