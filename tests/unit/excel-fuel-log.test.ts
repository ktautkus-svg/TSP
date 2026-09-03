import { describe, expect, it } from 'vitest';

import {
  EXCEL_FUEL_LOG,
  FUEL_AUGUST_2026_MIGRATION_ID,
  FUEL_AUGUST_2026_NORMS,
  MET630_OPENING_FUEL_EFFECTIVE_AT,
  MET630_OPENING_FUEL_LITERS,
  MET630_OPENING_FUEL_REPORT_ID,
  NLL182_OPENING_FUEL_EFFECTIVE_AT,
  NLL182_OPENING_FUEL_LITERS,
  NLL182_OPENING_FUEL_REPORT_ID,
  STALE_AUGUST_OPENING_REPORT_IDS,
  alreadyHasExcelFuelEntry,
  alreadyHasOpeningFuel,
  excelFuelDocumentId,
  excelFuelLitersTotal,
  excelFuelOdometer,
  isStaleAugust2026FuelEntry,
  isStaleAugustOpeningReport,
  lithuaniaLocalToIso,
  parseVehicleDateKey,
  uncoveredFuelDayKeys,
} from '../../src/domain/excel-fuel-log';

const FIRESTORE_ID = /^[a-zA-Z0-9_-]{8,80}$/;

