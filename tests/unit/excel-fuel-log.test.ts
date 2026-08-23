import { describe, expect, it } from 'vitest';

import {
  EXCEL_FUEL_LOG,
  NLL182_OPENING_FUEL_EFFECTIVE_AT,
  NLL182_OPENING_FUEL_LITERS,
  NLL182_OPENING_FUEL_REPORT_ID,
  alreadyHasExcelFuelEntry,
  alreadyHasOpeningFuel,
  excelFuelDocumentId,
  excelFuelLitersTotal,
  excelFuelOdometer,
  lithuaniaLocalToIso,
  parseVehicleDateKey,
  uncoveredFuelDayKeys,
} from '../../src/domain/excel-fuel-log';

const FIRESTORE_ID = /^[a-zA-Z0-9_-]{8,80}$/;

describe('Excel kuro katalogas', () => {
  it('turi 21 pylimą ir sutampa su Bendras.xlsx kiekiais', () => {
    expect(EXCEL_FUEL_LOG).toHaveLength(21);
    expect(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'NLL182')).toHaveLength(10);
    expect(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'MET630')).toHaveLength(11);
    expect(excelFuelLitersTotal('NLL182')).toBe(584.73);
    expect(excelFuelLitersTotal('MET630')).toBe(861.54);
    expect(new Set(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'MET630').map((fill) => fill.localDate)).size).toBe(8);
  });

  it('saugo Lietuvos laiką ISO ir NLL182 odometrą iš GPS dienos pabaigos', () => {
    expect(lithuaniaLocalToIso('2026-08-04', '09:01')).toBe('2026-08-04T06:01:00.000Z');
    expect(lithuaniaLocalToIso('2026-08-17', '00:45')).toBe('2026-08-16T21:45:00.000Z');
    expect(lithuaniaLocalToIso('2026-08-21', '02:20')).toBe('2026-08-20T23:20:00.000Z');
    expect(excelFuelOdometer('NLL182', '2026-08-08')).toBe(275751);
    expect(excelFuelOdometer('NLL182', '2026-08-21')).toBe(280283);
    expect(excelFuelOdometer('MET630', '2026-08-04')).toBe(0);
  });

  it('generuoja Firestore id be pasvirojo brūkšnio ir praleidžia jau įrašytus čekius', () => {
    const ids = EXCEL_FUEL_LOG.map((fill) => excelFuelDocumentId(fill));
    expect(new Set(ids).size).toBe(21);
    for (const id of ids) expect(id).toMatch(FIRESTORE_ID);
    expect(excelFuelDocumentId(EXCEL_FUEL_LOG[0]!)).toBe('xlsx-MET630-20260804-135-1193');
    expect(NLL182_OPENING_FUEL_REPORT_ID).toMatch(FIRESTORE_ID);
    expect(NLL182_OPENING_FUEL_LITERS).toBe(30);
    expect(NLL182_OPENING_FUEL_EFFECTIVE_AT).toBe('2026-08-01');

    const fill = EXCEL_FUEL_LOG[0]!;
    expect(alreadyHasExcelFuelEntry([], fill, 'MET630')).toBe(false);
    expect(alreadyHasExcelFuelEntry([{ id: excelFuelDocumentId(fill), vehicleId: 'MET630', receiptNumber: fill.receiptNumber }], fill, 'MET630')).toBe(true);
    expect(alreadyHasExcelFuelEntry([{ id: 'other-id-12', vehicleId: 'MET630', receiptNumber: '135/1193' }], fill, 'MET630')).toBe(true);
    expect(alreadyHasExcelFuelEntry([{ id: 'other-id-12', vehicleId: 'NLL182', receiptNumber: '135/1193' }], fill, 'MET630')).toBe(false);
  });

  it('neperrašo jau esančio rugpjūčio 1 d. NLL182 atidarymo', () => {
    expect(alreadyHasOpeningFuel([], 'NLL182')).toBe(false);
    expect(alreadyHasOpeningFuel([{
      id: NLL182_OPENING_FUEL_REPORT_ID, vehicleId: 'NLL182', effectiveAt: '2026-08-01', status: 'approved',
    }], 'NLL182')).toBe(true);
    expect(alreadyHasOpeningFuel([{
      id: 'admin-typed-it', vehicleId: 'NLL182', effectiveAt: '2026-08-01', status: 'approved',
    }], 'NLL182')).toBe(true);
    expect(alreadyHasOpeningFuel([{
      id: 'pending-one', vehicleId: 'NLL182', effectiveAt: '2026-08-01', status: 'pending',
    }], 'NLL182')).toBe(false);
  });

  it('MET630 kuro dienas be odometro palieka nepridengtas', () => {
    const entries = new Map([
      ['MET630:2026-08-04', { length: 1 }],
      ['MET630:2026-08-09', { length: 3 }],
      ['NLL182:2026-08-08', { length: 1 }],
    ]);
    const covered = new Set(['NLL182:2026-08-08']);
    expect(uncoveredFuelDayKeys(entries, covered)).toEqual(['MET630:2026-08-04', 'MET630:2026-08-09']);
    expect(parseVehicleDateKey('MET630:2026-08-04')).toEqual({ vehicleId: 'MET630', date: '2026-08-04' });
    expect(parseVehicleDateKey('bad')).toBeNull();
  });
});
