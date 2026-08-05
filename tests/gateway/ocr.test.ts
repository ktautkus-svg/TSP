import { describe, expect, it, vi } from 'vitest';
import { GoogleVisionAdapter } from '../../gateway/providers/google-vision-adapter';
import { parseGatewayOcrRequest } from '../../gateway/validation';

const request = parseGatewayOcrRequest({
  documentId: 'doc-1',
  mimeType: 'image/jpeg',
  imageBase64: 'aGVsbG8gd29ybGQ=',
  languageHints: ['lt'],
});

describe('Google Vision OCR gateway', () => {
  it('validates a bounded OCR payload', () => {
    expect(request.documentId).toBe('doc-1');
    expect(() => parseGatewayOcrRequest({ ...request, mimeType: 'text/html' })).toThrow();
    expect(() => parseGatewayOcrRequest({ ...request, imageBase64: 'not base64!' })).toThrow();
  });

  it('maps Google document text response to the common OCR contract', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ responses: [{
      fullTextAnnotation: {
        text: 'Gedimino pr. 9, Vilnius',
        pages: [{ width: 1000, height: 1000, confidence: 0.94, blocks: [{
          confidence: 0.92,
          boundingBox: { vertices: [{ x: 10, y: 20 }, { x: 500, y: 20 }, { x: 500, y: 100 }, { x: 10, y: 100 }] },
          paragraphs: [{ words: [{ symbols: [...'Gedimino'].map((text) => ({ text })) }] }],
        }] }],
      },
    }] }));
    const result = await new GoogleVisionAdapter('secret', fetcher as typeof fetch).recognize(request);
    expect(result.provider).toBe('google-vision');
    expect(result.text).toContain('Gedimino');
    expect(result.confidence).toBeCloseTo(0.94);
    expect(result.blocks[0].boundingBox?.width).toBeCloseTo(0.49);
    expect(String(fetcher.mock.calls[0][0])).toContain('vision.googleapis.com');
  });

  it('supports synchronous multi-page PDF responses', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ responses: [{ responses: [
      { fullTextAnnotation: { text: 'Puslapis 1', pages: [{ confidence: 0.9, blocks: [] }] } },
      { fullTextAnnotation: { text: 'Puslapis 2', pages: [{ confidence: 0.8, blocks: [] }] } },
    ] }] }));
    const result = await new GoogleVisionAdapter('secret', fetcher as typeof fetch).recognize({ ...request, mimeType: 'application/pdf' });
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('Puslapis 1');
    expect(result.text).toContain('Puslapis 2');
    expect(String(fetcher.mock.calls[0][0])).toContain('files:annotate');
  });

  it('does not run without a server-side key', async () => {
    await expect(new GoogleVisionAdapter('').recognize(request)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});