describe('Excel kuro katalogas', () => {
  it('turi autoritetingą rugpjūčio 2026 lentelę (16 MET + 15 NLL)', () => {
    expect(EXCEL_FUEL_LOG).toHaveLength(31);
    expect(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'NLL182')).toHaveLength(15);
    expect(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'MET630')).toHaveLength(16);
    expect(excelFuelLitersTotal('NLL182')).toBe(836.79);
    expect(excelFuelLitersTotal('MET630')).toBe(1184.14);
    expect(EXCEL_FUEL_LOG.every((fill) => (
      fill.registrationNumber !== 'NLL182' || fill.localDate >= '2026-08-13'
    ))).toBe(true);

    const byReceipt = Object.fromEntries(
      EXCEL_FUEL_LOG.map((fill) => [`${fill.registrationNumber}:${fill.receiptNumber}`, fill.liters]),
    );
    expect(byReceipt['MET630:476/1159']).toBe(10);
    expect(byReceipt['NLL182:13/1214']).toBe(45.6);
    expect(byReceipt['NLL182:19/571']).toBe(70.52);
    expect(byReceipt['NLL182:131/1213']).toBe(30);
    expect(byReceipt['NLL182:205/1218']).toBe(14.47);
    expect(byReceipt['NLL182:6/1126']).toBe(68.91);
    expect(byReceipt['NLL182:231/1213']).toBeUndefined();
  });

  it('saugo Lietuvos laiką ISO ir NLL182 odometrą iš GPS dienos pabaigos', () => {
    expect(lithuaniaLocalToIso('2026-08-04', '09:01')).toBe('2026-08-04T06:01:00.000Z');
    expect(lithuaniaLocalToIso('2026-08-17', '00:45')).toBe('2026-08-16T21:45:00.000Z');
    expect(lithuaniaLocalToIso('2026-08-21', '02:20')).toBe('2026-08-20T23:20:00.000Z');
    expect(lithuaniaLocalToIso('2026-08-26', '12:00')).toBe('2026-08-26T09:00:00.000Z');
    expect(excelFuelOdometer('NLL182', '2026-08-13')).toBeGreaterThan(0);
    expect(excelFuelOdometer('NLL182', '2026-08-21')).toBe(280283);
    expect(excelFuelOdometer('MET630', '2026-08-04')).toBe(0);
  });

  it('generuoja Firestore id be pasvirojo brūkšnio ir praleidžia jau įrašytus čekius', () => {
    const ids = EXCEL_FUEL_LOG.map((fill) => excelFuelDocumentId(fill));
    expect(new Set(ids).size).toBe(31);
    for (const id of ids) expect(id).toMatch(FIRESTORE_ID);
    expect(excelFuelDocumentId(EXCEL_FUEL_LOG[0]!)).toBe('xlsx-MET630-20260804-135-1193');
    expect(excelFuelDocumentId({
      registrationNumber: 'NLL182', localDate: '2026-08-27', receiptNumber: '6/1126',
    })).toBe('xlsx-NLL182-20260827-6-1126');
    expect(NLL182_OPENING_FUEL_REPORT_ID).toMatch(FIRESTORE_ID);
    expect(MET630_OPENING_FUEL_REPORT_ID).toMatch(FIRESTORE_ID);
    expect(NLL182_OPENING_FUEL_LITERS).toBe(30);
    expect(NLL182_OPENING_FUEL_EFFECTIVE_AT).toBe('2026-08-13');
    expect(MET630_OPENING_FUEL_LITERS).toBe(110);
    expect(MET630_OPENING_FUEL_EFFECTIVE_AT).toBe('2026-08-01');
    expect(FUEL_AUGUST_2026_NORMS).toEqual({ MET630: 12, NLL182: 13.9 });
    expect(FUEL_AUGUST_2026_MIGRATION_ID).toBe('fuel-august-2026-v2');

    const fill = EXCEL_FUEL_LOG[0]!;
    expect(alreadyHasExcelFuelEntry([], fill, 'MET630')).toBe(false);
    expect(alreadyHasExcelFuelEntry([{ id: excelFuelDocumentId(fill), vehicleId: 'MET630', receiptNumber: fill.receiptNumber }], fill, 'MET630')).toBe(true);
    expect(alreadyHasExcelFuelEntry([{ id: 'other-id-12', vehicleId: 'MET630', receiptNumber: '135/1193' }], fill, 'MET630')).toBe(true);
    expect(alreadyHasExcelFuelEntry([{ id: 'other-id-12', vehicleId: 'NLL182', receiptNumber: '135/1193' }], fill, 'MET630')).toBe(false);
  });

  it('atpažįsta NLL182 rugpjūčio 13 d. ir MET630 rugpjūčio 1 d. atidarymus', () => {
    expect(alreadyHasOpeningFuel([], 'NLL182')).toBe(false);
    expect(alreadyHasOpeningFuel([{
      id: NLL182_OPENING_FUEL_REPORT_ID, vehicleId: 'NLL182', effectiveAt: '2026-08-13', status: 'approved',
    }], 'NLL182')).toBe(true);
    expect(alreadyHasOpeningFuel([{
      id: 'admin-typed-it', vehicleId: 'NLL182', effectiveAt: '2026-08-13', status: 'approved',
    }], 'NLL182')).toBe(true);
    expect(alreadyHasOpeningFuel([{
      id: 'pending-one', vehicleId: 'NLL182', effectiveAt: '2026-08-13', status: 'pending',
    }], 'NLL182')).toBe(false);
    expect(alreadyHasOpeningFuel([{
      id: MET630_OPENING_FUEL_REPORT_ID, vehicleId: 'MET630', effectiveAt: '2026-08-01', status: 'approved',
    }], 'MET630', MET630_OPENING_FUEL_REPORT_ID, MET630_OPENING_FUEL_EFFECTIVE_AT)).toBe(true);
  });

  it('žymi senus rugpjūčio MET/NLL įrašus ir atidarymus ištrinimui', () => {
    const vehicleIds = new Set(['MET630', 'NLL182']);
    expect(isStaleAugust2026FuelEntry({
      id: 'xlsx-MET630-20260809-476-1159',
      registrationNumber: 'MET630',
      vehicleId: 'MET630',
      filledAt: '2026-08-09T20:23:00.000Z',
    }, vehicleIds)).toBe(true);
    expect(isStaleAugust2026FuelEntry({
      id: 'manual-other',
      registrationNumber: 'LRI740',
      vehicleId: 'LRI740',
      filledAt: '2026-08-10T10:00:00.000Z',
    }, vehicleIds)).toBe(false);
    expect(isStaleAugust2026FuelEntry({
      id: 'manual-met-july',
      registrationNumber: 'MET630',
      vehicleId: 'MET630',
      filledAt: '2026-07-31T10:00:00.000Z',
    }, vehicleIds)).toBe(false);
    expect(STALE_AUGUST_OPENING_REPORT_IDS).toContain('open-NLL182-20260801');
    expect(isStaleAugustOpeningReport({
      id: 'open-NLL182-20260801',
      vehicleId: 'NLL182',
      registrationNumber: 'NLL182',
      effectiveAt: '2026-08-01',
      kind: 'admin_correction',
    }, vehicleIds)).toBe(true);
    expect(isStaleAugustOpeningReport({
      id: NLL182_OPENING_FUEL_REPORT_ID,
      vehicleId: 'NLL182',
      registrationNumber: 'NLL182',
      effectiveAt: '2026-08-13',
      kind: 'admin_correction',
    }, vehicleIds)).toBe(false);
    expect(isStaleAugustOpeningReport({
      id: MET630_OPENING_FUEL_REPORT_ID,
      vehicleId: 'MET630',
      registrationNumber: 'MET630',
      effectiveAt: '2026-08-01',
      kind: 'admin_correction',
    }, vehicleIds)).toBe(false);
  });

  it('MET630 kuro dienas be odometro palieka nepridengtas', () => {
    const entries = new Map([
      ['MET630:2026-08-04', { length: 1 }],
      ['MET630:2026-08-09', { length: 3 }],
      ['NLL182:2026-08-13', { length: 1 }],
    ]);
    const covered = new Set(['NLL182:2026-08-13']);
    expect(uncoveredFuelDayKeys(entries, covered)).toEqual(['MET630:2026-08-04', 'MET630:2026-08-09']);
    expect(parseVehicleDateKey('MET630:2026-08-04')).toEqual({ vehicleId: 'MET630', date: '2026-08-04' });
    expect(parseVehicleDateKey('bad')).toBeNull();
  });
});
