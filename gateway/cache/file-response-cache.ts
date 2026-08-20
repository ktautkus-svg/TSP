import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type CacheEntry<T> = {
  key: string;
  storedAt: string;
  expiresAt: string;
  value: T;
};

export type ResponseCacheLookup<T> =
  | { status: 'miss' }
  | { status: 'fresh' | 'stale'; entry: CacheEntry<T> };

export interface GatewayResponseCache {
  key(namespace: string, identity: unknown): string;
  get<T>(namespace: string, key: string, now?: Date): Promise<ResponseCacheLookup<T>>;
  set<T>(namespace: string, key: string, value: T, ttlMs: number, now?: Date): Promise<void>;
}

export class FileGatewayResponseCache implements GatewayResponseCache {
  private writeFailureReported = false;

  constructor(private readonly rootDirectory: string) {}

  key(namespace: string, identity: unknown): string {
    return createHash('sha256')
      .update(`${namespace}:${JSON.stringify(identity)}`)
      .digest('hex');
  }

  async get<T>(namespace: string, key: string, now = new Date()): Promise<ResponseCacheLookup<T>> {
    try {
      const entry = JSON.parse(
        await readFile(join(this.rootDirectory, namespace, `${key}.json`), 'utf8'),
      ) as CacheEntry<T>;
      if (entry.key !== key || !Number.isFinite(Date.parse(entry.expiresAt))) {
        return { status: 'miss' };
      }
      return {
        status: Date.parse(entry.expiresAt) > now.getTime() ? 'fresh' : 'stale',
        entry,
      };
    } catch {
      return { status: 'miss' };
    }
  }

  async set<T>(
    namespace: string,
    key: string,
    value: T,
    ttlMs: number,
    now = new Date(),
  ): Promise<void> {
    // A cache is an optimisation, never a precondition. On Cloud Run the
    // container filesystem is read-only, so mkdir threw EACCES and a perfectly
    // good geocode result was discarded with a 500 - the address had already
    // been resolved by Google and paid for. get() has always swallowed its
    // failures; set() now does the same and simply reports the miss.
    try {
      const file = join(this.rootDirectory, namespace, `${key}.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          key,
          storedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
          value,
        } satisfies CacheEntry<T>),
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch (error) {
      if (!this.writeFailureReported) {
        this.writeFailureReported = true;
        // eslint-disable-next-line no-console
        console.warn(JSON.stringify({
          event: 'gateway_cache_write_unavailable',
          directory: this.rootDirectory,
          reason: error instanceof Error ? error.message : 'unknown',
        }));
      }
    }
  }
}

export class MemoryGatewayResponseCache implements GatewayResponseCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  key(namespace: string, identity: unknown): string {
    return createHash('sha256')
      .update(`${namespace}:${JSON.stringify(identity)}`)
      .digest('hex');
  }

  async get<T>(namespace: string, key: string, now = new Date()): Promise<ResponseCacheLookup<T>> {
    const entry = this.entries.get(`${namespace}:${key}`) as CacheEntry<T> | undefined;
    if (!entry) return { status: 'miss' };
    return {
      status: Date.parse(entry.expiresAt) > now.getTime() ? 'fresh' : 'stale',
      entry,
    };
  }

  async set<T>(namespace: string, key: string, value: T, ttlMs: number, now = new Date()) {
    this.entries.set(`${namespace}:${key}`, {
      key,
      storedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      value,
    });
  }
}
