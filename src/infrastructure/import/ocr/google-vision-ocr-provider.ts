import { File } from 'expo-file-system';

import type { OcrProvider } from '@/application/import/ocr-provider';
import type { ImportDocument, OcrResult } from '@/domain/import/models';
import { gatewayEndpoint, normalizeEndpoint, platformFetch, readSafeGatewayError } from '@/infrastructure/routing/providers/gateway-client';

export class GoogleVisionOcrProvider implements OcrProvider {
  readonly id = 'google-vision' as const;
  readonly version = 'google-vision-gateway-v1';
  readonly capabilities = { images: true, pdf: true, multiPage: true, offline: false };
  readonly endpoint: string;

  constructor(
    endpoint: string = gatewayEndpoint('/v1/ocr/google'),
    private readonly fetcher: typeof fetch = platformFetch,
  ) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async recognize(document: ImportDocument, signal?: AbortSignal): Promise<OcrResult> {
    if (!document.uri) throw new Error('OCR dokumentas neturi failo URI.');
    const uris = document.pageUris?.length ? document.pageUris : [document.uri];
    const results: OcrResult[] = [];
    for (const [pageIndex, uri] of uris.entries()) {
      results.push(await this.recognizePage(document, uri, pageIndex + 1, signal));
    }
    return {
      provider: this.id,
      providerVersion: this.version,
      text: results.map((result) => result.text).join('\n\n'),
      confidence: results.reduce((sum, result) => sum + result.confidence, 0) / results.length,
      blocks: results.flatMap((result, pageIndex) => result.blocks.map((block) => ({ ...block, page: pageIndex + 1 }))),
      pageCount: results.length,
      processingMs: results.reduce((sum, result) => sum + result.processingMs, 0),
      warnings: results.flatMap((result) => result.warnings),
    };
  }

  private async recognizePage(
    document: ImportDocument,
    uri: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<OcrResult> {
    const imageBase64 = await new File(uri).base64();
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId: `${document.id}:page-${page}`,
        mimeType: document.mimeType,
        imageBase64,
        languageHints: ['lt', 'en'],
      }),
      signal,
    });
    if (!response.ok) {
      const safe = await readSafeGatewayError(response, `OCR gateway grąžino HTTP ${response.status}.`);
      throw new Error(safe.code ? `[${safe.code}] ${safe.message}` : safe.message);
    }
    return (await response.json()) as OcrResult;
  }
}
