import { describe, expect, it } from 'vitest';

import {
  buildOptimizationRequestFromPoints,
  extractCity,
  extractCompany,
  extractStreet,
  extractTimeWindow,
  normalizeProviderDepartureAt,
  parseDeliveryText,
} from '../../src/application/parsing/text-parser';

describe('text-parser', () => {
  describe('normalizeProviderDepartureAt', () => {
    const now = Date.parse('2026-08-01T15:05:30.000Z');

    it('moves a current or past minute safely into the provider future window', () => {
      expect(normalizeProviderDepartureAt('2026-08-01T15:05:00.000Z', now)).toBe(
        '2026-08-01T15:06:30.000Z',
      );
    });

    it('preserves a user-selected future departure', () => {
      expect(normalizeProviderDepartureAt('2026-08-01T16:00:00.000Z', now)).toBe(
        '2026-08-01T16:00:00.000Z',
      );
    });

    it('rejects an invalid departure timestamp', () => {
      expect(() => normalizeProviderDepartureAt('not-a-date', now)).toThrow();
    });
  });

  describe('buildOptimizationRequestFromPoints', () => {
    it('does not impose fixed workday or delivery-hour constraints', () => {
      const request = buildOptimizationRequestFromPoints(
        [
          {
            street: 'Savanorių pr. 1',
            city: 'Vilnius',
            timeWindow: { from: '08:00', to: '10:00', raw: '08:00-10:00' },
            company: '',
            fullAddress: 'Savanorių pr. 1, Vilnius',
            rawText: 'Savanorių pr. 1, Vilnius, 08:00-10:00',
            geocode: {
              normalizedAddress: 'Savanorių pr. 1, Vilnius, Lithuania',
              latitude: 54.68,
              longitude: 25.26,
              placeId: 'test-place',
              locationType: 'ROOFTOP',
              resultTypes: ['street_address'],
            },
          },
        ],
        {
          departureAt: '2099-08-01T21:00:00.000Z',
          startLocation: {
            normalizedAddress: 'Kirtimų g. 47, Vilnius, Lithuania',
            latitude: 54.625,
            longitude: 25.147,
            placeId: 'test-start',
            locationType: 'ROOFTOP',
            resultTypes: ['street_address'],
          },
        },
      );

      expect(request.workdayEndAt).toBeUndefined();
      expect(request.stops[0].requiredTimeWindow).toBeUndefined();
    });
  });

  describe('extractTimeWindow', () => {
    it('extracts standard time window format (08:00-10:00)', () => {
      const result = extractTimeWindow('Pristatymas 08:00-10:00 ryte');
      expect(result).toEqual({
        from: '08:00',
        to: '10:00',
        raw: '08:00-10:00',
      });
    });

    it('extracts single digit hours and spaces (8:00 - 9:30)', () => {
      const result = extractTimeWindow('8:00 - 9:30');
      expect(result).toEqual({
        from: '08:00',
        to: '09:30',
        raw: '8:00 - 9:30',
      });
    });

    it('returns null when no time window is present', () => {
      expect(extractTimeWindow('Nėra laiko')).toBeNull();
    });
  });

  describe('extractCompany', () => {
    it('extracts UAB company name', () => {
      expect(extractCompany('Atsakinga įmonė UAB Lambda LT')).toBe('UAB Lambda LT');
    });

    it('extracts quoted company name', () => {
      expect(extractCompany('Revizija "UAB Lambda LT"')).toBe('UAB Lambda LT');
    });

    it('returns empty string when no company prefix is found', () => {
      expect(extractCompany('Joniškėlio g. 1, Pasvalys')).toBe('');
    });
  });

  describe('extractStreet', () => {
    it('extracts street address with g.', () => {
      expect(extractStreet('Adresas: Joniškėlio g. 1, Pasvalys')).toBe('Joniškėlio g. 1');
    });

    it('extracts street with avenue abbreviation (al.) and house number with letter', () => {
      expect(extractStreet('Laisvės al. 15A')).toBe('Laisvės al. 15A');
    });

    it('extracts street without explicit g. suffix', () => {
      expect(extractStreet('Alekniškio 17 Elektrėnai')).toBe('Alekniškio 17');
      expect(extractStreet('Ukmergės 40 Vilnius')).toBe('Ukmergės 40');
    });
  });

  describe('extractCity', () => {
    it('extracts city name from text', () => {
      expect(extractCity('Joniškėlio g. 1, Pasvalys, Lietuva')).toBe('Pasvalys');
      expect(extractCity('Vilnius, Savanorių pr. 12')).toBe('Vilnius');
    });

    it('returns empty string if no known city matches', () => {
      expect(extractCity('Nežinomas kaimas 5')).toBe('');
    });
  });

  describe('parseDeliveryText', () => {
    it('parses standard cargo text example (single line format)', () => {
      const rawText = 'Joniškėlio g. 1, Pasvalys, 08:00-10:00, UAB Lambda LT';
      const result = parseDeliveryText(rawText);

      expect(result.points).toHaveLength(1);
      expect(result.points[0]).toEqual({
        street: 'Joniškėlio g. 1',
        city: 'Pasvalys',
        timeWindow: {
          from: '08:00',
          to: '10:00',
          raw: '08:00-10:00',
        },
        company: 'UAB Lambda LT',
        fullAddress: 'Joniškėlio g. 1, Pasvalys',
        rawText,
      });
    });

    it('parses multiline delivery point block', () => {
      const multilineText = `Joniškėlio g. 1
Pasvalys
Lietuva
UAB Lambda LT
08:00-10:00`;

      const result = parseDeliveryText(multilineText);
      expect(result.points).toHaveLength(1);
      expect(result.points[0]).toMatchObject({
        street: 'Joniškėlio g. 1',
        city: 'Pasvalys',
        company: 'UAB Lambda LT',
        timeWindow: {
          from: '08:00',
          to: '10:00',
        },
      });
    });

    it('parses multiple blocks separated by empty lines', () => {
      const input = `Joniškėlio g. 1, Pasvalys, 08:00-10:00, UAB Lambda LT

Laisvės al. 15, Kaunas, 12:00-14:00, MB Logistika LT`;

      const result = parseDeliveryText(input);
      expect(result.points).toHaveLength(2);
      expect(result.points[0].city).toBe('Pasvalys');
      expect(result.points[1].city).toBe('Kaunas');
      expect(result.points[1].company).toBe('MB Logistika LT');
    });

    it('handles empty input gracefully', () => {
      const result = parseDeliveryText('');
      expect(result.points).toHaveLength(0);
      expect(result.unparsedLines).toHaveLength(0);
    });

    it('parses list of addresses without g. suffix line by line', () => {
      const listText = `Alekniškio 17 Elektrėnai
Ateities g. 2 Kaunas
Savanorių g. 180 Vilnius
Veterinarijos 5 Ukmergė
Radvilų 2 Rokiškis
Ukmergės 40 Vilnius`;

      const result = parseDeliveryText(listText);
      expect(result.points).toHaveLength(6);
      expect(result.points[0]).toMatchObject({ street: 'Alekniškio 17', city: 'Elektrėnai' });
      expect(result.points[1]).toMatchObject({ street: 'Ateities g. 2', city: 'Kaunas' });
      expect(result.points[2]).toMatchObject({ street: 'Savanorių g. 180', city: 'Vilnius' });
      expect(result.points[3]).toMatchObject({ street: 'Veterinarijos 5', city: 'Ukmergė' });
      expect(result.points[4]).toMatchObject({ street: 'Radvilų 2', city: 'Rokiškis' });
      expect(result.points[5]).toMatchObject({ street: 'Ukmergės 40', city: 'Vilnius' });
    });
  });
});
