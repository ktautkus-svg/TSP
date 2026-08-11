import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { MatrixRequest, TravelMatrix } from '../../src/domain/routing/models';
import { GatewayGeocodingProvider } from '../../src/infrastructure/routing/providers/gateway-geocoding-provider';
import { GatewayPolylineProvider } from '../../src/infrastructure/routing/providers/gateway-polyline-provider';
import { GatewayTravelCostProvider } from '../../src/infrastructure/routing/providers/gateway-travel-cost-provider';

const start = { id: 'start', label: 'Startas', latitude: 54.68, longitude: 25.27 };
const stop = { id: 'stop', label: 'Taškas', latitude: 54.69, longitude: 25.28 };
const end = { id: 'end', label: 'Pabaiga', latitude: 54.68, longitude: 25.27 };
const matrixRequest: MatrixRequest = {
  locations: [start, stop, end],
  vehicle: {
    id: 'van',
    type: 'van',
    maximumPayloadKg: 1000,
    useRoadRestrictions: false,
    startLocation: start,
    defaultEndLocation: end,
  },
  departureAt: '2026-08-03T08:00:00.000Z',
  trafficMode: 'live',
  timeoutMs: 1000,
};

function matrixResponse(): TravelMatrix {
  const cell = { distanceKm: 0, durationMinutes: 0, reachable: true, maneuverPenalty: 0, restrictionWarnings: [] };
  return {
    provider: 'google',
    executionMode: 'real',
    nodeIds: ['start', 'stop', 'end'],
    cells: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ ...cell }))),
    fetchedAt: new Date().toISOString(),
    trafficMode: 'live',
    departureAt: matrixRequest.departureAt,
    warnings: [],
    version: 'test',
  };
}

describe('gateway clients in a Node environment', () => {
  it('uses the injected matrix fetcher and exact normalized custom endpoint', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(matrixResponse()));
    const provider = new GatewayTravelCostProvider(
      'google',
      'https://gateway.example.test/custom-matrix/',
      fetcher as typeof fetch,
    );
    await provider.getMatrix(matrixRequest);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe('https://gateway.example.test/custom-matrix');
  });

  it('uses the injected polyline fetcher and exact normalized custom endpoint', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ encodedPolyline: 'abc' }));
    const provider = new GatewayPolylineProvider(
      'https://gateway.example.test/custom-polyline/',
      fetcher as typeof fetch,
    );
    await provider.fetchPolyline({ startLocation: start, orderedStops: [stop], endLocation: end });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe('https://gateway.example.test/custom-polyline');
  });

  it('reads only the safe gateway error code and message', async () => {
    const fetcher = vi.fn(async () => Response.json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Patikrinkite adresą.',
        details: { stack: 'secret stack', apiKey: 'secret' },
      },
    }, { status: 400 }));
    await expect(
      new GatewayGeocodingProvider('https://gateway.example.test/geocode', fetcher as typeof fetch)
        .geocode('x'),
    ).rejects.toMatchObject({
      message: '[INVALID_REQUEST] Patikrinkite adresą.',
      code: 'INVALID_REQUEST',
      statusCode: 400,
    });
  });

  it('does not require or mock window.fetch', () => {
    expect(typeof globalThis.fetch).toBe('function');
    expect('window' in globalThis).toBe(false);
  });

  it('keeps localhost:8787 out of production src', async () => {
    for (const file of await sourceFiles(resolve('src'))) {
      expect(await readFile(file, 'utf8'), file).not.toContain('localhost:8787');
    }
  }, 15_000);
});

async function sourceFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(path)));
    else result.push(path);
  }
  return result;
}
