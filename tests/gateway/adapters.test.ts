import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../../gateway/errors';
import {
  HereMatrixAdapter,
  normalizeHereMatrix,
} from '../../gateway/providers/here-matrix-adapter';
import {
  GoogleMatrixAdapter,
  normalizeGoogleMatrix,
} from '../../gateway/providers/google-matrix-adapter';
import { gatewayRequest } from './helpers';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve('gateway/fixtures', name), 'utf8'),
  );
}

describe('HERE matrix adapter', () => {
  it('normalizes a real response fixture', async () => {
    const result = normalizeHereMatrix(
      await fixture('here-matrix-success.json'),
      gatewayRequest('here'),
      25,
    );
    expect(result.matrix.executionMode).toBe('real');
    expect(result.matrix.cells[0][1]).toMatchObject({
      distanceKm: 5,
      durationMinutes: 10,
      reachable: true,
    });
    expect(result.completenessRatio).toBe(1);
  });

  it('keeps unreachable and violation cells explicit', async () => {
    const result = normalizeHereMatrix(
      await fixture('here-matrix-partial.json'),
      gatewayRequest('here'),
      25,
    );
    expect(result.matrix.cells[0][2].reachable).toBe(false);
    expect(result.matrix.cells[2][0].restrictionWarnings).toContain(
      'HERE_ROUTE_WITH_VIOLATIONS',
    );
  });

  it('sends truck data and never puts key in body', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(_url)).toContain('apiKey=server-key');
      expect(String(init?.body)).not.toContain('server-key');
      expect(String(init?.body)).toContain('"transportMode":"truck"');
      return new Response(
        JSON.stringify(await fixture('here-matrix-success.json')),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    await new HereMatrixAdapter('server-key', fetcher as typeof fetch).fetchMatrix(
      gatewayRequest('here'),
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('Google Routes matrix adapter', () => {
  it('normalizes streamed JSON array fixture', async () => {
    const result = normalizeGoogleMatrix(
      await fixture('google-matrix-success.json'),
      gatewayRequest('google'),
      31,
    );
    expect(result.matrix.executionMode).toBe('real');
    expect(result.matrix.cells[0][2].durationMinutes).toBeCloseTo(14.5083, 3);
    expect(result.completenessRatio).toBe(1);
  });

  it('rejects a matrix with a missing OD pair instead of filling it synthetically', async () => {
    const partialPayload = await fixture('google-matrix-partial.json');
    expect(() => normalizeGoogleMatrix(
      partialPayload,
      gatewayRequest('google'),
      31,
    )).toThrowError(expect.objectContaining({ code: 'PROVIDER_INVALID_RESPONSE' }));
  });

  it('maps auth, rate limit and 5xx without fallback', async () => {
    for (const [status, code] of [
      [401, 'PROVIDER_AUTH_FAILED'],
      [429, 'PROVIDER_RATE_LIMITED'],
      [503, 'PROVIDER_SERVER_ERROR'],
    ] as const) {
      const fetcher = vi.fn(async () => new Response('{}', { status }));
      const promise = new GoogleMatrixAdapter(
        'server-key',
        fetcher as typeof fetch,
      ).fetchMatrix(gatewayRequest('google'), new AbortController().signal);
      await expect(promise).rejects.toMatchObject({ code });
    }
  });

  it('maps timeout and malformed provider response', async () => {
    const timeoutFetcher = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(
      new GoogleMatrixAdapter(
        'server-key',
        timeoutFetcher as typeof fetch,
      ).fetchMatrix(gatewayRequest('google'), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });

    const malformedFetcher = vi.fn(
      async () => new Response('{"wrong":true}', { status: 200 }),
    );
    await expect(
      new GoogleMatrixAdapter(
        'server-key',
        malformedFetcher as typeof fetch,
      ).fetchMatrix(gatewayRequest('google'), new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });
});
