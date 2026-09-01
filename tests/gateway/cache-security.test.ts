import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryMatrixResultCache } from '../../gateway/cache/file-matrix-cache';
import { signGatewayBody, verifyGatewaySignature } from '../../gateway/security';
import { normalizeHereMatrix } from '../../gateway/providers/here-matrix-adapter';
import { gatewayRequest } from './helpers';
import { loadGatewayConfig } from '../../gateway/config';

describe('gateway cache and signature', () => {
  it('refuses production startup without explicit authentication', () => {
    expect(() => loadGatewayConfig({ GATEWAY_ENV: 'production' })).toThrow();
    expect(
      loadGatewayConfig({
        GATEWAY_ENV: 'production',
        GATEWAY_AUTH_MODE: 'hmac',
        GATEWAY_APP_SECRET: 'server-only-secret',
        GATEWAY_ALLOWED_ORIGIN: 'https://app.example.test',
      }).environment,
    ).toBe('production');
    expect(
      loadGatewayConfig({
        GATEWAY_ENV: 'production',
        GATEWAY_AUTH_MODE: 'none',
      }).authMode,
    ).toBe('none');
  });
  it('keeps HERE departure identity but ignores time Google never sends', () => {
    const cache = new MemoryMatrixResultCache();
    const request = gatewayRequest();
    const first = cache.createKey(request, 'v1');
    expect(cache.createKey({ ...request, departureAt: '2026-08-03T05:30:00Z' }, 'v1')).not.toBe(first);
    expect(cache.createKey(request, 'v2')).not.toBe(first);

    const google = gatewayRequest('google');
    expect(cache.createKey({ ...google, departureAt: '2026-08-03T05:30:00Z' }, 'v1'))
      .toBe(cache.createKey(google, 'v1'));
  });

  it('fails closed when an armed production Google gateway has no price', () => {
    expect(() => loadGatewayConfig({
      GATEWAY_ENV: 'production',
      GATEWAY_AUTH_MODE: 'none',
      GATEWAY_REAL_PROVIDER_ARMED: '1',
      GOOGLE_ROUTES_API_KEY: 'configured',
    })).toThrow(/GOOGLE_PRICE_PER_1000_ELEMENTS/);

    expect(() => loadGatewayConfig({
      GATEWAY_ENV: 'production',
      GATEWAY_AUTH_MODE: 'none',
      GATEWAY_REAL_PROVIDER_ARMED: '1',
      GOOGLE_ROUTES_API_KEY: 'configured',
      ROUTING_PRICING_CURRENCY: 'USD',
      GOOGLE_PRICE_PER_1000_ELEMENTS: '10',
    })).not.toThrow();
  });

  it('distinguishes fresh and stale traffic cache', async () => {
    const cache = new MemoryMatrixResultCache();
    const request = gatewayRequest();
    const key = cache.createKey(request, 'v1');
    const fixture = JSON.parse(
      await readFile(resolve('gateway/fixtures/here-matrix-success.json'), 'utf8'),
    );
    const result = normalizeHereMatrix(fixture, request, 10);
    await cache.set(key, result, 1000, new Date('2026-01-01T00:00:00Z'));
    expect(
      (await cache.get(key, new Date('2026-01-01T00:00:00.500Z'))).status,
    ).toBe('fresh');
    expect(
      (await cache.get(key, new Date('2026-01-01T00:00:02Z'))).status,
    ).toBe('stale');
  });

  it('accepts valid HMAC and rejects tampering or replay', () => {
    const secret = 'personal-secret';
    const timestamp = '100000';
    const rawBody = '{"provider":"here"}';
    const signature = signGatewayBody(secret, timestamp, rawBody);
    expect(() =>
      verifyGatewaySignature({
        secret,
        timestamp,
        rawBody,
        signature,
        nowMs: 100000,
      }),
    ).not.toThrow();
    expect(() =>
      verifyGatewaySignature({
        secret,
        timestamp,
        rawBody: `${rawBody} `,
        signature,
        nowMs: 100000,
      }),
    ).toThrow();
    expect(() =>
      verifyGatewaySignature({
        secret,
        timestamp,
        rawBody,
        signature,
        nowMs: 1_000_000,
      }),
    ).toThrow();
  });
});
