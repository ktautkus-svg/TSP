import type { ImportDocument, OcrResult } from '@/domain/import/models';
import type { OcrProvider } from './ocr-provider';

export interface PdfPageExtractor {
  extract(document: ImportDocument): Promise<ImportDocument[]>;
}

export class PdfImportPipeline {
  constructor(private readonly extractor: PdfPageExtractor, private readonly provider: OcrProvider) {}

  async recognize(document: ImportDocument): Promise<OcrResult> {
    const started = performance.now();
    const pages = await this.extractor.extract(document);
    const results: OcrResult[] = [];
    for (const page of pages) results.push(await this.provider.recognize(page));
    const blockCount = results.reduce((sum, result) => sum + result.blocks.length, 0);
    return {
      provider: this.provider.id,
      providerVersion: this.provider.version,
      text: results.map((result) => result.text).join('\n\n'),
      confidence: results.length ? results.reduce((sum, result) => sum + result.confidence, 0) / results.length : 0,
      blocks: results.flatMap((result, page) => result.blocks.map((block) => ({ ...block, page: page + 1 }))),
      pageCount: pages.length,
      processingMs: performance.now() - started,
      warnings: [...results.flatMap((result) => result.warnings), ...(blockCount === 0 ? ['PDF puslapiuose teksto nerasta.'] : [])],
    };
  }
}

export class PassthroughPdfPageExtractor implements PdfPageExtractor {
  async extract(document: ImportDocument): Promise<ImportDocument[]> {
    return Array.from({ length: Math.max(1, document.pageCount) }, (_, index) => ({
      ...document,
      id: `${document.id}:page-${index + 1}`,
      kind: 'pdf' as const,
      pageCount: 1,
    }));
  }
}
