import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
    FileMatrixResultCache,
} from './cache/file-matrix-cache';
import {
    FileGatewayResponseCache,
} from './cache/file-response-cache';
import { loadGatewayConfig } from './config';
import { GatewayError } from './errors';
import { GoogleMatrixAdapter } from './providers/google-matrix-adapter';
import { HereMatrixAdapter } from './providers/here-matrix-adapter';
import {
    GatewayRateLimiter,
    SlidingWindowRateLimiter,
    type RateLimitedGatewayEndpoint,
} from './rate-limiter';
import { GatewayNonceRegistry, verifyGatewaySignature } from './security';
import { OptimizationGatewayService } from './service';
import { FileGatewayUsageGuard, FirestoreGatewayUsageGuard } from './usage-guard';
import {
    parseGatewayGeocodeRequest,
    parseGatewayMatrixRequest,
    parseGatewayOcrRequest,
    parseGatewayPolylineRequest,
} from './validation';

const config = loadGatewayConfig();
const nonceRegistry = new GatewayNonceRegistry();
const deviceConnectionLimiter = new SlidingWindowRateLimiter(60);
const responseCache = config.environment === 'production'
  ? new FileGatewayResponseCache(config.responseCacheDirectory)
  : new FileGatewayResponseCache(config.responseCacheDirectory);
const matrixCache = config.environment === 'production'
  ? new FileMatrixResultCache(config.cacheDirectory)
  : new FileMatrixResultCache(config.cacheDirectory);
