import { describe, expect, it } from 'vitest';
import { MockOcrProvider } from '../../src/infrastructure/import/ocr/mock-ocr-provider';
import { documentFixture } from './helpers';

const cases = Array.from({ length: 50 }, (_, index) => ({ index, pages: (index % 5) + 1 }));

describe('MockOCRProvider (50 cases)', () => {
  it.each(cases)('returns normalized common contract for fixture $index', async ({ index, pages }) => {
    const text = Array.from({ length: pages }, (_, page) => `Gedimino pr. ${index + page + 1}, Vilnius`).join('\f');
    const result = await new MockOcrProvider().recognize(documentFixture({ pastedText: text, pageCount: pages }));
    expect(result.provider).toBe('mock');
    expect(result.pageCount).toBe(pages);
    expect(result.confidence).toBe(0.99);
    expect(result.text).toContain('Gedimino pr.');
    expect(result.blocks.length).toBeGreaterThan(0);
  });
});
