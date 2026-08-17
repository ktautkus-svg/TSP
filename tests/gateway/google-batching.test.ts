import { describe, expect, it, vi } from 'vitest';
import { GoogleMatrixAdapter } from '../../gateway/providers/google-matrix-adapter';
import { MemoryGatewayResponseCache } from '../../gateway/cache/file-response-cache';
import type { GatewayMatrixRequest } from '../../gateway/types';

function createMultiStopRequest(stopCount: number): GatewayMatrixRequest {
  const start = {
    id: 'loc-0',
    label: 'Startas',
    latitude: 54.68,
    longitude: 25.27,
  };
  const end = {
    id: `loc-${stopCount + 1}`,
    label: 'Pabaiga',
    latitude: 54.73,
    longitude: 25.23,
  };
  const stops = Array.from({ length: stopCount }, (_, index) => ({
    id: `loc-${index + 1}`,
    label: `Taškas ${index + 1}`,
    latitude: 54.68 + (index + 1) * 0.01,
    longitude: 25.27 + (index + 1) * 0.01,
  }));
  return {
    schemaVersion: '1',
    provider: 'google',
    matrixId: 'batch-test-matrix',
    startLocation: start,
    stops,
    endLocation: end,
    departureAt: '2026-08-03T04:30:00.000Z',
    trafficMode: 'none',
    vehicle: {
      id: 'van',
      type: 'van',
      maximumPayloadKg: 1500,
      useRoadRestrictions: false,
      startLocation: start,
      defaultEndLocation: end,
    },
    language: 'lt-LT',
    regionCode: 'LT',
  };
}

