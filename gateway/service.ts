import type { RoutePolylineResult } from '../src/domain/routing/models';
import type { MatrixResultCache } from './cache/file-matrix-cache';
import {
    FileGatewayResponseCache,
    MemoryGatewayResponseCache,
    type GatewayResponseCache,
} from './cache/file-response-cache';
import type { GatewayConfig } from './config';
import { GatewayError } from './errors';
import { GoogleGeocodingAdapter } from './providers/google-geocoding-adapter';
import { GoogleRoutesAdapter } from './providers/google-routes-adapter';
import { GoogleVisionAdapter } from './providers/google-vision-adapter';
import type {
    GatewayGeocodeRequest,
    GatewayGeocodeResponse,
    GatewayMatrixRequest,
    GatewayMatrixResponse,
    GatewayOcrRequest,
    GatewayOcrResponse,
    GatewayPolylineRequest,
    GatewayProvider,
    GatewayRunMode,
    MatrixProviderAdapter,
    ProviderFetchResult,
} from './types';
import { MemoryGatewayUsageGuard, type GatewayUsageGuard } from './usage-guard';

export type GatewayAuditEvent = {
  at: string;
  matrixId: string;
  provider: GatewayProvider;
  mode: GatewayRunMode;
  outcome: 'success' | 'error';
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypass';
  responseMs: number;
  providerResponseMs: number | null;
  externalRequestCount: number;
  elementCount: number;
  completenessRatio: number | null;
  errorCode: string | null;
};

