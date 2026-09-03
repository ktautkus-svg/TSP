import { describe, expect, it } from 'vitest';

import {
  EXCEL_FUEL_LOG,
  FUEL_AUGUST_2026_MIGRATION_ID,
  FUEL_AUGUST_2026_NORMS,
  FUEL_AUGUST_2026_V3_MIGRATION_ID,
  FUEL_AUGUST_2026_V4_MIGRATION_ID,
  FUEL_AUGUST_2026_V5_MIGRATION_ID,
  FUEL_AUGUST_2026_V3_REMOVED_FILLS,
  MET630_AUGUST_03_2026_DATE,
  MET630_AUGUST_03_2026_DISTANCE_KM,
  MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM,
  MET630_AUGUST_31_2026_ASSIGNMENT_ID,
  MET630_AUGUST_31_2026_DATE,
  MET630_AUGUST_31_2026_EXTRA_DISTANCE_KM,
  MET630_AUGUST_31_2026_MANUAL_FILL,
  MET630_AUGUST_31_2026_MANUAL_FILL_ALT_DOCUMENT_ID,
  MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID,
  MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM,
  MET630_OPENING_FUEL_EFFECTIVE_AT,
  MET630_OPENING_FUEL_LITERS,
  MET630_OPENING_FUEL_REPORT_ID,
  NLL182_OPENING_FUEL_EFFECTIVE_AT,
  NLL182_OPENING_FUEL_LITERS,
  NLL182_OPENING_FUEL_REPORT_ID,
  STALE_AUGUST_OPENING_REPORT_IDS,
  alreadyHasExcelFuelEntry,
  alreadyHasOpeningFuel,
  correctedMet630August03Odometers,
  excelFuelDocumentId,
  excelFuelLitersTotal,
  excelFuelOdometer,
  extraDistanceKmOf,
  isFuelAugust2026V3RemovedEntry,
  isFuelAugust2026V4ManualFillEntry,
  isFuelAugust2026V5ProtectedEntry,
  isFuelAugust2026V5RemovedEntry,
  isStaleAugust2026FuelEntry,
  isStaleAugustOpeningReport,
  lithuaniaLocalToIso,
  met630August31AssignedOdometers,
  parseVehicleDateKey,
  shouldRestoreMet630August31AssignedDistance,
  uncoveredFuelDayKeys,
  vehicleDayFuelDistanceKm,
} from '../../src/domain/excel-fuel-log';

const FIRESTORE_ID = /^[a-zA-Z0-9_-]{8,80}$/;