describe('Google Route Matrix batching / chunking', () => {
  // Was: "moves stale live-traffic departure time into the future". That kept the
  // matrix on TRAFFIC_AWARE, which bills every one of the n^2 elements at the
  // Compute Route Matrix Pro rate. The matrix is now always TRAFFIC_UNAWARE and
  // traffic is applied once to the selected route through computeRoutes instead.
  it('stays traffic-unaware even when the caller asks for live traffic', async () => {
    const request = { ...createMultiStopRequest(1), trafficMode: 'live' as const };
    const baseFetcher = createCompleteMatrixFetcher();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.routingPreference).toBe('TRAFFIC_UNAWARE');
      expect(body).not.toHaveProperty('departureTime');
      return baseFetcher(url, init);
    });

    await new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 25)
      .fetchMatrix(request, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledOnce();
  });

  // Sizes stay under MAX_MATRIX_ELEMENTS_PER_PLAN (729 = 25 stops + start + end),
  // which is the largest grid the gateway will now buy. 24 and 25 stops already
  // span four chunks, so chunk reconstruction is still fully exercised.
  it.each([
    [20, 1],
    [24, 4],
    [25, 4],
  ])('reconstructs a complete %i-stop matrix from %i chunk requests', async (stopCount, expectedRequests) => {
    const request = createMultiStopRequest(stopCount);
    const fetcher = createCompleteMatrixFetcher();
    const adapter = new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 25, { maxConcurrency: 2 });

    const result = await adapter.fetchMatrix(request, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(expectedRequests);
    expect(result.matrix.nodeIds).toHaveLength(stopCount + 2);
    expect(result.matrix.cells).toHaveLength(stopCount + 2);
    expect(result.matrix.cells.every((row) => row.length === stopCount + 2)).toBe(true);
    expect(result.completenessRatio).toBe(1);
    expect(result.externalRequestCount).toBe(expectedRequests);
  });

  it('reuses final chunk results without another provider call', async () => {
    const request = createMultiStopRequest(25);
    const fetcher = createCompleteMatrixFetcher();
    const adapter = new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 25, {
      cache: new MemoryGatewayResponseCache(),
      maxConcurrency: 2,
    });

    const first = await adapter.fetchMatrix(request, new AbortController().signal);
    const second = await adapter.fetchMatrix(request, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(first.externalRequestCount).toBe(4);
    expect(second.externalRequestCount).toBe(0);
    expect(second.billableElementCount).toBe(0);
    expect(second.matrix.cells).toEqual(first.matrix.cells);
  });

  it('keeps provider concurrency within the configured limit', async () => {
    const request = createMultiStopRequest(25);
    let active = 0;
    let maximumActive = 0;
    const base = createCompleteMatrixFetcher();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await base(url, init);
      } finally {
        active -= 1;
      }
    });
    const adapter = new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 25, { maxConcurrency: 2 });

    await adapter.fetchMatrix(request, new AbortController().signal);

    expect(maximumActive).toBeLessThanOrEqual(2);
  });

  it('splits requests into sub-matrix chunks when location count exceeds chunkSize', async () => {
    // 4 locations total (start + 2 stops + end), chunkSize = 2
    // Expected chunks: 2 origin chunks x 2 destination chunks = 4 HTTP requests
    const request = createMultiStopRequest(2);

    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        origins: Array<{ waypoint: { location: { latLng: { latitude: number; longitude: number } } } }>;
        destinations: Array<{ waypoint: { location: { latLng: { latitude: number; longitude: number } } } }>;
      };
      const numOrigins = body.origins.length;
      const numDestinations = body.destinations.length;

      // Mock Google response for sub-matrix
      const elements = [];
      for (let r = 0; r < numOrigins; r += 1) {
        for (let c = 0; c < numDestinations; c += 1) {
          elements.push({
            originIndex: r,
            destinationIndex: c,
            status: { code: 0 },
            condition: 'ROUTE_EXISTS',
            distanceMeters: 5000,
            duration: '600s',
          });
        }
      }

      return new Response(JSON.stringify(elements), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-goog-request-id': `req-chunk-${numOrigins}x${numDestinations}`,
        },
      });
    });

    const adapter = new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 2);
    const result = await adapter.fetchMatrix(request, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.matrix.nodeIds).toHaveLength(4);
    expect(result.matrix.cells).toHaveLength(4);
    expect(result.matrix.cells[0]).toHaveLength(4);
    expect(result.completenessRatio).toBe(1);

    // Verify cell content reconstructed across chunks
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        expect(result.matrix.cells[r][c]).toMatchObject({
          distanceKm: 5,
          durationMinutes: 10,
          reachable: true,
        });
      }
    }

    expect(result.matrix.warnings).toContain('Google matrica buvo sudaryta iš 4 sub-užklausų blokų.');
  });

  it('handles error when one sub-matrix request fails', async () => {
    const request = createMultiStopRequest(2);
    let callCount = 0;

    const fetcher = vi.fn(async () => {
      callCount += 1;
      if (callCount === 2) {
        return new Response(JSON.stringify({ error: { code: 503, message: 'Service Unavailable' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify([
          {
            originIndex: 0,
            destinationIndex: 0,
            status: { code: 0 },
            condition: 'ROUTE_EXISTS',
            distanceMeters: 1000,
            duration: '120s',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const adapter = new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 2);
    const promise = adapter.fetchMatrix(request, new AbortController().signal);

    await expect(promise).rejects.toMatchObject({
      code: 'PROVIDER_SERVER_ERROR',
    });
  });

  it('rejects an incomplete provider matrix instead of filling it synthetically', async () => {
    const request = createMultiStopRequest(2);
    const fetcher = vi.fn(async () => new Response(JSON.stringify([
      {
        originIndex: 0,
        destinationIndex: 0,
        status: { code: 0 },
        condition: 'ROUTE_EXISTS',
        distanceMeters: 0,
        duration: '0s',
      },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));
    const adapter = new GoogleMatrixAdapter('test-api-key', fetcher as typeof fetch, 25);

    await expect(adapter.fetchMatrix(request, new AbortController().signal)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_RESPONSE',
    });
  });
});

function createCompleteMatrixFetcher() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      origins: unknown[];
      destinations: unknown[];
    };
    const elements = [];
    for (let originIndex = 0; originIndex < body.origins.length; originIndex += 1) {
      for (let destinationIndex = 0; destinationIndex < body.destinations.length; destinationIndex += 1) {
        elements.push({
          originIndex,
          destinationIndex,
          status: { code: 0 },
          condition: 'ROUTE_EXISTS',
          distanceMeters: originIndex === destinationIndex ? 0 : 5000,
          duration: originIndex === destinationIndex ? '0s' : '600s',
        });
      }
    }
    return new Response(JSON.stringify(elements), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-goog-request-id': 'batch-request' },
    });
  });
}
