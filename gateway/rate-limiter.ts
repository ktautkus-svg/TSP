export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maximum: number,
    private readonly windowMs = 60_000,
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const active = (this.hits.get(key) ?? []).filter((time) => time > cutoff);
    if (active.length >= this.maximum) {
      this.hits.set(key, active);
      return false;
    }
    active.push(now);
    this.hits.set(key, active);
    return true;
  }
}

export type RateLimitedGatewayEndpoint =
  | '/v1/geocode'
  | '/v1/matrix'
  | '/v1/polyline'
  | '/v1/ocr/google';

export type GatewayRateLimitProfile = {
  globalPerMinute: number;
  endpointPerMinute: Record<RateLimitedGatewayEndpoint, number>;
};

export type GatewayRateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      scope: 'global' | 'endpoint';
      maximum: number;
      windowMs: number;
    };

/**
 * Applies a broad per-client storm limit plus an independent budget for each
 * endpoint. A burst of geocoding requests therefore cannot exhaust the OCR,
 * matrix or polyline budgets, while the global ceiling still caps all traffic.
 */
export class GatewayRateLimiter {
  private readonly windowMs = 60_000;
  private readonly global: SlidingWindowRateLimiter;
  private readonly endpoints: Record<RateLimitedGatewayEndpoint, SlidingWindowRateLimiter>;

  constructor(private readonly profile: GatewayRateLimitProfile) {
    this.global = new SlidingWindowRateLimiter(profile.globalPerMinute, this.windowMs);
    this.endpoints = {
      '/v1/geocode': new SlidingWindowRateLimiter(
        profile.endpointPerMinute['/v1/geocode'],
        this.windowMs,
      ),
      '/v1/matrix': new SlidingWindowRateLimiter(
        profile.endpointPerMinute['/v1/matrix'],
        this.windowMs,
      ),
      '/v1/polyline': new SlidingWindowRateLimiter(
        profile.endpointPerMinute['/v1/polyline'],
        this.windowMs,
      ),
      '/v1/ocr/google': new SlidingWindowRateLimiter(
        profile.endpointPerMinute['/v1/ocr/google'],
        this.windowMs,
      ),
    };
  }

  consume(
    client: string,
    endpoint: RateLimitedGatewayEndpoint,
    now = Date.now(),
  ): GatewayRateLimitDecision {
    if (!this.global.consume(client, now)) {
      return {
        allowed: false,
        scope: 'global',
        maximum: this.profile.globalPerMinute,
        windowMs: this.windowMs,
      };
    }
    if (!this.endpoints[endpoint].consume(client, now)) {
      return {
        allowed: false,
        scope: 'endpoint',
        maximum: this.profile.endpointPerMinute[endpoint],
        windowMs: this.windowMs,
      };
    }
    return { allowed: true };
  }
}
