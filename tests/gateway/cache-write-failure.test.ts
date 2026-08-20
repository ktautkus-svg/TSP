import { describe, expect, it, vi } from 'vitest';
import { FileGatewayResponseCache } from '../../gateway/cache/file-response-cache';

// Cloud Run konteinerio failų sistema yra tik skaitymui. Anksčiau kešo įrašymas
// metė EACCES, ir jau gautas (bei apmokėtas) Google atsakymas būdavo išmestas
// kartu su 500 klaida. Kešas yra pagreitinimas, o ne būtina sąlyga.
describe('kešo įrašymo klaida nenutraukia užklausos', () => {
  it('set() nemeta klaidos, kai katalogas neįrašomas', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Nuoroda į kelią, kurio sukurti neįmanoma.
      const cache = new FileGatewayResponseCache('\0neimanomas-kelias');
      await expect(cache.set('geocode', 'raktas', { ok: true }, 60_000)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = String(warn.mock.calls[0]![0]);
      expect(logged).toContain('gateway_cache_write_unavailable');

      // Pakartotinis nesėkmingas įrašymas nebeprikuria triukšmo.
      await cache.set('geocode', 'raktas2', { ok: true }, 60_000);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('nepavykus įrašyti, vėlesnis get() tiesiog praneša miss', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cache = new FileGatewayResponseCache('\0neimanomas-kelias');
      await cache.set('geocode', 'raktas', { ok: true }, 60_000);
      expect((await cache.get('geocode', 'raktas')).status).toBe('miss');
    } finally {
      warn.mockRestore();
    }
  });
});
