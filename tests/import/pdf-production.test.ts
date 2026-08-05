import { describe, expect, it } from 'vitest';
import { PdfImportPipeline, PassthroughPdfPageExtractor } from '../../src/application/import/pdf-import';
import { MockOcrProvider } from '../../src/infrastructure/import/ocr/mock-ocr-provider';
import { documentFixture } from './helpers';

const cases = Array.from({ length: 20 }, (_, index) => ({ index, pages: (index % 10) + 1 }));

describe('PDF import (20 cases)', () => {
  it.each(cases)('merges OCR results for PDF fixture $index', async ({ pages }) => {
    const document = documentFixture({ kind: 'pdf', mimeType: 'application/pdf', pageCount: pages });
    const result = await new PdfImportPipeline(
      new PassthroughPdfPageExtractor(),
      new MockOcrProvider('Gedimino pr. 9, Vilnius'),
    ).recognize(document);
    expect(result.pageCount).toBe(pages);
    expect(result.text.split('Gedimino').length - 1).toBe(pages);
    expect(result.provider).toBe('mock');
  });
});