export class OptimizationGatewayService {
  /**
   * Shares an unfinished matrix request across callers. A result cache only
   * helps after the first call finishes; without this map, two browser tabs or
   * rapid remounts can miss together and both buy the same n x n matrix.
   */
  private readonly inFlightMatrices = new Map<string, Promise<ProviderFetchResult>>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly adapters: Record<GatewayProvider, MatrixProviderAdapter>,
    private readonly cache: MatrixResultCache,
    private readonly audit: (event: GatewayAuditEvent) => void = () => undefined,
    private readonly routesAdapter: GoogleRoutesAdapter = new GoogleRoutesAdapter(
      config.googleApiKey ?? '',
    ),
    private readonly geocodingAdapter: GoogleGeocodingAdapter = new GoogleGeocodingAdapter(
      config.googleGeocodingApiKey ?? '',
    ),
    private readonly responseCache: GatewayResponseCache = config.environment === 'production'
      ? new MemoryGatewayResponseCache()
      : new FileGatewayResponseCache(config.responseCacheDirectory),
    private readonly visionAdapter: GoogleVisionAdapter = new GoogleVisionAdapter(
      config.googleVisionApiKey ?? '',
    ),
    private readonly usageGuard: GatewayUsageGuard = new MemoryGatewayUsageGuard({
      armed: true,
      dailyUnits: Number.MAX_SAFE_INTEGER,
      weeklyUnits: Number.MAX_SAFE_INTEGER,
      dailyBudgetCents: null,
      weeklyBudgetCents: null,
    }),
  ) {}

  async recognizeDocument(request: GatewayOcrRequest): Promise<GatewayOcrResponse> {
    await this.usageGuard.reserve(1, null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(this.config.requestTimeoutMs, 30_000));
    try {
      return await this.visionAdapter.recognize(request, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }

  async geocode(request: GatewayGeocodeRequest): Promise<GatewayGeocodeResponse> {
    if (!this.config.googleGeocodingApiKey) {
      throw new GatewayError(
        'CONFIGURATION_ERROR',
        'Google serverio API raktas nesukonfigūruotas.',
        500,
        false,
      );
    }
    const key = this.responseCache.key('geocode', {
      address: request.address.toLocaleLowerCase('lt-LT'),
      adapterVersion: this.geocodingAdapter.version,
    });
    const cached = await this.responseCache.get<{
      candidates: GatewayGeocodeResponse['alternatives'];
    }>('geocode', key);
    if (cached.status === 'fresh') {
      return this.toGeocodeResponse(request.address, cached.entry.value.candidates, true, 0);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      await this.usageGuard.reserve(1, null);
      const { candidates, responseMs } = await this.geocodingAdapter.geocode(
        request,
        controller.signal,
      );
      if (candidates.length > 0) {
        await this.responseCache.set(
          'geocode',
          key,
          { candidates },
          this.config.geocodeCacheTtlMs,
        );
      }
      return this.toGeocodeResponse(request.address, candidates, false, responseMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getRoutePolyline(
    request: GatewayPolylineRequest,
  ): Promise<RoutePolylineResult> {
    if (request.provider !== 'google') {
      throw new GatewayError(
        'INVALID_REQUEST',
        'Polyline užklausai šiuo metu palaikomas tik google provideris.',
        400,
        false,
      );
    }
    if (!this.config.googleApiKey) {
      throw new GatewayError(
        'CONFIGURATION_ERROR',
        'GOOGLE serverio API raktas nesukonfigūruotas.',
        500,
        false,
      );
    }
    const key = this.responseCache.key('polyline', {
      request,
      adapterVersion: this.routesAdapter.version,
    });
    const cached = await this.responseCache.get<RoutePolylineResult>('polyline', key);
    if (cached.status === 'fresh') {
      return { ...cached.entry.value, executionMode: 'cache' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      await this.usageGuard.reserve(1, null);
      const result = await this.routesAdapter.fetchRoutePolyline(request, controller.signal);
      await this.responseCache.set(
        'polyline',
        key,
        result,
        this.config.polylineCacheTtlMs,
      );
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private toGeocodeResponse(
    query: string,
    candidates: GatewayGeocodeResponse['alternatives'],
    cacheHit: boolean,
    providerResponseMs: number,
  ): GatewayGeocodeResponse {
    // components=country:LT should already keep results in Lithuania, but a
    // bounding-box check is kept as a second layer: it stops a single
    // geographically implausible match from ever being auto-accepted as
    // "unambiguous" instead of surfaced for manual confirmation.
    const plausible = candidates.filter(isWithinLithuania);
    const isUnambiguous = plausible.length === 1;
    return {
      query,
      isUnambiguous,
      result: isUnambiguous ? plausible[0] : null,
      alternatives: candidates,
      executionMode: cacheHit ? 'cache' : 'real',
      gatewayMetadata: {
        cacheHit,
        externalRequestCount: cacheHit ? 0 : 1,
        providerResponseMs,
      },
    };
  }

  async getMatrix(
    request: GatewayMatrixRequest,
    mode: Exclude<GatewayRunMode, 'synthetic'> = 'real',
  ): Promise<GatewayMatrixResponse> {
    const started = performance.now();
    const adapter = this.adapters[request.provider];
    const key = this.cache.createKey(request, adapter.version);
    const lookup = await this.cache.get(key);
    const elementCount = (request.stops.length + 2) ** 2;
    if (mode !== 'refresh' && lookup.status === 'fresh') {
      const response = this.toResponse(
        request,
        lookup.entry.result,
        true,
        lookup.entry.storedAt,
        0,
        performance.now() - started,
      );
      this.record(request, mode, 'success', 'hit', response, elementCount, started);
      return response;
    }
    if (mode === 'cache-only') {
      const code = lookup.status === 'stale' ? 'CACHE_STALE' : 'CACHE_MISS';
      const error = new GatewayError(
        code,
        lookup.status === 'stale'
          ? 'Cache įrašas pasenęs; reali užklausa cache-only režime nevykdoma.'
          : 'Cache įrašo nėra; reali užklausa cache-only režime nevykdoma.',
        404,
        false,
        { provider: request.provider, matrixId: request.matrixId },
      );
      this.recordError(
        request,
        mode,
        lookup.status === 'stale' ? 'stale' : 'miss',
        elementCount,
        started,
        error,
      );
      throw error;
    }

    const keyValue =
      request.provider === 'here'
        ? this.config.hereApiKey
        : this.config.googleApiKey;
    if (!keyValue) {
      const error = new GatewayError(
        'CONFIGURATION_ERROR',
        `${request.provider.toUpperCase()} serverio API raktas nesukonfigūruotas.`,
        500,
        false,
        { provider: request.provider },
      );
      this.recordError(request, mode, 'miss', elementCount, started, error);
      throw error;
    }
    const shared = mode === 'refresh' ? undefined : this.inFlightMatrices.get(key);
    if (shared) {
      try {
        const result = await shared;
        const response = this.toResponse(
          request,
          result,
          true,
          result.matrix.fetchedAt,
          0,
          performance.now() - started,
        );
        this.record(request, mode, 'success', 'hit', response, elementCount, started);
        return response;
      } catch (error) {
        const gatewayError = error instanceof GatewayError
          ? error
          : new GatewayError(
              'PROVIDER_NETWORK_ERROR',
              'Nežinoma providerio klaida.',
              503,
              true,
              { provider: request.provider },
            );
        this.recordError(request, mode, 'miss', elementCount, started, gatewayError, 0);
        throw gatewayError;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    let operation: Promise<ProviderFetchResult> | null = null;
    try {
      const price = this.config.pricing.perThousandElements[request.provider];
      if (this.config.environment === 'production' && price === undefined) {
        throw new GatewayError(
          'CONFIGURATION_ERROR',
          `${request.provider.toUpperCase()} matricos kaina nesukonfigūruota. Mokama užklausa saugiai sustabdyta.`,
          500,
          false,
          { provider: request.provider },
        );
      }
      const estimatedCostCents = price === undefined ? null : (elementCount * price) / 10;
      operation = (async () => {
        await this.usageGuard.reserve(elementCount, estimatedCostCents);
        const result = await adapter.fetchMatrix(request, controller.signal, {
          bypassCache: mode === 'refresh',
        });
        const ttl =
          request.trafficMode === 'none'
            ? this.config.noTrafficCacheTtlMs
            : this.config.liveCacheTtlMs;
        await this.cache.set(key, result, ttl);
        return result;
      })();
      if (mode !== 'refresh') this.inFlightMatrices.set(key, operation);
      const result = await operation;
      const response = this.toResponse(
        request,
        result,
        false,
        null,
        result.externalRequestCount ?? 1,
        performance.now() - started,
        result.billableElementCount,
      );
      this.record(
        request,
        mode,
        'success',
        mode === 'refresh' ? 'bypass' : lookup.status === 'stale' ? 'stale' : 'miss',
        response,
        elementCount,
        started,
      );
      return response;
    } catch (error) {
      const gatewayError =
        error instanceof GatewayError
          ? error
          : new GatewayError(
              'PROVIDER_NETWORK_ERROR',
              'Nežinoma providerio klaida.',
              503,
              true,
              { provider: request.provider },
            );
      this.recordError(
        request,
        mode,
        mode === 'refresh' ? 'bypass' : lookup.status === 'stale' ? 'stale' : 'miss',
        elementCount,
        started,
        gatewayError,
        1,
      );
      throw gatewayError;
    } finally {
      if (operation && this.inFlightMatrices.get(key) === operation) {
        this.inFlightMatrices.delete(key);
      }
      clearTimeout(timeout);
    }
  }

  private toResponse(
    request: GatewayMatrixRequest,
    result: ProviderFetchResult,
    cacheHit: boolean,
    cacheStoredAt: string | null,
    externalRequestCount: number,
    totalResponseMs: number,
    billableElementCount?: number,
  ): GatewayMatrixResponse {
    const elements = (request.stops.length + 2) ** 2;
    const price = this.config.pricing.perThousandElements[request.provider];
    return {
      ...result.matrix,
      executionMode: cacheHit ? 'cache' : 'real',
      gatewayMetadata: {
        matrixId: request.matrixId,
        providerRequestId: result.providerRequestId,
        providerResponseMs: result.responseMs,
        totalResponseMs,
        completenessRatio: result.completenessRatio,
        cacheHit,
        cacheStoredAt,
        capabilities: this.adapters[request.provider].capabilities,
        usage: {
          unitName: 'matrix_elements',
          matrixElements: elements,
          units: externalRequestCount ? billableElementCount ?? elements : 0,
          externalRequestCount,
          estimatedCost:
            price === undefined
              ? null
              : externalRequestCount
                ? ((billableElementCount ?? elements) * price) / 1000
                : 0,
          currency:
            price === undefined ? null : this.config.pricing.currency,
        },
        adapterVersion: this.adapters[request.provider].version,
        timeZone: 'Europe/Vilnius',
      },
    };
  }

  private record(
    request: GatewayMatrixRequest,
    mode: GatewayRunMode,
    outcome: 'success',
    cacheStatus: GatewayAuditEvent['cacheStatus'],
    response: GatewayMatrixResponse,
    elementCount: number,
    started: number,
  ) {
    this.audit({
      at: new Date().toISOString(),
      matrixId: request.matrixId,
      provider: request.provider,
      mode,
      outcome,
      cacheStatus,
      responseMs: performance.now() - started,
      providerResponseMs: response.gatewayMetadata.providerResponseMs,
      externalRequestCount:
        response.gatewayMetadata.usage.externalRequestCount,
      elementCount,
      completenessRatio: response.gatewayMetadata.completenessRatio,
      errorCode: null,
    });
  }

  private recordError(
    request: GatewayMatrixRequest,
    mode: GatewayRunMode,
    cacheStatus: GatewayAuditEvent['cacheStatus'],
    elementCount: number,
    started: number,
    error: GatewayError,
    externalRequestCount = 0,
  ) {
    this.audit({
      at: new Date().toISOString(),
      matrixId: request.matrixId,
      provider: request.provider,
      mode,
      outcome: 'error',
      cacheStatus,
      responseMs: performance.now() - started,
      providerResponseMs: null,
      externalRequestCount,
      elementCount,
      completenessRatio: null,
      errorCode: error.code,
    });
  }
}

// Generous Lithuania bounding box (includes a margin so valid near-border
// addresses aren't rejected) used to sanity-check geocoding results.
const LITHUANIA_BOUNDS = { minLat: 53.5, maxLat: 56.6, minLng: 20.5, maxLng: 27.0 };

function isWithinLithuania(candidate: { latitude: number; longitude: number }): boolean {
  return (
    candidate.latitude >= LITHUANIA_BOUNDS.minLat &&
    candidate.latitude <= LITHUANIA_BOUNDS.maxLat &&
    candidate.longitude >= LITHUANIA_BOUNDS.minLng &&
    candidate.longitude <= LITHUANIA_BOUNDS.maxLng
  );
}
