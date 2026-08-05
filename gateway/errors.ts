export type GatewayErrorCode =
  | 'AUTH_FAILED'
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_SERVER_ERROR'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_NETWORK_ERROR'
  | 'CACHE_MISS'
  | 'CACHE_STALE'
  | 'CONFIGURATION_ERROR';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly statusCode: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function providerHttpError(
  provider: string,
  status: number,
): GatewayError {
  if (status === 401 || status === 403) {
    return new GatewayError(
      'PROVIDER_AUTH_FAILED',
      `${provider} atmetė gateway autentifikaciją.`,
      502,
      false,
      { provider, providerStatus: status },
    );
  }
  if (status === 429) {
    return new GatewayError(
      'PROVIDER_RATE_LIMITED',
      `${provider} viršytas užklausų limitas.`,
      503,
      true,
      { provider, providerStatus: status },
    );
  }
  if (status >= 500) {
    return new GatewayError(
      'PROVIDER_SERVER_ERROR',
      `${provider} laikina serverio klaida.`,
      503,
      true,
      { provider, providerStatus: status },
    );
  }
  return new GatewayError(
    'PROVIDER_INVALID_RESPONSE',
    `${provider} grąžino HTTP ${status}.`,
    502,
    false,
    { provider, providerStatus: status },
  );
}

