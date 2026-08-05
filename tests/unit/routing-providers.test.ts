import { describe, expect, it, vi } from 'vitest';

import { createBaseRequest } from '../../src/domain/routing/scenarios';
import type { MatrixRequest } from '../../src/domain/routing/models';
import {
  CachedTravelCostProvider,
  MemoryMatrixCache,
  matrixCacheKey,
} from '../../src/infrastructure/routing/cache/matrix-cache';
import {
  GatewayTravelCostProvider,
} from '../../src/infrastructure/routing/providers/gateway-travel-cost-provider';
import { readSafeGatewayError } from '../../src/infrastructure/routing/providers/gateway-client';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

function matrixRequest(
  departureAt = '2026-06-15T07:00:00.000Z',
): MatrixRequest {
  const request = createBaseRequest(5);
  return {
    locations: [
      request.startLocation,
      ...request.stops.map((stop) => stop.location),
      request.endLocation,
    ],
    vehicle: request.vehicle,
    departureAt,
    trafficMode: request.trafficMode,
    timeoutMs: 1_000,
  };
}

describe('synthetic routing providers', () => {
  it('produce deterministic square matrices in all three modes', async () => {
    for (const mode of ['linear', 'city_traffic', 'asymmetric'] as const) {
      const provider = new SyntheticTravelCostProvider(mode);
      const first = await provider.getMatrix(matrixRequest());
      const second = await provider.getMatrix(matrixRequest());
      expect(first.cells).toEqual(second.cells);
      expect(first.cells).toHaveLength(7);
      expect(first.cells.every((row) => row.length === 7)).toBe(true);
    }
  });

  it('models departure-time traffic and asymmetric costs', async () => {
    const city = new SyntheticTravelCostProvider('city_traffic');
    const rush = await city.getMatrix(matrixRequest('2026-06-15T07:00:00.000Z'));
    const quiet = await city.getMatrix(matrixRequest('2026-06-15T12:00:00.000Z'));
    expect(rush.cells[0][1].durationMinutes).toBeGreaterThan(
      quiet.cells[0][1].durationMinutes!,
    );

    const asymmetric = await new SyntheticTravelCostProvider('asymmetric').getMatrix(
      matrixRequest(),
    );
    expect(asymmetric.cells[0][1].durationMinutes).not.toBe(
      asymmetric.cells[1][0].durationMinutes,
    );
  });
});

describe('matrix cache and gateway boundary', () => {
  it('shows a rate-limited endpoint and a safe retry delay', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: 'Viršytas gateway užklausų limitas.',
          retryable: true,
          details: { endpoint: '/v1/matrix', windowSeconds: 60 },
        },
      }),
      { status: 429, headers: { 'retry-after': '42', 'content-type': 'application/json' } },
    );

    await expect(readSafeGatewayError(response, 'Gateway klaida.')).resolves.toEqual({
      code: 'RATE_LIMITED',
      endpoint: '/v1/matrix',
      retryAfterSeconds: 42,
      message: 'Viršytas gateway užklausų limitas. Endpointas: /v1/matrix. Saugiai pakartokite po 42 s.',
    });
  });

  it('reuses a fresh matrix and varies the key by departure bucket', async () => {
    const delegate = new SyntheticTravelCostProvider('linear');
    const spy = vi.spyOn(delegate, 'getMatrix');
    const cached = new CachedTravelCostProvider(delegate, new MemoryMatrixCache());
    const first = await cached.getMatrix(matrixRequest());
    const second = await cached.getMatrix(matrixRequest());
    expect(first.executionMode).toBe('synthetic');
    expect(second.executionMode).toBe('cache');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(matrixCacheKey('x', matrixRequest())).not.toBe(
      matrixCacheKey('x', matrixRequest('2026-06-15T08:00:00.000Z')),
    );
  });

  it('maps rate limits and rejects malformed gateway matrices', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ provider: 'test', nodeIds: [], cells: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const rateLimited = new GatewayTravelCostProvider(
      'test',
      'https://gateway.test/v1/matrix',
      mockFetch,
    );
    await expect(rateLimited.getMatrix(matrixRequest())).rejects.toMatchObject({
      name: 'ProviderRequestError',
      statusCode: 429,
    });

    const malformed = new GatewayTravelCostProvider(
      'test',
      'https://gateway.test/v1/matrix',
      mockFetch,
    );
    await expect(malformed.getMatrix(matrixRequest())).rejects.toMatchObject({
      name: 'InvalidMatrixError',
    });
  });
});
