import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { authenticateApiRequest, ensureAugust2026ExcelBackfillMigrated, ensureFuelAugust2026Migrated, ensureTripSheetAugust2026VehicleFixMigrated, handleEmployeeApi, requireProductionAdminPin } from './employee-api.js';
import { EmployeeApiError } from './employee-auth-store.js';

const publicPort = numberFromEnv('PORT', 8080);
const internalGatewayPort = numberFromEnv('INTERNAL_GATEWAY_PORT', 8788);
const distDirectory = resolve(process.env.PWA_DIST_DIRECTORY ?? 'dist');
const requestTimeoutMs = numberFromEnv('SERVER_REQUEST_TIMEOUT_MS', 30_000);

process.env.GATEWAY_ENV = 'production';
process.env.GATEWAY_AUTH_MODE = 'none';
process.env.GATEWAY_HOST = '127.0.0.1';
process.env.GATEWAY_PORT = String(internalGatewayPort);
process.env.GATEWAY_ALLOWED_ORIGIN = '';

async function start(): Promise<void> {
  requireProductionAdminPin();
  // Apply the one-shot August 2026 MET/NLL fuel reset before accepting traffic
  // so the first trip-sheet request already sees the corrected Firestore data.
  await ensureFuelAugust2026Migrated();
  // Then correct completed August 2026 vehicle/driver on trip sheets without
  // touching stop punctuality.
  await ensureTripSheetAugust2026VehicleFixMigrated();
  // Then materialize missing August 2026 Excel trip sheets (historical complete,
  // no provider matrix). v1 then v2 then v3 then v4. v3 does not swallow fleet-create
  // failures. v4 syncs listed trip-sheet driver snapshots and does not swallow
  // errors. Runs after fuel + vehicle-fix so odometer overlays apply.
  await ensureAugust2026ExcelBackfillMigrated();
  const server = createServer(async (request, response) => {
    const requestId = header(request, 'x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');

    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/health') {
        return json(response, 200, {
          status: 'ok',
          service: 'logistikos-pristatymai-pwa',
          version: process.env.APP_VERSION ?? 'development',
        });
      }
      if (await handleEmployeeApi(request, response, url.pathname, requestId)) return;
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname !== '/api/device/check') await authenticateApiRequest(request);
        return proxyApi(request, response, url.pathname, requestId);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
      }
      return serveApplication(url.pathname, response, request.method === 'HEAD');
    } catch (error) {
      log({ event: 'request_failed', requestId, error: safeError(error) });
      if (!response.headersSent) {
        if (error instanceof EmployeeApiError) {
          return json(response, error.status, { error: { code: error.code, message: error.message } });
        }
        return json(response, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Serveris laikinai negali įvykdyti užklausos.',
          },
        });
      }
      response.end();
    }
  });

  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = requestTimeoutMs + 5_000;
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(publicPort, '0.0.0.0', () => {
      log({
        event: 'pwa_server_started',
        port: publicPort,
        internalGatewayPort,
        version: process.env.APP_VERSION ?? 'development',
      });
      resolveListen();
    });
  });

  const { server: gatewayServer } = await import('../gateway/server.js');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log({ event: 'shutdown_started', signal });
      server.close(() => gatewayServer.close(() => process.exit(0)));
      (setTimeout(() => process.exit(1), 10_000) as unknown as { unref: () => void }).unref();
    });
  }
}

void start().catch((error) => {
  log({ event: 'startup_failed', error: safeError(error) });
  process.exitCode = 1;
});

async function proxyApi(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  pathname: string,
  requestId: string,
): Promise<void> {
  const route = apiRoute(pathname);
  if (!route) return json(outgoing, 404, { error: { code: 'NOT_FOUND' } });
  if (incoming.method !== 'POST') {
    return json(outgoing, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const proxied = httpRequest({
      host: '127.0.0.1',
      port: internalGatewayPort,
      path: route,
      method: 'POST',
      headers: forwardedHeaders(incoming, requestId),
      timeout: requestTimeoutMs,
    }, (gatewayResponse) => {
      outgoing.writeHead(gatewayResponse.statusCode ?? 502, {
        'content-type': String(gatewayResponse.headers['content-type'] ?? 'application/json; charset=utf-8'),
        'cache-control': 'no-store',
        ...(gatewayResponse.headers['retry-after']
          ? { 'retry-after': String(gatewayResponse.headers['retry-after']) }
          : {}),
        'x-request-id': requestId,
      });
      gatewayResponse.pipe(outgoing);
      gatewayResponse.on('end', resolvePromise);
    });
    proxied.on('timeout', () => proxied.destroy(new Error('Gateway timeout')));
    proxied.on('error', rejectPromise);
    incoming.pipe(proxied);
  });
}

function apiRoute(pathname: string): string | null {
  return ({
    '/api/geocode': '/v1/geocode',
    '/api/matrix': '/v1/matrix',
    '/api/routes': '/v1/polyline',
    '/api/ocr': '/v1/ocr/google',
    '/api/device/check': '/v1/device/check',
  } as Record<string, string>)[pathname] ?? null;
}

function forwardedHeaders(request: IncomingMessage, requestId: string): Record<string, string> {
  const allowed = [
    'content-type',
    'content-length',
    'x-routing-timestamp',
    'x-routing-nonce',
    'x-routing-signature',
    'x-routing-cache-mode',
    'authorization',
  ];
  const result: Record<string, string> = { 'x-request-id': requestId };
  for (const name of allowed) {
    const value = header(request, name);
    if (value) result[name] = value;
  }
  result['x-tsp-rate-limit-key'] = rateLimitKey(request);
  return result;
}

function rateLimitKey(request: IncomingMessage): string {
  const cookie = header(request, 'cookie') ?? '';
  const session = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('tsp_session='));
  if (session) return `session:${session.slice('tsp_session='.length, 'tsp_session='.length + 24)}`;
  const forwarded = header(request, 'x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return `ip:${forwarded}`;
  return `ip:${request.socket.remoteAddress ?? 'unknown'}`;
}

async function serveApplication(pathname: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = normalize(join(distDirectory, relativePath || 'index.html'));
  const safeCandidate = candidate.startsWith(distDirectory) ? candidate : join(distDirectory, 'index.html');
  const file = await isFile(safeCandidate) ? safeCandidate : join(distDirectory, 'index.html');
  if (!existsSync(file)) return json(response, 503, { error: { code: 'PWA_BUILD_MISSING' } });

  const extension = extname(file).toLowerCase();
  response.writeHead(200, {
    'content-type': mimeType(extension),
    'cache-control': cacheControl(file, extension),
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'credentialless',
  });
  if (headOnly) {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function mimeType(extension: string): string {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function cacheControl(file: string, extension: string): string {
  if (extension === '.html' || file.endsWith('service-worker.js')) return 'no-cache';
  if (/[.-][a-f0-9]{8,}\./i.test(file)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function log(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'Unknown error';
}
