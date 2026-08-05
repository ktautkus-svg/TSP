import { describe, expect, it, vi } from 'vitest';
import { MemoryMatrixResultCache } from '../../gateway/cache/file-matrix-cache';
import { loadGatewayConfig } from '../../gateway/config';
import { normalizeHereMatrix } from '../../gateway/providers/here-matrix-adapter';
import {
  GatewayRateLimiter,
  SlidingWindowRateLimiter,
} from '../../gateway/rate-limiter';
import { OptimizationGatewayService } from '../../gateway/service';
import type { MatrixProviderAdapter } from '../../gateway/types';
import { gatewayRequest } from './helpers';

describe('gateway service', () => {
  it('uses fresh cache and makes no second external call', async () => {
    const request = gatewayRequest('here');
    const normalized = normalizeHereMatrix(
      {
        matrixId: 'x',
        matrix: {
          numOrigins: 3,
          numDestinations: 3,
          travelTimes: Array(9).fill(1),
          distances: Array(9).fill(1),
          errorCodes: Array(9).fill(0),
        },
      },
      request,
      5,
    );
    const adapter: MatrixProviderAdapter = {
      provider: 'here',
      version: 'test-v1',
      capabilities: {
        trafficSupported: true,
        predictiveTrafficSupported: true,
        truckRestrictionsSupported: true,
        vehicleDimensionsSupported: true,
        asymmetricMatrixSupported: true,
        departureTimeSupported: true,
        maneuverMetadataSupported: false,
        maximumMatrixElements: 100,
        executionMode: 'real',
      },
      fetchMatrix: vi.fn(async () => normalized),
    };
    const service = new OptimizationGatewayService(
      loadGatewayConfig({
        HERE_API_KEY: 'configured',
        GOOGLE_ROUTES_API_KEY: 'configured',
      }),
      { here: adapter, google: { ...adapter, provider: 'google' } },
      new MemoryMatrixResultCache(),
    );
    const first = await service.getMatrix(request, 'real');
    const second = await service.getMatrix(request, 'real');
    expect(first.executionMode).toBe('real');
    expect(second.executionMode).toBe('cache');
    expect(second.gatewayMetadata.usage.externalRequestCount).toBe(0);
    expect(adapter.fetchMatrix).toHaveBeenCalledOnce();
  });

  it('cache-only fails closed on miss and real fails without key', async () => {
    const adapter = {
      provider: 'here',
      version: 'test-v1',
      capabilities: {
        trafficSupported: true,
        predictiveTrafficSupported: true,
        truckRestrictionsSupported: false,
        vehicleDimensionsSupported: false,
        asymmetricMatrixSupported: true,
        departureTimeSupported: true,
        maneuverMetadataSupported: false,
        maximumMatrixElements: 100,
        executionMode: 'real',
      },
      fetchMatrix: vi.fn(),
    } satisfies MatrixProviderAdapter;
    const service = new OptimizationGatewayService(
      loadGatewayConfig({}),
      { here: adapter, google: { ...adapter, provider: 'google' } },
      new MemoryMatrixResultCache(),
    );
    await expect(service.getMatrix(gatewayRequest(), 'cache-only')).rejects.toMatchObject({
      code: 'CACHE_MISS',
    });
    await expect(service.getMatrix(gatewayRequest(), 'real')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
    expect(adapter.fetchMatrix).not.toHaveBeenCalled();
  });
});

describe('gateway rate limiter', () => {
  it('limits each client inside a sliding window', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    expect(limiter.consume('client', 1000)).toBe(true);
    expect(limiter.consume('client', 1100)).toBe(true);
    expect(limiter.consume('client', 1200)).toBe(false);
    expect(limiter.consume('client', 2101)).toBe(true);
  });

  it('uses production-shaped defaults suitable for one personal client', () => {
    const config = loadGatewayConfig({});
    expect(config.rateLimitPerMinute).toBe(800);
    expect(config.geocodeRateLimitPerMinute).toBe(600);
    expect(config.matrixRateLimitPerMinute).toBe(30);
    expect(config.polylineRateLimitPerMinute).toBe(30);
    expect(config.ocrRateLimitPerMinute).toBe(20);
  });

  it('keeps independent endpoint budgets for the same client', () => {
    const limiter = new GatewayRateLimiter({
      globalPerMinute: 10,
      endpointPerMinute: {
        '/v1/geocode': 2,
        '/v1/matrix': 2,
        '/v1/polyline': 2,
        '/v1/ocr/google': 2,
      },
    });
    expect(limiter.consume('client', '/v1/geocode', 1000)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/geocode', 1100)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/geocode', 1200)).toMatchObject({
      allowed: false,
      scope: 'endpoint',
      maximum: 2,
    });
    expect(limiter.consume('client', '/v1/matrix', 1300)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/ocr/google', 1400)).toEqual({ allowed: true });
  });

  it('retains a global per-client storm ceiling across all endpoints', () => {
    const limiter = new GatewayRateLimiter({
      globalPerMinute: 3,
      endpointPerMinute: {
        '/v1/geocode': 10,
        '/v1/matrix': 10,
        '/v1/polyline': 10,
        '/v1/ocr/google': 10,
      },
    });
    expect(limiter.consume('client', '/v1/geocode', 1000)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/matrix', 1100)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/polyline', 1200)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/ocr/google', 1300)).toMatchObject({
      allowed: false,
      scope: 'global',
      maximum: 3,
    });
    expect(limiter.consume('other-client', '/v1/ocr/google', 1300)).toEqual({ allowed: true });
    expect(limiter.consume('client', '/v1/ocr/google', 61_001)).toEqual({ allowed: true });
  });

  it('allows a normal nine-stop workflow including one remaining-route recalculation', () => {
    const config = loadGatewayConfig({});
    const limiter = new GatewayRateLimiter({
      globalPerMinute: config.rateLimitPerMinute,
      endpointPerMinute: {
        '/v1/geocode': config.geocodeRateLimitPerMinute,
        '/v1/matrix': config.matrixRateLimitPerMinute,
        '/v1/polyline': config.polylineRateLimitPerMinute,
        '/v1/ocr/google': config.ocrRateLimitPerMinute,
      },
    });
    const workflow = [
      '/v1/ocr/google',
      ...Array(11).fill('/v1/geocode'), // 9 stops plus start and end
      '/v1/matrix',
      '/v1/polyline',
      '/v1/matrix', // one recalculation
      '/v1/polyline',
    ] as const;
    for (const [index, endpoint] of workflow.entries()) {
      expect(limiter.consume('personal-driver', endpoint, 1_000 + index)).toEqual({ allowed: true });
    }
  });
});
