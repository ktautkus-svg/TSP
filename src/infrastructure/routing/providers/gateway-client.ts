import { createGatewayAuthorizationHeaders } from '@/infrastructure/gateway/device-auth';

export type SafeGatewayError = {
  code: string | null;
  message: string;
  endpoint: string | null;
  retryAfterSeconds: number | null;
};

export const DEFAULT_GATEWAY_BASE_URL = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() || '';

export function gatewayEndpoint(path: string, baseUrl = DEFAULT_GATEWAY_BASE_URL): string {
  if (!baseUrl.trim() && typeof window !== 'undefined') {
    const productionPath = ({
      '/v1/geocode': '/api/geocode',
      '/v1/matrix': '/api/matrix',
      '/v1/polyline': '/api/routes',
      '/v1/ocr/google': '/api/ocr',
    } as Record<string, string>)[`/${path.replace(/^\/+/, '')}`];
    return productionPath ?? `/api/${path.replace(/^\/+/, '').replace(/^v1\//, '')}`;
  }
  if (!baseUrl.trim()) {
    throw new Error('Gateway adresas nenustatytas. Sukonfigūruokite EXPO_PUBLIC_GATEWAY_URL.');
  }
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

export const platformFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const rawBody = typeof init?.body === 'string' ? init.body : null;
  if (method !== 'POST' || rawBody === null) return globalThis.fetch(input, init);
  const authorization = await createGatewayAuthorizationHeaders(rawBody);
  return globalThis.fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init?.headers as Record<string, string> | undefined), ...authorization },
  });
};

export async function readSafeGatewayError(
  response: Response,
  fallbackMessage: string,
): Promise<SafeGatewayError> {
  const retryAfterHeader = response.headers.get('retry-after');
  const parsedRetryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  const headerRetryAfterSeconds = Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0
    ? Math.ceil(parsedRetryAfter)
    : null;
  try {
    const payload = (await response.json()) as unknown;
    const candidate =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error?: unknown }).error
        : payload;
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      const details = record.details && typeof record.details === 'object'
        ? record.details as Record<string, unknown>
        : {};
      const endpoint = typeof details.endpoint === 'string' ? details.endpoint : null;
      const detailsWindow = typeof details.windowSeconds === 'number'
        ? Math.max(0, Math.ceil(details.windowSeconds))
        : null;
      const retryAfterSeconds = headerRetryAfterSeconds ?? detailsWindow;
      const baseMessage =
        typeof record.message === 'string' && record.message.trim()
          ? record.message
          : fallbackMessage;
      const context = [
        endpoint ? `Endpointas: ${endpoint}.` : null,
        retryAfterSeconds !== null ? `Saugiai pakartokite po ${retryAfterSeconds} s.` : null,
      ].filter(Boolean).join(' ');
      return {
        code: typeof record.code === 'string' ? record.code : null,
        message: context ? `${baseMessage} ${context}` : baseMessage,
        endpoint,
        retryAfterSeconds,
      };
    }
  } catch {
    // Only a local fallback reaches the UI when the gateway body is not safe JSON.
  }
  return {
    code: null,
    message: headerRetryAfterSeconds === null
      ? fallbackMessage
      : `${fallbackMessage} Saugiai pakartokite po ${headerRetryAfterSeconds} s.`,
    endpoint: null,
    retryAfterSeconds: headerRetryAfterSeconds,
  };
}