describe('Excel kuro katalogas', () => {
  it('turi autoritetingą rugpjūčio 2026 lentelę (15 MET + 15 NLL)', () => {
    expect(EXCEL_FUEL_LOG).toHaveLength(30);
    expect(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'NLL182')).toHaveLength(15);
    expect(EXCEL_FUEL_LOG.filter((fill) => fill.registrationNumber === 'MET630')).toHaveLength(15);
    expect(excelFuelLitersTotal('NLL182')).toBe(836.79);
    expect(excelFuelLitersTotal('MET630')).toBe(1203.20);
    expect(EXCEL_FUEL_LOG.every((fill) => (
      fill.registrationNumber !== 'NLL182' || fill.localDate >= '2026-08-13'
    ))).toBe(true);

    const byReceipt = Object.fromEntries(
      EXCEL_FUEL_LOG.map((fill) => [`${fill.registrationNumber}:${fill.receiptNumber}`, fill.liters]),
    );
    expect(byReceipt['MET630:476/1159']).toBe(10);
    expect(byReceipt['MET630:242/426']).toBeUndefined();
    expect(byReceipt['MET630:89/1222']).toBeUndefined();
    expect(byReceipt['NLL182:13/1214']).toBe(45.6);
    expect(byReceipt['NLL182:19/571']).toBe(70.52);
    expect(byReceipt['NLL182:131/1213']).toBe(30);
    expect(byReceipt['NLL182:205/1218']).toBe(14.47);
    expect(byReceipt['NLL182:6/1126']).toBe(68.91);
    expect(byReceipt['NLL182:231/1213']).toBeUndefined();
    expect(byReceipt['MET630:08/52']).toBe(95.07);
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
    expect(new Set(ids).size).toBe(30);
    for (const id of ids) expect(id).toMatch(FIRESTORE_ID);
    expect(excelFuelDocumentId(EXCEL_FUEL_LOG[0]!)).toBe('xlsx-MET630-20260804-135-1193');
    expect(excelFuelDocumentId(MET630_AUGUST_31_2026_MANUAL_FILL)).toBe('xlsx-manual-08-52');
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
    expect(FUEL_AUGUST_2026_V3_MIGRATION_ID).toBe('fuel-august-2026-v3');
    expect(FUEL_AUGUST_2026_V4_MIGRATION_ID).toBe('fuel-august-2026-v4');
    expect(FUEL_AUGUST_2026_V5_MIGRATION_ID).toBe('fuel-august-2026-v5');
    expect(MET630_AUGUST_03_2026_DATE).toBe('2026-08-03');
    expect(MET630_AUGUST_03_2026_DISTANCE_KM).toBe(617);

    const fill = EXCEL_FUEL_LOG[0]!;
    expect(alreadyHasExcelFuelEntry([], fill, 'MET630')).toBe(false);
    expect(alreadyHasExcelFuelEntry([{ id: excelFuelDocumentId(fill), vehicleId: 'MET630', receiptNumber: fill.receiptNumber }], fill, 'MET630')).toBe(true);
    expect(alreadyHasExcelFuelEntry([{ id: 'other-id-12', vehicleId: 'MET630', receiptNumber: '135/1193' }], fill, 'MET630')).toBe(true);
    expect(alreadyHasExcelFuelEntry([{ id: 'other-id-12', vehicleId: 'NLL182', receiptNumber: '135/1193' }], fill, 'MET630')).toBe(false);
  });

  it('v3 pažymi dvi klaidingas MET630 pylimo eilutes ir pataiso 08-03 dienos km', () => {
    expect(FUEL_AUGUST_2026_V3_REMOVED_FILLS).toHaveLength(2);
    expect(FUEL_AUGUST_2026_V3_REMOVED_FILLS.map((fill) => fill.transactionId)).toEqual([
      '42655388',
      '42959044',
    ]);
    expect(isFuelAugust2026V3RemovedEntry({
      id: 'xlsx-MET630-20260809-242-426',
      registrationNumber: 'MET630',
      receiptNumber: '242/426',
    })).toBe(true);
    expect(isFuelAugust2026V3RemovedEntry({
      id: 'manual-row',
      registrationNumber: 'MET630',
      receiptNumber: '89/1222',
    })).toBe(true);
    expect(isFuelAugust2026V3RemovedEntry({
      id: 'legacy-import',
      registrationNumber: 'MET630',
      receiptNumber: null,
      notes: 'Circle K trn 42655388',
    })).toBe(true);
    expect(isFuelAugust2026V3RemovedEntry({
      id: 'xlsx-MET630-20260809-476-1159',
      registrationNumber: 'MET630',
      receiptNumber: '476/1159',
    })).toBe(false);
    expect(correctedMet630August03Odometers({ startOdometer: 100_000, endOdometer: 100_217 }))
      .toEqual({ startOdometer: 100_000, endOdometer: 100_617, distanceKm: 617 });
    expect(correctedMet630August03Odometers(null))
      .toEqual({ startOdometer: 0, endOdometer: 617, distanceKm: 617 });
  });

  it('v5 ištrina tik dvi MET630 šmėklas ir palieka 10 L / 95 L / 9.5 L', () => {
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'xlsx-MET630-20260809-242-426',
      registrationNumber: 'MET630',
      receiptNumber: '242/426',
      filledAt: '2026-08-09T12:00:00.000Z',
      liters: 46.01,
    })).toBe(true);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'manual-4608',
      registrationNumber: 'MET630',
      receiptNumber: null,
      filledAt: '2026-08-09T09:00:00.000Z',
      liters: 46.08,
    })).toBe(true);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'manual-30l',
      registrationNumber: 'MET630',
      receiptNumber: null,
      filledAt: '2026-08-29T09:00:00.000Z',
      liters: 30,
    })).toBe(true);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'legacy-import',
      registrationNumber: 'MET630',
      receiptNumber: null,
      notes: 'Circle K trn 42655388',
      liters: 46.08,
    })).toBe(true);

    expect(isFuelAugust2026V5ProtectedEntry({
      id: 'xlsx-MET630-20260809-476-1159',
      registrationNumber: 'MET630',
      receiptNumber: '476/1159',
      filledAt: '2026-08-09T20:23:00.000Z',
      liters: 10,
    })).toBe(true);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'xlsx-MET630-20260809-476-1159',
      registrationNumber: 'MET630',
      receiptNumber: '476/1159',
      filledAt: '2026-08-09T20:23:00.000Z',
      liters: 10,
    })).toBe(false);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'xlsx-MET630-20260809-325-1158',
      registrationNumber: 'MET630',
      receiptNumber: '325/1158',
      filledAt: '2026-08-09T20:38:00.000Z',
      liters: 95,
    })).toBe(false);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'xlsx-MET630-20260829-834-1206',
      registrationNumber: 'MET630',
      receiptNumber: '834/1206',
      filledAt: '2026-08-29T09:00:00.000Z',
      liters: 9.5,
    })).toBe(false);
    expect(isFuelAugust2026V5RemovedEntry({
      id: 'xlsx-NLL182-20260825-131-1213',
      registrationNumber: 'NLL182',
      receiptNumber: '131/1213',
      filledAt: '2026-08-25T09:00:00.000Z',
      liters: 30,
    })).toBe(false);
  });

  it('v4 prideda MET630 08/52 pylimą ir 615.50 km likutį be Karolio 300 km keitimo', () => {
    expect(excelFuelDocumentId(MET630_AUGUST_31_2026_MANUAL_FILL)).toBe(MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID);
    expect(MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID).toMatch(FIRESTORE_ID);
    expect(MET630_AUGUST_31_2026_MANUAL_FILL_ALT_DOCUMENT_ID).toMatch(FIRESTORE_ID);
    expect(MET630_AUGUST_31_2026_DATE).toBe('2026-08-31');
    expect(MET630_AUGUST_31_2026_ASSIGNMENT_ID).toBe('a6f3ea27-0e1b-474f-ba45-f77266ea1ce4');
    expect(MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM).toBe(915.5);
    expect(MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM).toBe(300);
    expect(MET630_AUGUST_31_2026_EXTRA_DISTANCE_KM).toBe(615.5);
    expect(MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM + MET630_AUGUST_31_2026_EXTRA_DISTANCE_KM)
      .toBe(MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM);
    expect(lithuaniaLocalToIso(MET630_AUGUST_31_2026_MANUAL_FILL.localDate, MET630_AUGUST_31_2026_MANUAL_FILL.localTime))
      .toBe('2026-08-31T09:00:00.000Z');

    expect(isFuelAugust2026V4ManualFillEntry({
      id: 'xlsx-manual-08-52',
      registrationNumber: 'MET630',
      receiptNumber: '08/52',
    })).toBe(true);
    expect(isFuelAugust2026V4ManualFillEntry({
      id: 'manual-08-52',
      registrationNumber: 'MET630',
      receiptNumber: null,
    })).toBe(true);
    expect(isFuelAugust2026V4ManualFillEntry({
      id: 'xlsx-MET630-20260831-08-52',
      registrationNumber: 'MET630',
      receiptNumber: '08/52',
    })).toBe(true);
    expect(isFuelAugust2026V4ManualFillEntry({
      id: 'other-row',
      registrationNumber: 'MET630',
      receiptNumber: '08/52',
    })).toBe(true);
    expect(isFuelAugust2026V4ManualFillEntry({
      id: 'xlsx-MET630-20260830-151-563',
      registrationNumber: 'MET630',
      receiptNumber: '151/563',
    })).toBe(false);

    expect(met630August31AssignedOdometers({ startOdometer: 283151, endOdometer: 284066.5 }))
      .toEqual({ startOdometer: 283151, endOdometer: 283451, distanceKm: 300, extraDistanceKm: 615.5 });
    expect(met630August31AssignedOdometers(null))
      .toEqual({ startOdometer: 0, endOdometer: 300, distanceKm: 300, extraDistanceKm: 615.5 });
    expect(vehicleDayFuelDistanceKm(300, 615.5)).toBe(915.5);
    expect(vehicleDayFuelDistanceKm(300, 0)).toBe(300);
    expect(vehicleDayFuelDistanceKm(null, 615.5)).toBe(615.5);
    expect(vehicleDayFuelDistanceKm(null, null)).toBeNull();
    expect(extraDistanceKmOf({ extraDistanceKm: 615.5 })).toBe(615.5);
    expect(extraDistanceKmOf({})).toBe(0);
    expect(shouldRestoreMet630August31AssignedDistance({
      actualDistanceKm: 300, startOdometer: 283151, endOdometer: 283451,
    })).toEqual({ restoreActual: false, restoreOdometerSpan: false });
    expect(shouldRestoreMet630August31AssignedDistance({
      actualDistanceKm: 915.5, startOdometer: 283151, endOdometer: 284066.5,
    })).toEqual({ restoreActual: true, restoreOdometerSpan: true });
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
