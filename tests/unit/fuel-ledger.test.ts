import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildTripSheetWorkbook } from '@/application/trip-sheet/export-xlsx';
import {
  buildFuelLedger,
  closingFuelLiters,
  FUEL_OVER_CAPACITY_NOTE,
  fuelFillContinuesLedger,
  fuelRemainderExceedsTank,
  openingFuelLiters,
  vehicleDayFuelDistanceKm,
  type FuelLedgerInputDay,
} from '@/application/trip-sheet/fuel-balance';
import { buildTripSheetPrintDocument } from '@/application/trip-sheet/print-document';

function day(date: string, distanceKm: number | null, addedLiters = 0, norm: number | null = 12): FuelLedgerInputDay {
  return { date, distanceKm, fuelNormLPer100Km: norm, addedLiters };
}

function fuelFill(date: string, addedLiters: number): FuelLedgerInputDay {
  return { date, distanceKm: null, fuelNormLPer100Km: null, addedLiters, fuelOnly: true };
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

  it('atnaujina grandinę nuo konkrečios dienos faktinio likučio po kito vairuotojo naudojimo', () => {
    const ledger = buildFuelLedger([
      day('2026-09-01', 422, 105.5, 12),
      day('2026-09-07', null),
      { ...day('2026-09-08', 512, 100, 12), openingLiters: 112 },
      day('2026-09-09', 344, 0, 12),
      { ...day('2026-09-16', 701, 97.81, 12), openingLiters: 65 },
    ], 55);

    expect(ledger[0].endLiters).toBe(109.86);
    expect(ledger[1].endLiters).toBeNull();
    expect(ledger[2].startLiters).toBe(112);
    expect(ledger[2].endLiters).toBe(150.56);
    expect(ledger[3].startLiters).toBe(150.56);
    expect(ledger[3].endLiters).toBe(109.28);
    expect(ledger[4].startLiters).toBe(65);
    expect(ledger[4].endLiters).toBe(78.69);
  });

  it('pažymi trūkstamą normą ir trūkstamą pradinį likutį', () => {
    expect(buildFuelLedger([day('2026-01-02', 100, 0, null)], 110)[0].missing).toBe('no_norm');
    expect(buildFuelLedger([day('2026-01-02', 100)], null)[0].missing).toBe('no_opening');
  });

  const TANK_LITERS = 100;

  it('palieka likutį, kuris neviršija bako talpos', () => {
    const ledger = buildFuelLedger([day('2026-09-14', 50, 10, 12)], 40);
    // 40 + 10 - 6
    expect(ledger[0].endLiters).toBe(44);
    expect(fuelRemainderExceedsTank(ledger[0].endLiters, TANK_LITERS)).toBe(false);
  });

  it('palieka likutį, kuris tiksliai lygus bako talpai', () => {
    const ledger = buildFuelLedger([day('2026-09-14', 100, 60, 10)], 50);
    // 50 + 60 - 10
    expect(ledger[0].startLiters).toBe(50);
    expect(ledger[0].endLiters).toBe(TANK_LITERS);
    expect(fuelRemainderExceedsTank(ledger[0].endLiters, TANK_LITERS)).toBe(false);
  });

  it('rodo likutį virš bako talpos ir nekeičia jo į brūkšnį, nulį ar talpą', () => {
    // 2026-09-14 pabaiga 91,3 l, 2026-09-15 įpilta 83 l, bakas 100 l.
    const ledger = buildFuelLedger([
      fuelFill('2026-09-15', 83),
    ], 91.3);

    expect(ledger[0].startLiters).toBe(91.3);
    expect(ledger[0].consumedLiters).toBe(0);
    expect(ledger[0].endLiters).toBe(174.3);
    expect(ledger[0].endLiters).not.toBeNull();
    expect(ledger[0].endLiters).not.toBe(0);
    expect(ledger[0].endLiters).not.toBe(TANK_LITERS);
    expect(fuelRemainderExceedsTank(ledger[0].endLiters, TANK_LITERS)).toBe(true);
  });

  it('tęsia grandinę per „Kuro pylimas“ eilutę be kilometražo', () => {
    expect(fuelFillContinuesLedger({
      startAddress: 'Kuro pylimas',
      endAddress: 'Kuro pylimas',
      distanceKm: null,
    })).toBe(true);
    expect(fuelFillContinuesLedger({
      startAddress: 'Pradžia',
      endAddress: 'Pabaiga',
      distanceKm: null,
    })).toBe(false);
    const tripSheetSource = readFileSync(resolve(import.meta.dirname, '../../src/app/trip-sheet.tsx'), 'utf8');
    expect(tripSheetSource).toContain('const fuelOnly = fuelFillContinuesLedger(day)');
    expect(tripSheetSource).toContain('distanceKm: fuelOnly ? 0 : day.distanceKm');
    expect(tripSheetSource).toContain('FUEL_OVER_CAPACITY_NOTE');

    const ledger = buildFuelLedger([
      fuelFill('2026-09-15', 83),
      day('2026-09-16', 100, 0, 13.9),
    ], 91.3);

    expect(ledger[0].distanceKm).toBeNull();
    expect(ledger[0].missing).toBeNull();
    expect(ledger[0].endLiters).toBe(174.3);
    expect(ledger[1].startLiters).toBe(174.3);
    expect(ledger[1].consumedLiters).toBe(13.9);
    expect(ledger[1].endLiters).toBe(160.4);
  });

  it('po viršytos talpos kitos dienos pradžia yra ankstesnės eilutės pabaiga', () => {
    const ledger = buildFuelLedger([
      day('2026-09-14', 10, 0, 13.9),
      fuelFill('2026-09-15', 83),
      day('2026-09-16', 50, 0, 13.9),
    ], 92.69);

    // 92,69 - 1,39 = 91,3
    expect(ledger[0].endLiters).toBe(91.3);
    expect(ledger[1].startLiters).toBe(91.3);
    expect(ledger[1].endLiters).toBe(174.3);
    expect(ledger[2].startLiters).toBe(174.3);
    expect(ledger[2].endLiters).toBe(167.35);
  });

  it('paskutinės dienos likutį įrašo į suvestinės pabaigą, net kai jis viršija baką', () => {
    const ledger = buildFuelLedger([
      day('2026-09-14', 0, 0, 13.9),
      fuelFill('2026-09-15', 83),
      day('2026-09-16', 100, 0, 13.9),
    ], 91.3);

    const starts = ledger.map((row) => row.startLiters);
    const ends = ledger.map((row) => row.endLiters);
    expect(openingFuelLiters(starts)).toBe(91.3);
    expect(closingFuelLiters(ends)).toBe(160.4);
    expect(closingFuelLiters(ends)).not.toBe(91.3);
    expect(ends.every((value) => value !== null)).toBe(true);

    const formatted = new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(174.3);
    const html = buildTripSheetPrintDocument({
      companyName: 'FiRo',
      companyAddress: 'Vilnius',
      periodLabel: '2026-09',
      fuelType: 'Dyzelinas',
      groups: [{
        monthLabel: '2026 m. rugsėjis',
        registrationNumber: 'NLL182',
        vehicleModel: 'Renault Master',
        driverNames: 'Karolis Tautkus',
        fuelNorm: 13.9,
        tankCapacityLiters: TANK_LITERS,
        rows: [
          {
            date: '2026-09-14', driverName: 'Karolis Tautkus', route: 'R11',
            startOdometer: 1000, endOdometer: 1010, distanceKm: 10,
            fuelStart: ledger[0].startLiters, fuelAdded: 0, fuelConsumed: ledger[0].consumedLiters,
            fuelEnd: ledger[0].endLiters, receiptNumbers: [],
          },
          {
            date: '2026-09-15', driverName: 'Karolis Tautkus', route: 'Kuro pylimas',
            startOdometer: null, endOdometer: null, distanceKm: null,
            fuelStart: ledger[1].startLiters, fuelAdded: 83, fuelConsumed: ledger[1].consumedLiters,
            fuelEnd: ledger[1].endLiters, receiptNumbers: [],
          },
          {
            date: '2026-09-16', driverName: 'Karolis Tautkus', route: 'R19',
            startOdometer: 1010, endOdometer: 1110, distanceKm: 100,
            fuelStart: ledger[2].startLiters, fuelAdded: 0, fuelConsumed: ledger[2].consumedLiters,
            fuelEnd: ledger[2].endLiters, receiptNumbers: [],
          },
        ],
      }],
    });
    expect(html).toContain(`>${formatted}<`);
    expect(html).toContain('L. d.d.pb.: 160,40');
    expect(html).toContain('L. d.d.p.: 91,30');
    expect(html).toContain(FUEL_OVER_CAPACITY_NOTE);
    expect(html).toContain(`title="${FUEL_OVER_CAPACITY_NOTE}"`);

    const bytes = buildTripSheetWorkbook({
      companyName: 'FiRo',
      companyAddress: 'Vilnius',
      periodLabel: '2026-09',
      includeSummary: true,
      groups: [{
        month: '2026-09',
        driverName: 'Karolis Tautkus',
        registrationNumber: 'NLL182',
        vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 13.9,
        fuelType: 'Dyzelinas',
        rows: ledger.map((row, index) => ({
          date: row.date,
          driverName: 'Karolis Tautkus',
          route: index === 1 ? 'Kuro pylimas' : 'R11',
          distanceKm: index === 1 ? null : row.distanceKm,
          fuelStartLiters: row.startLiters,
          fuelAddedLiters: row.addedLiters,
          receiptNumbers: [],
          fuelConsumedLiters: row.consumedLiters,
          fuelEndLiters: row.endLiters,
          startOdometer: index === 1 ? null : 1000,
          endOdometer: index === 1 ? null : 1100,
        })),
      }],
    });
    const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    const summary = strFromU8(unzipSync(bytes)['xl/worksheets/sheet2.xml']);
    expect(sheet).toContain('<v>174.3</v>');
    expect(sheet).toContain('<v>160.4</v>');
    expect(summary).toContain('<v>160.4</v>');
  });

  it('adds non-assigned extra kilometres only to fuel consumption, not as a missing odometer', () => {
    expect(vehicleDayFuelDistanceKm(300, 615.5)).toBe(915.5);
    const ledger = buildFuelLedger([day('2026-08-31', vehicleDayFuelDistanceKm(300, 615.5), 95.07, 12)], 110);
    expect(ledger[0].distanceKm).toBe(915.5);
    expect(ledger[0].consumedLiters).toBe(109.86);
    expect(ledger[0].missing).toBeNull();
  });
});
