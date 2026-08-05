import type { ImportDocument, OcrResult } from '@/domain/import/models';
import type { OcrProvider } from '@/application/import/ocr-provider';

export class MockOcrProvider implements OcrProvider {
  readonly id = 'mock' as const;
  readonly version = 'mock-ocr-v1';
  readonly capabilities = { images: true, pdf: true, multiPage: true, offline: true };

  constructor(private readonly fallbackText = '') {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async recognize(document: ImportDocument): Promise<OcrResult> {
    const started = performance.now();
    const text = document.pastedText ?? this.fallbackText;
    const pages = text.split(/\f/u);
    const blocks = pages.flatMap((pageText, page) =>
      pageText.split(/\n\s*\n/u).filter(Boolean).map((block, index) => ({
        id: `mock-${page + 1}-${index + 1}`,
        text: block.trim(),
        confidence: 0.99,
        page: page + 1,
        boundingBox: null,
      })),
    );
    return {
      provider: this.id,
      providerVersion: this.version,
      text,
      confidence: text ? 0.99 : 0,
      blocks,
      pageCount: Math.max(1, pages.length),
      processingMs: performance.now() - started,
      warnings: text ? [] : ['Mock OCR negavo teksto.'],
    };
  }
}
