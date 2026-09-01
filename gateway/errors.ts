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
  | 'REAL_PROVIDER_DISABLED'
  | 'ROUTING_BUDGET_EXCEEDED'
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

/** Safe Google RPC reason codes we surface as Lithuanian ops guidance. */
const GOOGLE_AUTH_REASON_HINTS: Record<string, string> = {
  API_KEY_INVALID:
    'Cloud Run Secret Manager raktas netinkamas arba sugadintas. Atnaujinkite GOOGLE_ROUTES_API_KEY (arba GOOGLE_API_KEY / GOOGLE_MAPS_API_KEY) be kabučių ir tarpų.',
  API_KEY_INVALID_ARGUMENT:
    'Cloud Run Secret Manager raktas netinkamas. Atnaujinkite GOOGLE_ROUTES_API_KEY (arba GOOGLE_API_KEY / GOOGLE_MAPS_API_KEY).',
  API_KEY_HTTP_REFERRER_BLOCKED:
    'Raktas apribotas HTTP refereriais – serveriui (Cloud Run) reikia IP/neriboto serverio rakto, ne naršyklės rakto.',
  API_KEY_IP_ADDRESS_BLOCKED:
    'Raktas apribotas IP adresais, kurie neatitinka Cloud Run išeinančio IP. Leiskite Cloud Run arba naudokite neribotą serverio raktą.',
  API_KEY_ANDROID_APP_BLOCKED:
    'Raktas apribotas Android programai – Cloud Run reikia serverio rakto be programos apribojimų.',
  API_KEY_IOS_APP_BLOCKED:
    'Raktas apribotas iOS programai – Cloud Run reikia serverio rakto be programos apribojimų.',
  SERVICE_DISABLED:
    'Google Cloud projekte įjunkite Routes API (routes.googleapis.com) ir palaukite kelias minutes.',
  ACCESS_TOKEN_SCOPE_INSUFFICIENT:
    'Raktui trūksta teisių Routes API. Patikrinkite API apribojimus Google Cloud konsolėje.',
  CONSUMER_INVALID:
    'Google Cloud projektas arba billing konfigūracija netinkama. Patikrinkite billing ir Routes API.',
  BILLING_DISABLED:
    'Google Cloud projekte įjunkite billing – be jo Routes API atmeta užklausas.',
};

export function parseProviderAuthHint(
  provider: string,
  responseBody: string | null | undefined,
): { reason: string | null; hint: string } {
  const fallbackHint =
    'Patikrinkite Cloud Run Secret Manager: GOOGLE_ROUTES_API_KEY (prioritetas), GOOGLE_API_KEY arba GOOGLE_MAPS_API_KEY; Google Cloud projekte įjunkite Routes API ir billing; raktas turi būti serverio tipo (be HTTP referer apribojimo).';

  if (!responseBody || !responseBody.trim()) {
    return { reason: null, hint: fallbackHint };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return { reason: null, hint: fallbackHint };
  }

  const error =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: unknown }).error
      : parsed;
  if (!error || typeof error !== 'object') {
    return { reason: null, hint: fallbackHint };
  }

  const record = error as {
    message?: unknown;
    status?: unknown;
    details?: unknown;
  };
  const message = typeof record.message === 'string' ? record.message : '';
  const details = Array.isArray(record.details) ? record.details : [];

  let reason: string | null = null;
  for (const detail of details) {
    if (detail && typeof detail === 'object' && 'reason' in detail) {
      const value = (detail as { reason?: unknown }).reason;
      if (typeof value === 'string' && value.trim()) {
        reason = value.trim();
        break;
      }
    }
  }

  const lower = message.toLowerCase();
  if (!reason) {
    if (lower.includes('api key not valid') || lower.includes('api key is invalid')) {
      reason = 'API_KEY_INVALID';
    } else if (lower.includes('referer') || lower.includes('referrer')) {
      reason = 'API_KEY_HTTP_REFERRER_BLOCKED';
    } else if (lower.includes('ip address')) {
      reason = 'API_KEY_IP_ADDRESS_BLOCKED';
    } else if (
      lower.includes('has not been used') ||
      lower.includes('is disabled') ||
      lower.includes('not enabled')
    ) {
      reason = 'SERVICE_DISABLED';
    } else if (lower.includes('billing')) {
      reason = 'BILLING_DISABLED';
    }
  }

  const hint = (reason && GOOGLE_AUTH_REASON_HINTS[reason]) || fallbackHint;
  // Never echo Google's raw message when it might embed project numbers we don't
  // control, and never include API keys. Reason codes alone are enough.
  void provider;
  return { reason, hint };
}

export function providerHttpError(
  provider: string,
  status: number,
  responseBody?: string | null,
): GatewayError {
  if (status === 401 || status === 403) {
    const { reason, hint } = parseProviderAuthHint(provider, responseBody);
    return new GatewayError(
      'PROVIDER_AUTH_FAILED',
      `${provider} atmetė gateway autentifikaciją (HTTP ${status}). ${hint}`,
      502,
      false,
      {
        provider,
        providerStatus: status,
        ...(reason ? { providerReason: reason } : {}),
        remediation: {
          secrets: [
            'GOOGLE_ROUTES_API_KEY',
            'GOOGLE_API_KEY',
            'GOOGLE_MAPS_API_KEY',
          ],
          apis: ['Routes API (routes.googleapis.com)'],
          flags: ['GATEWAY_REAL_PROVIDER_ARMED=1'],
        },
      },
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
