import { GatewayError, providerHttpError } from '../errors';

const GOOGLE_DEPARTURE_LEAD_MS = 60_000;

export function normalizeGoogleDepartureAt(departureAt: string, nowMs = Date.now()): string {
  const requestedMs = Date.parse(departureAt);
  if (!Number.isFinite(requestedMs)) {
    throw new GatewayError('INVALID_REQUEST', 'Išvykimo laikas netinkamas.', 400, false);
  }
  return new Date(Math.max(requestedMs, nowMs + GOOGLE_DEPARTURE_LEAD_MS)).toISOString();
}

export async function fetchProviderJson(input: {
  provider: string;
  url: string;
  init: RequestInit;
  fetcher: typeof fetch;
}): Promise<{ payload: unknown; headers: Headers; responseMs: number }> {
  const started = performance.now();
  let response: Response;
  try {
    response = await input.fetcher(input.url, input.init);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new GatewayError(
        'PROVIDER_TIMEOUT',
        `${input.provider} užklausa viršijo laiko limitą.`,
        504,
        true,
        { provider: input.provider },
      );
    }
    throw new GatewayError(
      'PROVIDER_NETWORK_ERROR',
      `${input.provider} tinklo užklausa nepavyko.`,
      503,
      true,
      { provider: input.provider },
    );
  }
  const responseMs = performance.now() - started;
  if (!response.ok) throw providerHttpError(input.provider, response.status);
  try {
    return {
      payload: await response.json(),
      headers: response.headers,
      responseMs,
    };
  } catch {
    throw new GatewayError(
      'PROVIDER_INVALID_RESPONSE',
      `${input.provider} grąžino ne JSON atsakymą.`,
      502,
      false,
      { provider: input.provider },
    );
  }
}

export function invalidProviderPayload(
  provider: string,
  reason: string,
): never {
  throw new GatewayError(
    'PROVIDER_INVALID_RESPONSE',
    `${provider} atsakymo schema neteisinga: ${reason}.`,
    502,
    false,
    { provider, reason },
  );
}
