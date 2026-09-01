import { GatewayError } from './errors';
import type { GatewayProvider, PricingConfig } from './types';

export type GatewayConfig = {
  environment: 'development' | 'production';
  authMode: 'none' | 'hmac';
  host: string;
  port: number;
  appSecret: string;
  hereApiKey: string | null;
  googleApiKey: string | null;
  googleGeocodingApiKey: string | null;
  googleVisionApiKey: string | null;
  requestTimeoutMs: number;
  maxStops: number;
  maxBodyBytes: number;
  ocrMaxBodyBytes: number;
  rateLimitPerMinute: number;
  geocodeRateLimitPerMinute: number;
  matrixRateLimitPerMinute: number;
  polylineRateLimitPerMinute: number;
  ocrRateLimitPerMinute: number;
  cacheDirectory: string;
  responseCacheDirectory: string;
  geocodeMaxAddressLength: number;
  geocodeCacheTtlMs: number;
  polylineCacheTtlMs: number;
  allowedOrigin: string;
  liveCacheTtlMs: number;
  noTrafficCacheTtlMs: number;
  pricing: PricingConfig;
  realProviderArmed: boolean;
  usageDirectory: string;
  dailyUsageUnits: number;
  weeklyUsageUnits: number;
  dailyBudgetCents: number | null;
  weeklyBudgetCents: number | null;
};

const finiteNumber = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const positiveFiniteNumber = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
};

export function loadGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig {
  if (env === process.env && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch {}
  }
  const currency = env.ROUTING_PRICING_CURRENCY?.trim() || null;
  const pricing: PricingConfig = {
    currency,
    perThousandElements: {},
  };
  for (const [provider, name] of [
    ['here', 'HERE_PRICE_PER_1000_ELEMENTS'],
    ['google', 'GOOGLE_PRICE_PER_1000_ELEMENTS'],
  ] as const) {
    const raw = env[name];
    if (raw !== undefined) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || !currency) {
        throw new GatewayError(
          'CONFIGURATION_ERROR',
          `${name} turi būti neneigiamas skaičius, o valiuta – nustatyta.`,
          500,
          false,
        );
      }
      pricing.perThousandElements[provider as GatewayProvider] = value;
    }
  }
  const environment = env.GATEWAY_ENV === 'production' ? 'production' : 'development';
  const authMode = env.GATEWAY_AUTH_MODE
    ? (env.GATEWAY_AUTH_MODE === 'none' ? 'none' : 'hmac')
    : (environment === 'production' ? 'hmac' : 'none');
  const appSecret = cleanSecret(env.GATEWAY_DEVICE_SECRET) || cleanSecret(env.GATEWAY_APP_SECRET);
  if (environment === 'production' && authMode === 'hmac' && !appSecret) {
    throw new GatewayError(
      'CONFIGURATION_ERROR',
      'Production gateway nepaleistas: būtina aiški serverio autentifikacija.',
      500,
      false,
    );
  }
  // Same cleanSecret used for API keys: Secret Manager / .env pastes routinely
  // wrap values in quotes or leave a trailing newline. Those characters make
  // Google return 401/403 PROVIDER_AUTH_FAILED even when the underlying key is
  // valid — trim+dequote before first use.
  const googleApiKey =
    firstConfiguredSecret(
      env.GOOGLE_ROUTES_API_KEY,
      env.GOOGLE_API_KEY,
      env.GOOGLE_MAPS_API_KEY,
    );
  const googleGeocodingApiKey =
    firstConfiguredSecret(
      env.GOOGLE_GEOCODING_API_KEY,
      env.GOOGLE_MAPS_API_KEY,
      env.GOOGLE_API_KEY,
      env.GOOGLE_ROUTES_API_KEY,
    );
  const googleVisionApiKey =
    firstConfiguredSecret(
      env.GOOGLE_VISION_API_KEY,
      env.GOOGLE_API_KEY,
      env.GOOGLE_MAPS_API_KEY,
    );
  return {
    environment,
    authMode,
    host: env.GATEWAY_HOST?.trim() || '0.0.0.0',
    port: finiteNumber(env.GATEWAY_PORT, 8787),
    appSecret,
    hereApiKey: firstConfiguredSecret(env.HERE_API_KEY),
    googleApiKey,
    googleGeocodingApiKey,
    googleVisionApiKey,
    requestTimeoutMs: finiteNumber(env.GATEWAY_TIMEOUT_MS, 15_000),
    maxStops: Math.min(40, finiteNumber(env.GATEWAY_MAX_STOPS, 40)),
    maxBodyBytes: finiteNumber(env.GATEWAY_MAX_BODY_BYTES, 256 * 1024),
    ocrMaxBodyBytes: Math.min(
      20 * 1024 * 1024,
      finiteNumber(env.GATEWAY_OCR_MAX_BODY_BYTES, 12 * 1024 * 1024),
    ),
    // A single document import can legitimately issue hundreds of geocoding
    // requests. Keep a high global ceiling for storm protection and apply
    // lower, cost-aware limits to individual endpoints below.
    rateLimitPerMinute: positiveFiniteNumber(env.GATEWAY_RATE_LIMIT_PER_MINUTE, 800),
    geocodeRateLimitPerMinute: positiveFiniteNumber(
      env.GATEWAY_GEOCODE_RATE_LIMIT_PER_MINUTE,
      600,
    ),
    matrixRateLimitPerMinute: positiveFiniteNumber(
      env.GATEWAY_MATRIX_RATE_LIMIT_PER_MINUTE,
      30,
    ),
    polylineRateLimitPerMinute: positiveFiniteNumber(
      env.GATEWAY_POLYLINE_RATE_LIMIT_PER_MINUTE,
      30,
    ),
    ocrRateLimitPerMinute: positiveFiniteNumber(
      env.GATEWAY_OCR_RATE_LIMIT_PER_MINUTE,
      20,
    ),
    cacheDirectory:
      env.GATEWAY_CACHE_DIRECTORY?.trim() || '.gateway-cache/matrices',
    responseCacheDirectory:
      env.GATEWAY_RESPONSE_CACHE_DIRECTORY?.trim() || '.gateway-cache/responses',
    geocodeMaxAddressLength: Math.min(
      500,
      finiteNumber(env.GATEWAY_GEOCODE_MAX_ADDRESS_LENGTH, 300),
    ),
    geocodeCacheTtlMs: finiteNumber(
      env.GATEWAY_GEOCODE_CACHE_TTL_MS,
      30 * 24 * 60 * 60_000,
    ),
    polylineCacheTtlMs: finiteNumber(
      env.GATEWAY_POLYLINE_CACHE_TTL_MS,
      15 * 60_000,
    ),
    allowedOrigin:
      environment === 'development'
        ? env.GATEWAY_ALLOWED_ORIGIN?.trim() || '*'
        : env.GATEWAY_ALLOWED_ORIGIN?.trim() || '',
    liveCacheTtlMs: finiteNumber(env.GATEWAY_LIVE_CACHE_TTL_MS, 15 * 60_000),
    noTrafficCacheTtlMs: finiteNumber(
      env.GATEWAY_NO_TRAFFIC_CACHE_TTL_MS,
      24 * 60 * 60_000,
    ),
    pricing,
    // Trimmed before comparing. CI variables and console paste routinely carry a
    // stray tab or newline, and a strict === against an untrimmed value fails
    // silently: the gateway stays disarmed, every geocode returns 503, and the
    // screen only reports "address unconfirmed". That cost a full evening once.
    realProviderArmed: (env.GATEWAY_REAL_PROVIDER_ARMED ?? '').trim() === '1',
    usageDirectory: env.GATEWAY_USAGE_DIRECTORY?.trim() || '.gateway-cache/usage',
    dailyUsageUnits: positiveFiniteNumber(env.GATEWAY_DAILY_USAGE_UNITS, 7290),
    weeklyUsageUnits: positiveFiniteNumber(env.GATEWAY_WEEKLY_USAGE_UNITS, 36450),
    dailyBudgetCents: optionalBudgetCents(env.GATEWAY_DAILY_BUDGET_CENTS),
    weeklyBudgetCents: optionalBudgetCents(env.GATEWAY_WEEKLY_BUDGET_CENTS),
  };
}

