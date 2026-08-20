import { describe, expect, it } from 'vitest';
import { loadGatewayConfig } from '../../gateway/config';

// CI kintamieji ir kopijavimas iš konsolės reguliariai atsineša tabą ar naują
// eilutę. Griežtas === tyliai palikdavo gateway išjungtą, o ekrane matėsi tik
// "adresas nepatvirtintas".
describe('GATEWAY_REAL_PROVIDER_ARMED atsparumas tarpams', () => {
  const base = { GOOGLE_MAPS_API_KEY: 'x', GATEWAY_AUTH_MODE: 'none' } as Record<string, string>;
  const armedFor = (value: string) =>
    loadGatewayConfig({ ...base, GATEWAY_REAL_PROVIDER_ARMED: value } as never).realProviderArmed;

  it.each(['1', ' 1', '\t1', '1\n', ' \t1 \r\n'])('reiksme %j ijungia realu rezima', (value) => {
    expect(armedFor(value)).toBe(true);
  });

  it.each(['0', '', ' ', 'true', '11', '1 0'])('reiksme %j palieka isjungta', (value) => {
    expect(armedFor(value)).toBe(false);
  });
});
