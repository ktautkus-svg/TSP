import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({
  File: class {
    constructor(readonly uri: string) {}
    async base64() {
      return `native:${this.uri}`;
    }
  },
}));

import { isWebUri, readUriAsBase64 } from '@/infrastructure/import/read-uri-base64';

describe('readUriAsBase64', () => {
  it('naršyklės adresus (data:, blob:, https:) skaito per fetch, o ne per expo-file-system', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([104, 101, 108, 108, 111])));
    await expect(readUriAsBase64('blob:https://firo.example/abc', fetcher as unknown as typeof fetch)).resolves.toBe('aGVsbG8=');
    expect(fetcher).toHaveBeenCalledWith('blob:https://firo.example/abc');
    await expect(readUriAsBase64('data:text/plain;base64,aGVsbG8=')).resolves.toBe('aGVsbG8=');
  });

  it('telefono programoje (file://) naudoja expo-file-system', async () => {
    await expect(readUriAsBase64('file:///data/foto.jpg')).resolves.toBe('native:file:///data/foto.jpg');
    expect(isWebUri('file:///data/foto.jpg')).toBe(false);
  });

  it('praneša apie nepavykusį nuskaitymą', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    await expect(readUriAsBase64('blob:x', fetcher as unknown as typeof fetch)).rejects.toThrow('HTTP 404');
  });

  it('dideli failai nesumažina tikslumo (be perpildymo)', async () => {
    const big = new Uint8Array(200_000).fill(7);
    const fetcher = vi.fn(async () => new Response(big));
    const encoded = await readUriAsBase64('blob:big', fetcher as unknown as typeof fetch);
    expect(Buffer.from(encoded, 'base64').equals(Buffer.from(big))).toBe(true);
  });
});
