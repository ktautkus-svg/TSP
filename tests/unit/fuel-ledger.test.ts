import { describe, expect, it } from 'vitest';
import { buildFuelLedger, vehicleDayFuelDistanceKm, type FuelLedgerInputDay } from '@/application/trip-sheet/fuel-balance';

function day(date: string, distanceKm: number | null, addedLiters = 0, norm: number | null = 12): FuelLedgerInputDay {
  return { date, distanceKm, fuelNormLPer100Km: norm, addedLiters };
}

describe('kuro likučio grandinė', () => {
  it('perneša likutį iš dienos į dieną', () => {
    // Pilnas bakas 110 l mėnesio pradžioje, norma 12 l/100 km.
    const ledger = buildFuelLedger(
      [day('2026-01-02', 100), day('2026-01-03', 250), day('2026-01-04', 150)],
      110,
    );

    expect(ledger[0].consumedLiters).toBe(12);
    expect(ledger[0].endLiters).toBe(98);

    // Antros dienos pradžia = pirmos dienos pabaiga.
    expect(ledger[1].startLiters).toBe(98);
    expect(ledger[1].consumedLiters).toBe(30);
    expect(ledger[1].endLiters).toBe(68);

    expect(ledger[2].startLiters).toBe(68);
    expect(ledger[2].endLiters).toBe(50);
  });

  it('prideda įpylimus prie tos dienos likučio', () => {
    const ledger = buildFuelLedger([day('2026-01-02', 100, 40)], 110);
    // 110 + 40 - 12
    expect(ledger[0].endLiters).toBe(138);
  });

  it('naudoja kiekvienos dienos automobilio normą', () => {
    // MET630 - 12 l, NLL182 - 13,9 l.
    const ledger = buildFuelLedger(
      [day('2026-01-02', 200, 0, 12), day('2026-01-03', 200, 0, 13.9)],
      110,
    );
    expect(ledger[0].consumedLiters).toBe(24);
    expect(ledger[1].consumedLiters).toBe(27.8);
    expect(ledger[1].endLiters).toBe(58.2);
  });

  it('rodo neigiamą likutį, o ne nulį, kai knygos nesueina', () => {
    // 300 km su 12 l norma yra 36 l, o bake buvo tik 20 - vadinasi pylimas
    // liko neįvestas. Nulis čia meluotų.
    const ledger = buildFuelLedger([day('2026-01-02', 300)], 20);
    expect(ledger[0].endLiters).toBe(-16);
  });

  it('nutraukia grandinę, kai dienos odometro nėra, ir pasako kodėl', () => {
    const ledger = buildFuelLedger(
      [day('2026-01-02', 100), day('2026-01-03', null), day('2026-01-04', 100)],
      110,
    );
    expect(ledger[0].endLiters).toBe(98);
    expect(ledger[1].missing).toBe('no_odometer');
    expect(ledger[1].endLiters).toBeNull();
    // Neatspėjame praleistos dienos - tolesnės dienos lieka nežinomos.
    expect(ledger[2].startLiters).toBeNull();
    expect(ledger[2].endLiters).toBeNull();
  });

  it('pažymi trūkstamą normą ir trūkstamą pradinį likutį', () => {
    expect(buildFuelLedger([day('2026-01-02', 100, 0, null)], 110)[0].missing).toBe('no_norm');
    expect(buildFuelLedger([day('2026-01-02', 100)], null)[0].missing).toBe('no_opening');
  });

  it('adds non-assigned extra kilometres only to fuel consumption, not as a missing odometer', () => {
    expect(vehicleDayFuelDistanceKm(300, 615.5)).toBe(915.5);
    const ledger = buildFuelLedger([day('2026-08-31', vehicleDayFuelDistanceKm(300, 615.5), 95.07, 12)], 110);
    expect(ledger[0].distanceKm).toBe(915.5);
    expect(ledger[0].consumedLiters).toBe(109.86);
    expect(ledger[0].missing).toBeNull();
  });
});