const limiter = new GatewayRateLimiter({
  globalPerMinute: config.rateLimitPerMinute,
  endpointPerMinute: {
    '/v1/geocode': config.geocodeRateLimitPerMinute,
    '/v1/matrix': config.matrixRateLimitPerMinute,
    '/v1/polyline': config.polylineRateLimitPerMinute,
    '/v1/ocr/google': config.ocrRateLimitPerMinute,
  },
});
const service = new OptimizationGatewayService(
  config,
  {
    here: new HereMatrixAdapter(config.hereApiKey ?? ''),
    google: new GoogleMatrixAdapter(config.googleApiKey ?? '', fetch, 25, {
      cache: responseCache,
      maxConcurrency: 2,
      liveCacheTtlMs: config.liveCacheTtlMs,
      noTrafficCacheTtlMs: config.noTrafficCacheTtlMs,
    }),
  },
  matrixCache,
  (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  undefined,
  undefined,
  responseCache,
  undefined,
  config.environment === 'production'
    ? new FirestoreGatewayUsageGuard({
        armed: config.realProviderArmed,
        dailyUnits: config.dailyUsageUnits,
        weeklyUnits: config.weeklyUsageUnits,
        dailyBudgetCents: config.dailyBudgetCents,
        weeklyBudgetCents: config.weeklyBudgetCents,
      })
    : new FileGatewayUsageGuard(config.usageDirectory, {
        armed: config.realProviderArmed,
        dailyUnits: config.dailyUsageUnits,
        weeklyUnits: config.weeklyUsageUnits,
        dailyBudgetCents: config.dailyBudgetCents,
        weeklyBudgetCents: config.weeklyBudgetCents,
      }),
);

export const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': config.allowedOrigin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers':
          'content-type, x-routing-timestamp, x-routing-nonce, x-routing-signature, x-routing-cache-mode, x-request-id',
        'access-control-max-age': '86400',
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, {
        status: 'ok',
        environment: config.environment,
        authentication: config.authMode,
      });
    }
    if (
      request.method !== 'POST' ||
      !['/v1/matrix', '/v1/polyline', '/v1/geocode', '/v1/ocr/google', '/v1/device/check'].includes(request.url ?? '')
    ) {
      return json(response, 404, { error: { code: 'NOT_FOUND' } });
    }
    const client = request.socket.remoteAddress ?? 'unknown';
    const endpoint = request.url;
    if (endpoint === '/v1/device/check' && !deviceConnectionLimiter.consume(client)) {
      throw new GatewayError(
        'RATE_LIMITED',
        'Per daug įrenginio prijungimo bandymų. Saugiai pakartokite vėliau.',
        429,
        true,
        { endpoint, scope: 'endpoint', maximum: 60, windowSeconds: 60 },
      );
    }
    const rateLimit = endpoint === '/v1/device/check'
      ? null
      : limiter.consume(client, endpoint as RateLimitedGatewayEndpoint);
    if (rateLimit && !rateLimit.allowed) {
      process.stdout.write(`${JSON.stringify({
        event: 'gateway_rate_limited',
        endpoint,
        scope: rateLimit.scope,
        maximum: rateLimit.maximum,
        windowSeconds: rateLimit.windowMs / 1000,
      })}\n`);
      throw new GatewayError(
        'RATE_LIMITED',
        'Viršytas gateway užklausų limitas.',
        429,
        true,
        {
          endpoint,
          scope: rateLimit.scope,
          maximum: rateLimit.maximum,
          windowSeconds: rateLimit.windowMs / 1000,
        },
      );
    }
    const rawBody = await readBody(
      request,
      request.url === '/v1/ocr/google' ? config.ocrMaxBodyBytes : config.maxBodyBytes,
    );
    if (config.authMode === 'hmac') {
      verifyGatewaySignature({
        secret: config.appSecret,
        timestamp: header(request, 'x-routing-timestamp'),
        signature: header(request, 'x-routing-signature'),
        nonce: header(request, 'x-routing-nonce'),
        rawBody,
        nonceRegistry,
        requireNonce: config.environment === 'production',
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new GatewayError(
        'INVALID_REQUEST',
        'Užklausos kūnas nėra JSON.',
        400,
        false,
      );
    }

    if (request.url === '/v1/device/check') {
      return json(response, 200, { status: 'connected' });
    }

    if (request.url === '/v1/geocode') {
      const geocodeRequest = parseGatewayGeocodeRequest(
        parsed,
        config.geocodeMaxAddressLength,
      );
      const result = await service.geocode(geocodeRequest);
      process.stdout.write(`${JSON.stringify({
        event: 'gateway_request',
        endpoint: '/v1/geocode',
        outcome: 'success',
        cacheStatus: result.gatewayMetadata.cacheHit ? 'hit' : 'miss',
        externalRequestCount: result.gatewayMetadata.externalRequestCount,
      })}\n`);
      return json(response, 200, result);
    }

    if (request.url === '/v1/ocr/google') {
      const ocrRequest = parseGatewayOcrRequest(parsed);
      const result = await service.recognizeDocument(ocrRequest);
      process.stdout.write(`${JSON.stringify({
        event: 'gateway_request',
        endpoint: '/v1/ocr/google',
        outcome: 'success',
        provider: result.provider,
        pageCount: result.pageCount,
        confidence: result.confidence,
      })}\n`);
      return json(response, 200, result);
    }

    if (request.url === '/v1/polyline') {
      const polylineRequest = parseGatewayPolylineRequest(parsed);
      const result = await service.getRoutePolyline(polylineRequest);
      process.stdout.write(`${JSON.stringify({
        event: 'gateway_request',
        endpoint: '/v1/polyline',
        outcome: 'success',
        cacheStatus: result.executionMode === 'cache' ? 'hit' : 'miss',
        externalRequestCount: result.executionMode === 'cache' ? 0 : 1,
      })}\n`);
      return json(response, 200, result);
    }

    const matrixRequest = parseGatewayMatrixRequest(parsed, config.maxStops);
    const mode =
      header(request, 'x-routing-cache-mode') === 'refresh'
        ? 'refresh'
        : header(request, 'x-routing-cache-mode') === 'cache-only'
          ? 'cache-only'
          : 'real';
    const result = await service.getMatrix(matrixRequest, mode);
    return json(response, 200, result);
  } catch (error) {
    console.error(JSON.stringify({ event: 'gateway_error_caught', error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) }));
    const safe =
      error instanceof GatewayError
        ? error
        : new GatewayError(
            'PROVIDER_NETWORK_ERROR',
            'Vidinė gateway klaida.',
            500,
            true,
          );
    const retryAfterSeconds =
      safe.statusCode === 429 &&
      safe.details &&
      typeof safe.details === 'object' &&
      'windowSeconds' in safe.details &&
      typeof safe.details.windowSeconds === 'number'
        ? Math.max(1, Math.ceil(safe.details.windowSeconds))
        : null;
    return json(
      response,
      safe.statusCode,
      {
        error: {
          code: safe.code,
          message: safe.message,
          retryable: safe.retryable,
          details: safe.details,
        },
      },
      retryAfterSeconds === null
        ? undefined
        : { 'retry-after': String(retryAfterSeconds) },
    );
  }
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: 'gateway_started',
      host: config.host,
      port: config.port,
      providersConfigured: {
        here: Boolean(config.hereApiKey),
        google: Boolean(config.googleApiKey),
        googleGeocoding: Boolean(config.googleGeocodingApiKey),
        googleVision: Boolean(config.googleVisionApiKey),
      },
      environment: config.environment,
      authentication: config.authMode,
    })}\n`,
  );
});

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      throw new GatewayError(
        'PAYLOAD_TOO_LARGE',
        'Gateway užklausa per didelė.',
        413,
        false,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': config.allowedOrigin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers':
      'content-type, x-routing-timestamp, x-routing-nonce, x-routing-signature, x-routing-cache-mode, x-request-id',
    'access-control-expose-headers': 'retry-after',
    ...headers,
  });
  response.end(JSON.stringify(body));
}
