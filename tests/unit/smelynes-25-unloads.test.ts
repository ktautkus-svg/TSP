import { describe, expect, it } from 'vitest';

import {
  mentionsSmelynes25,
  smelynes25UnloadIdentity,
  smelynes25UnloadKey,
  smelynes25UnloadLabel,
} from '../../src/domain/import/smelynes-25-unloads';

describe('Smėlynės 25 unload split', () => {
  it('recognizes Smėlynės / Smelynes 25 spelling variants and ignores other street numbers', () => {
    expect(mentionsSmelynes25('Smėlynės g. 25, Panevėžys')).toBe(true);
    expect(mentionsSmelynes25('Smelynes 25')).toBe(true);
    expect(mentionsSmelynes25('SMĖLYNĖS GATVĖ 25A')).toBe(true);
    expect(mentionsSmelynes25('Pajuosčio pl. 73')).toBe(false);
    expect(mentionsSmelynes25('Smėlynės g. 125, Panevėžys')).toBe(false);
  });

  it('reads kavinė vs ne-kavinė from column E text, including glued hospital labels', () => {
    expect(smelynes25UnloadIdentity('VšĮ Respublikinė Panevėžio ligoninė (kavinė)')).toBe('cafe');
    expect(smelynes25UnloadIdentity('ligoninė(kavinė)')).toBe('cafe');
    expect(smelynes25UnloadIdentity('VšĮ Respublikinė Panevėžio ligoninė (ne kavinė)')).toBe('default');
    expect(smelynes25UnloadIdentity('ligoninė(ne-kavinė)')).toBe('default');
    expect(smelynes25UnloadIdentity('UAB Lambda LT')).toBe('default');
  });

  it('only suffixes the merge key for the cafe unloading at this site', () => {
    const cafe = {
      normalizedAddress: 'Smėlynės g. 25, Panevėžys, Lietuva',
      rawRow: { E: 'UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė (kavinė)' },
    };
    const notCafe = {
      normalizedAddress: 'Smėlynės g. 25, Panevėžys, Lietuva',
      rawRow: { E: 'UAB Lambda LT, VšĮ Respublikinė Panevėžio ligoninė (ne kavinė)' },
    };
    const otherCafe = {
      normalizedAddress: 'Dainų g. 11, Šiauliai, Lietuva',
      rawRow: { E: 'Centras (kavinė)' },
    };
    expect(smelynes25UnloadKey(cafe)).toBe('#smelynes25:cafe');
    expect(smelynes25UnloadKey(notCafe)).toBe('');
    expect(smelynes25UnloadKey(otherCafe)).toBe('');
    expect(smelynes25UnloadLabel([cafe])).toBe('Kavinė');
    expect(smelynes25UnloadLabel([notCafe])).toBe('Ne kavinė');
    expect(smelynes25UnloadLabel([otherCafe])).toBeNull();
  });
});