function optionalBudgetCents(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new GatewayError('CONFIGURATION_ERROR', 'Routing piniginis biudžetas turi būti neneigiamas skaičius centais.', 500, false);
  return Math.floor(parsed);
}

export function requireRealProviderKeys(config: GatewayConfig): void {
  if (!config.hereApiKey && !config.googleApiKey) {
    throw new GatewayError(
      'CONFIGURATION_ERROR',
      'Real benchmark sustabdytas prieš tinklo užklausas: nesukonfigūruoti nei HERE, nei Google API raktai.',
      500,
      false,
      { missing: ['HERE_API_KEY', 'GOOGLE_ROUTES_API_KEY / GOOGLE_API_KEY / GOOGLE_MAPS_API_KEY'] },
    );
  }
}

/** Strip quotes/whitespace that break Google/HERE auth when pasted into secrets. */
export function cleanSecret(val: string | undefined): string {
  if (!val) return '';
  return val.trim().replace(/^["']|["']$/g, '').trim();
}

export function firstConfiguredSecret(
  ...candidates: Array<string | undefined>
): string | null {
  for (const candidate of candidates) {
    const cleaned = cleanSecret(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

/** Google API keys issued by Cloud Console start with AIza and are ~39 chars. */
export function looksLikeGoogleApiKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(value);
}

export type RoutingReadiness = {
  realProviderArmed: boolean;
  googleRoutesKeyConfigured: boolean;
  googleRoutesKeyLooksValid: boolean;
  googleGeocodingKeyConfigured: boolean;
  googleVisionKeyConfigured: boolean;
  hereKeyConfigured: boolean;
  /** Env var names the gateway will try for Routes/Matrix, in priority order. */
  googleRoutesSecretPriority: readonly string[];
};

export function routingReadiness(config: GatewayConfig): RoutingReadiness {
  return {
    realProviderArmed: config.realProviderArmed,
    googleRoutesKeyConfigured: Boolean(config.googleApiKey),
    googleRoutesKeyLooksValid: looksLikeGoogleApiKey(config.googleApiKey),
    googleGeocodingKeyConfigured: Boolean(config.googleGeocodingApiKey),
    googleVisionKeyConfigured: Boolean(config.googleVisionApiKey),
    hereKeyConfigured: Boolean(config.hereApiKey),
    googleRoutesSecretPriority: [
      'GOOGLE_ROUTES_API_KEY',
      'GOOGLE_API_KEY',
      'GOOGLE_MAPS_API_KEY',
    ],
  };
}
