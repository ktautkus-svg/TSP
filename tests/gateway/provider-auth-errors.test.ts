import { describe, expect, it } from 'vitest';
import {
  cleanSecret,
  firstConfiguredSecret,
  loadGatewayConfig,
  looksLikeGoogleApiKey,
  routingReadiness,
} from '../../gateway/config';
import { parseProviderAuthHint, providerHttpError } from '../../gateway/errors';

describe('API key secret cleaning', () => {
  it('strips surrounding quotes and whitespace from Secret Manager pastes', () => {
    expect(cleanSecret('  "AIzaSyDummyTestKeyValue0000000000000"\n')).toBe(
      'AIzaSyDummyTestKeyValue0000000000000',
    );
    expect(cleanSecret("'here-key'")).toBe('here-key');
    expect(cleanSecret('   ')).toBe('');
    expect(firstConfiguredSecret('  ', '"AIzaSyFallbackKeyValue00000000000000"')).toBe(
      'AIzaSyFallbackKeyValue00000000000000',
    );
  });

  it('uses cleaned Google key priority in loadGatewayConfig', () => {
    const config = loadGatewayConfig({
      GATEWAY_AUTH_MODE: 'none',
      GOOGLE_ROUTES_API_KEY: '  "AIzaSyRoutesKeyValue000000000000000"  ',
      GOOGLE_API_KEY: 'AIzaSyApiKeyShouldNotWin000000000000',
      GATEWAY_REAL_PROVIDER_ARMED: '\t1\n',
    } as never);
    expect(config.googleApiKey).toBe('AIzaSyRoutesKeyValue000000000000000');
    expect(config.realProviderArmed).toBe(true);
    expect(looksLikeGoogleApiKey(config.googleApiKey)).toBe(true);
    expect(routingReadiness(config)).toMatchObject({
      realProviderArmed: true,
      googleRoutesKeyConfigured: true,
      googleRoutesKeyLooksValid: true,
      googleRoutesSecretPriority: [
        'GOOGLE_ROUTES_API_KEY',
        'GOOGLE_API_KEY',
        'GOOGLE_MAPS_API_KEY',
      ],
    });
  });

  it('falls through an empty quoted GOOGLE_ROUTES_API_KEY to GOOGLE_API_KEY', () => {
    const config = loadGatewayConfig({
      GATEWAY_AUTH_MODE: 'none',
      GOOGLE_ROUTES_API_KEY: '""',
      GOOGLE_API_KEY: 'AIzaSyApiKeyAfterEmptyRoutes00000000',
    } as never);
    expect(config.googleApiKey).toBe('AIzaSyApiKeyAfterEmptyRoutes00000000');
  });
});

describe('PROVIDER_AUTH_FAILED guidance', () => {
  it('maps Google reason codes to Secret Manager / Routes API / billing hints', () => {
    const cases: Array<[string, RegExp]> = [
      ['API_KEY_INVALID', /GOOGLE_ROUTES_API_KEY/],
      ['API_KEY_HTTP_REFERRER_BLOCKED', /referer|serverio/i],
      ['SERVICE_DISABLED', /Routes API/],
      ['BILLING_DISABLED', /billing/i],
    ];
    for (const [reason, pattern] of cases) {
      const { hint } = parseProviderAuthHint(
        'Google Routes',
        JSON.stringify({
          error: {
            code: 403,
            message: 'blocked',
            details: [{ reason }],
          },
        }),
      );
      expect(hint).toMatch(pattern);
      expect(hint).not.toMatch(/AIza/);
    }
  });

  it('keeps remediation metadata for clients without embedding secret values', () => {
    const error = providerHttpError(
      'Google Routes',
      403,
      JSON.stringify({
        error: {
          message: 'API key not valid. Please pass a valid API key.',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      }),
    );
    expect(error.code).toBe('PROVIDER_AUTH_FAILED');
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/GOOGLE_ROUTES_API_KEY/);
    expect(error.message).not.toContain('valid API key.');
    expect(error.details).toMatchObject({
      providerReason: 'API_KEY_INVALID',
      remediation: {
        secrets: ['GOOGLE_ROUTES_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_MAPS_API_KEY'],
        apis: ['Routes API (routes.googleapis.com)'],
        flags: ['GATEWAY_REAL_PROVIDER_ARMED=1'],
      },
    });
  });
});
