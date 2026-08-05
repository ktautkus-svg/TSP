import type { ImportDocument, ParsedDelivery } from '../../src/domain/import/models';
import { parseDeliveries } from '../../src/application/import/delivery-parser';

export function documentFixture(overrides: Partial<ImportDocument> = {}): ImportDocument {
  return {
    id: 'doc-1',
    kind: 'clipboard',
    uri: null,
    fileName: 'fixture.txt',
    mimeType: 'text/plain',
    sizeBytes: null,
    pageCount: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    pastedText: 'Gedimino pr. 9, Vilnius\n150 kg',
    ...overrides,
  };
}

export function deliveryFixture(index = 1, address = `Gedimino pr. ${index}, Vilnius`): ParsedDelivery {
  const delivery = parseDeliveries(`${address}\nUžsakymas: ORD-${index}\n${100 + index} kg`)[0];
  if (!delivery) throw new Error('Fixture parser returned no delivery.');
  return delivery;
}
