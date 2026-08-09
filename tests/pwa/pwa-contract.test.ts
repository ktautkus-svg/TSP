import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  clearGatewayDeviceSecret,
  createGatewayAuthorizationHeaders,
  saveGatewayDeviceSecret,
} from '../../src/infrastructure/gateway/device-auth';
import { GatewayNonceRegistry, verifyGatewaySignature } from '../../gateway/security';

describe('production PWA contract', () => {
  it('has a valid standalone Lithuanian manifest with maskable icons', async () => {
    const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
    expect(manifest).toMatchObject({
      id: '/', start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait', lang: 'lt',
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512', purpose: expect.stringContaining('maskable') }),
    ]));
  });

  it('uses SPA web output and registers a production service worker', async () => {
    const app = JSON.parse(await readFile('app.json', 'utf8'));
    const runtime = await readFile('src/components/pwa-runtime.tsx', 'utf8');
    expect(app.expo.web.output).toBe('single');
    expect(runtime).toContain("register('/service-worker.js'");
    expect(runtime).toContain('Yra nauja aplikacijos versija');
  });

  it('patches the exported HTML with a locked iPhone viewport', async () => {
    const builder = await readFile('scripts/pwa-build.mjs', 'utf8');
    expect(builder).toContain('width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1');
    expect(builder).toContain('-webkit-text-size-adjust: 100%');
    expect(builder).toContain('max-width: 100vw');
    expect(builder).toContain('font-size: 16px !important');
  });

  it('keeps API requests network-only in the service worker', async () => {
    const worker = await readFile('public/service-worker.js', 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("request.method !== 'GET'");
  });

  it('creates browser-compatible nonce HMAC accepted once by gateway', async () => {
    const secret = 'a'.repeat(64);
    const body = '{"address":"Vilniaus g. 1"}';
    await saveGatewayDeviceSecret(secret);
    const headers = await createGatewayAuthorizationHeaders(body);
    const registry = new GatewayNonceRegistry();
    const input = {
      secret,
      timestamp: headers['x-routing-timestamp'],
      nonce: headers['x-routing-nonce'],
      signature: headers['x-routing-signature'],
      rawBody: body,
      nowMs: Number(headers['x-routing-timestamp']),
      nonceRegistry: registry,
      requireNonce: true,
    };
    expect(() => verifyGatewaySignature(input)).not.toThrow();
    expect(() => verifyGatewaySignature(input)).toThrow();
    await clearGatewayDeviceSecret();
  });
});
