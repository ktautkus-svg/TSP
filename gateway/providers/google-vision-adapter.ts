import { performance } from 'node:perf_hooks';

import { GatewayError, providerHttpError } from '../errors';
import type { GatewayOcrRequest, GatewayOcrResponse } from '../types';

type VisionVertex = { x?: number; y?: number };
type VisionWord = { symbols?: Array<{ text?: string }>; confidence?: number };
type VisionBlock = {
  paragraphs?: Array<{ words?: VisionWord[] }>;
  confidence?: number;
  boundingBox?: { vertices?: VisionVertex[] };
};
type VisionResponse = {
  responses?: Array<VisionImageResponse | { responses?: VisionImageResponse[] }>;
};
type VisionImageResponse = {
    error?: { code?: number; message?: string };
    fullTextAnnotation?: {
      text?: string;
      pages?: Array<{ width?: number; height?: number; confidence?: number; blocks?: VisionBlock[] }>;
    };
    textAnnotations?: Array<{ description?: string }>;
};

export class GoogleVisionAdapter {
  readonly version = 'google-vision-document-text-v1';

  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async recognize(request: GatewayOcrRequest, signal?: AbortSignal): Promise<GatewayOcrResponse> {
    if (!this.apiKey) {
      throw new GatewayError('CONFIGURATION_ERROR', 'Google Vision API raktas nesukonfigūruotas.', 500, false);
    }
    const started = performance.now();
    let response: Response;
    try {
      const isPdf = request.mimeType === 'application/pdf';
      response = await this.fetcher(
        `https://vision.googleapis.com/v1/${isPdf ? 'files' : 'images'}:annotate?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(isPdf
            ? {
                requests: [{
                  inputConfig: { content: request.imageBase64, mimeType: request.mimeType },
                  features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                  imageContext: { languageHints: request.languageHints },
                  pages: [1, 2, 3, 4, 5],
                }],
              }
            : {
                requests: [{
                  image: { content: request.imageBase64 },
                  features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                  imageContext: { languageHints: request.languageHints },
                }],
              }),
          signal,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayError('PROVIDER_TIMEOUT', 'Google Vision užklausa viršijo laiko limitą.', 504, true);
      }
      throw new GatewayError('PROVIDER_NETWORK_ERROR', 'Nepavyko pasiekti Google Vision.', 503, true);
    }
    if (!response.ok) throw providerHttpError('Google Vision', response.status);
    const payload = (await response.json()) as VisionResponse;
    const outer = payload.responses?.[0];
    const imageResults: VisionImageResponse[] = outer && 'responses' in outer
      ? outer.responses ?? []
      : outer ? [outer as VisionImageResponse] : [];
    const providerError = imageResults.find((item) => item.error)?.error;
    if (imageResults.length === 0 || providerError) {
      throw new GatewayError(
        'PROVIDER_INVALID_RESPONSE',
        providerError?.message || 'Google Vision negrąžino OCR rezultato.',
        502,
        false,
      );
    }
    const pages = imageResults.flatMap((item) => item.fullTextAnnotation?.pages ?? []);
    let pageOffset = 0;
    const blocks = imageResults.flatMap((item) => {
      const itemPages = item.fullTextAnnotation?.pages ?? [];
      const mapped = itemPages.flatMap((page, pageIndex) =>
        (page.blocks ?? []).map((block, blockIndex) => ({
          id: `${request.documentId}:${pageOffset + pageIndex + 1}:${blockIndex + 1}`,
          text: blockText(block),
          confidence: normalizeConfidence(block.confidence),
          page: pageOffset + pageIndex + 1,
          boundingBox: toBoundingBox(block.boundingBox?.vertices, page.width, page.height),
        })),
      );
      pageOffset += Math.max(1, itemPages.length);
      return mapped;
    }).filter((block) => block.text.length > 0);
    const text = imageResults.map((item) =>
      item.fullTextAnnotation?.text?.trim() || item.textAnnotations?.[0]?.description?.trim() || '',
    ).filter(Boolean).join('\n\n');
    const pageConfidence = pages.map((page) => normalizeConfidence(page.confidence));
    const blockConfidence = blocks.map((block) => block.confidence);
    const confidences = pageConfidence.filter(Boolean).length ? pageConfidence : blockConfidence;
    return {
      provider: 'google-vision',
      providerVersion: this.version,
      text,
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : text ? 0.7 : 0,
      blocks,
      pageCount: Math.max(1, pages.length),
      processingMs: performance.now() - started,
      warnings: text ? [] : ['Google Vision dokumente teksto nerado.'],
    };
  }
}

function blockText(block: VisionBlock): string {
  return (block.paragraphs ?? [])
    .map((paragraph) => (paragraph.words ?? []).map((word) => (word.symbols ?? []).map((symbol) => symbol.text ?? '').join('')).join(' '))
    .join('\n')
    .trim();
}

function normalizeConfidence(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;
}

function toBoundingBox(vertices: VisionVertex[] | undefined, width = 0, height = 0) {
  if (!vertices?.length || !width || !height) return null;
  const xs = vertices.map((vertex) => vertex.x ?? 0);
  const ys = vertices.map((vertex) => vertex.y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX / width,
    y: minY / height,
    width: (Math.max(...xs) - minX) / width,
    height: (Math.max(...ys) - minY) / height,
  };
}
