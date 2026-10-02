import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TRIP_SHEET_PRINT_COLUMNS, tripSheetColumnLegend } from '../../src/application/trip-sheet/columns';
import { buildTripSheetWorkbook, packedBytes } from '../../src/application/trip-sheet/export-xlsx';

const SAMPLE_GROUPS = [
  {
    month: '2026-08',
    driverName: 'Karolis Tautkus',
    registrationNumber: 'MET630',
    vehicleModel: 'Renault Master',
    fuelNormLitersPer100Km: 14.5,
    fuelType: 'Dyzelinas',
    rows: [{
      date: '2026-08-17',
      driverName: 'Karolis Tautkus',
      route: 'R11 · R15',
      distanceKm: 474,
      fuelStartLiters: 90,
      fuelAddedLiters: 49,
      receiptNumbers: ['565638'],
      fuelConsumedLiters: 68.7,
      fuelEndLiters: 70.3,
      startOdometer: 675154,
      endOdometer: 675628,
    }],
  },
  {
    month: '2026-08',
    driverName: 'Aleksandras',
    registrationNumber: 'NLL182',
    vehicleModel: 'Renault Master',
    fuelNormLitersPer100Km: 13.2,
    fuelType: 'Dyzelinas',
    rows: [{
      date: '2026-08-19',
      driverName: 'Aleksandras',
      route: 'R32',
      distanceKm: 210,
      fuelStartLiters: 40,
      fuelAddedLiters: 0,
      receiptNumbers: [],
      fuelConsumedLiters: 27.7,
      fuelEndLiters: 12.3,
      startOdometer: 180000,
      endOdometer: 180210,
    }],
  },
  {
    month: '2026-08',
    driverName: 'Karolis Tautkus',
    registrationNumber: 'LRI740',
    vehicleModel: 'Renault Master',
    fuelNormLitersPer100Km: 15,
    fuelType: 'Dyzelinas',
    rows: [{
      date: '2026-08-09',
      driverName: 'Karolis Tautkus',
      route: 'R56',
      distanceKm: 12,
      fuelStartLiters: 13,
      fuelAddedLiters: 0,
      receiptNumbers: [],
      fuelConsumedLiters: 1.8,
      fuelEndLiters: 11.2,
      startOdometer: 1000,
      endOdometer: 1012,
    }],
  },
];

const SAMPLE_INPUT = {
  companyName: 'TSP',
  companyAddress: 'Savanorių pr. 180, Vilnius',
  periodLabel: '2026-08',
  groups: SAMPLE_GROUPS,
};

function unzipWorkbook(bytes: Uint8Array) {
  return unzipSync(bytes);
}

function sheetText(archive: ReturnType<typeof unzipSync>, index: number): string {
  return strFromU8(archive[`xl/worksheets/sheet${index}.xml`]!);
}

function worksheetChildren(xml: string): string[] {
  return [...xml.matchAll(/<(dimension|sheetViews|sheetFormatPr|cols|sheetData|sheetCalcPr|sheetProtection|autoFilter|sortState|mergeCells|phoneticPr|conditionalFormatting|dataValidations|hyperlinks|printOptions|pageMargins|pageSetup|headerFooter)\b/g)]
    .map((match) => match[1]!);
}

function assertDesktopSafeSheet(xml: string) {
  expect(worksheetChildren(xml)).toEqual([
    'dimension',
    'sheetViews',
    'sheetFormatPr',
    'cols',
    'sheetData',
    'pageMargins',
  ]);
  expect(xml).not.toContain('autoFilter');
  expect(xml).not.toContain('mergeCells');
  expect(xml).not.toContain('<f>');
  expect(xml).toContain('<sheetData>');
  expect(xml).toContain('t="inlineStr"');
  expect(xml).toContain('<v>');
}

describe('trip sheet Excel export', () => {
  it('creates a PDF-matching kelionės lapas from real odometer and fuel fields', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Savanorių pr. 180, Vilnius',
      periodLabel: '2026-08',
      groups: [SAMPLE_GROUPS[0]!],
    });

    const archive = unzipWorkbook(workbook);
    const workbookXml = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXml).toMatch(/<sheet name="MET630 2026-08" sheetId="1" r:id="rId1"\/>/);
    expect(workbookXml).not.toMatch(/<sheet name="Suvestinė" sheetId="1"/);

    const sheet = sheetText(archive, 1);
    const styles = strFromU8(archive['xl/styles.xml']!);
    expect(sheet).toContain('Kelionės lapas');
    expect(sheet).not.toContain('Kelionės lapų ataskaita');
    expect(sheet).toContain('Renault Master · MET630');
    expect(sheet).toContain('Vairuotojas(-ai):');
    expect(sheet).toContain('Karolis Tautkus');
    expect(sheet).toContain('565638');
    expect(sheet).toContain('675154');
    expect(sheet).toContain('675628');
    expect(sheet).toContain('<v>474</v>');
    expect(sheet).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-17<\/t>/);
    expect(sheet).not.toContain('<f>');
    expect(sheet).not.toContain('Sustojimo trukmė');
    expect(sheet).not.toContain('Stovėjimo laikas');
    expect(styles).toContain('formatCode="#,##0.0"');
    for (const column of TRIP_SHEET_PRINT_COLUMNS) {
      expect(sheet).toContain(`>${column.short}<`);
    }
    expect(sheet).toContain(tripSheetColumnLegend(TRIP_SHEET_PRINT_COLUMNS));
    expect(sheet).toContain('Kelionės lapą išdavė');
    expect(sheet).toContain('Kelionės lapą priėmė');
  });

  it('opens on a vehicle kelionės lapas with daily rows, not Suvestinė', () => {
    const workbook = buildTripSheetWorkbook(SAMPLE_INPUT);
    expect(workbook.byteOffset).toBe(0);
    expect(workbook.byteLength).toBe(workbook.buffer.byteLength);
    expect(workbook[0]).toBe(0x50);
    expect(workbook[1]).toBe(0x4b);

    const archive = unzipWorkbook(workbook);
    const workbookXml = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXml).toMatch(/<sheet name="MET630 2026-08" sheetId="1" r:id="rId1"\/>/);
    expect(workbookXml).toMatch(/<sheet name="NLL182 2026-08" sheetId="2" r:id="rId2"\/>/);
    expect(workbookXml).toMatch(/<sheet name="LRI740 2026-08" sheetId="3" r:id="rId3"\/>/);
    expect(workbookXml).toMatch(/<sheet name="Suvestinė" sheetId="4" r:id="rId4"\/>/);
    expect(workbookXml).not.toMatch(/<sheet name="Suvestinė" sheetId="1"/);

    const first = sheetText(archive, 1);
    expect(first).toContain('Kelionės lapas');
    expect(first).not.toContain('Kelionės lapų suvestinė');
    expect(first).toContain('t="inlineStr"');
    expect(first).toContain('MET630');
    expect(first).toContain('Karolis Tautkus');
    expect(first).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-17<\/t>/);
    expect(first).toMatch(/<c r="C7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>R11 · R15<\/t>/);
    expect(first).toMatch(/<c r="F7"[^>]*><v>474<\/v><\/c>/);
    expect(first).toContain('Iš viso');
    for (const column of TRIP_SHEET_PRINT_COLUMNS) {
      expect(first).toContain(`>${column.short}<`);
    }

    const nll = sheetText(archive, 2);
    expect(nll).toContain('Kelionės lapas');
    expect(nll).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-19<\/t>/);
    expect(nll).toMatch(/<c r="F7"[^>]*><v>210<\/v><\/c>/);

    const lri = sheetText(archive, 3);
    expect(lri).toContain('Kelionės lapas');
    expect(lri).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-09<\/t>/);
    expect(lri).toMatch(/<c r="F7"[^>]*><v>12<\/v><\/c>/);
    expect(lri).toContain('R56');

    const summary = sheetText(archive, 4);
    expect(summary).toContain('Kelionės lapų suvestinė');
    expect(summary).toContain('MET630');
    expect(summary).toContain('NLL182');
    expect(summary).toContain('LRI740');

    for (const index of [1, 2, 3, 4]) {
      assertDesktopSafeSheet(sheetText(archive, index));
    }
  });

  it('sorts busiest vehicle-months first so sheet1 is not an empty LRI stub', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'FiRo',
      companyAddress: 'Vilnius',
      periodLabel: '2026-08',
      groups: [
        {
          ...SAMPLE_GROUPS[2]!,
          rows: [],
        },
        SAMPLE_GROUPS[0]!,
        {
          ...SAMPLE_GROUPS[1]!,
          rows: [
            SAMPLE_GROUPS[1]!.rows[0]!,
            {
              ...SAMPLE_GROUPS[1]!.rows[0]!,
              date: '2026-08-20',
              route: 'R33',
              distanceKm: 80,
            },
          ],
        },
      ],
    });
    const archive = unzipWorkbook(workbook);
    const workbookXml = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXml).toMatch(/<sheet name="NLL182 2026-08" sheetId="1" r:id="rId1"\/>/);
    expect(workbookXml).toMatch(/<sheet name="MET630 2026-08" sheetId="2"/);
    expect(workbookXml).toMatch(/<sheet name="LRI740 2026-08" sheetId="3"/);
    expect(workbookXml).toMatch(/<sheet name="Suvestinė" sheetId="4"/);

    const first = sheetText(archive, 1);
    expect(first).toContain('Kelionės lapas');
    expect(first).toContain('NLL182');
    expect(first).toContain('2026-08-19');
    expect(first).toContain('2026-08-20');
    expect(first).not.toContain('Nėra dienų šiame laikotarpyje.');

    const lastVehicle = sheetText(archive, 3);
    expect(lastVehicle).toContain('LRI740');
    expect(lastVehicle).toContain('Nėra dienų šiame laikotarpyje.');
  });

  it('exports a single picked per-driver run: named "NLL182 … Nr.2", no Suvestinė, real sheet1', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'FiRo',
      companyAddress: 'Vilnius',
      periodLabel: '2026-09',
      includeSummary: false,
      groups: [{
        month: '2026-09',
        driverName: 'Karolis Tautkus',
        registrationNumber: 'NLL182',
        vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 13.9,
        fuelType: 'Dyzelinas',
        sheetNumber: 2,
        sheetLabel: 'NLL182 Karolis Tautkus Nr.2',
        periodLabel: '2026-09-04 – 2026-09-05',
        rows: [{
          date: '2026-09-04', driverName: 'Karolis Tautkus', route: 'R11',
          distanceKm: 158, fuelStartLiters: 21, fuelAddedLiters: 79, receiptNumbers: [],
          fuelConsumedLiters: 22, fuelEndLiters: 78, startOdometer: 283671, endOdometer: 283829,
        }],
      }],
    });
    const archive = unzipWorkbook(workbook);
    const workbookXml = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXml).toMatch(/<sheet name="NLL182 Karolis Tautkus Nr.2" sheetId="1" r:id="rId1"\/>/);
    expect(workbookXml).not.toContain('Suvestinė');
    expect(archive['xl/worksheets/sheet2.xml']).toBeUndefined();

    const first = sheetText(archive, 1);
    expect(first).toContain('Kelionės lapas Nr. 2');
    expect(first).toContain('2026-09-04 – 2026-09-05');
    expect(first).toContain('283671');
    assertDesktopSafeSheet(first);
  });

  it('keeps Suvestinė last (never sheet1) when several run sheets are exported', () => {
    const runGroup = (nr: number, date: string) => ({
      month: '2026-09',
      driverName: 'Karolis Tautkus',
      registrationNumber: 'NLL182',
      vehicleModel: 'Renault Master',
      fuelNormLitersPer100Km: 13.9,
      fuelType: 'Dyzelinas',
      sheetNumber: nr,
      sheetLabel: `NLL182 Karolis Nr.${nr}`,
      periodLabel: date,
      rows: [{
        date, driverName: 'Karolis Tautkus', route: 'R11', distanceKm: 100,
        fuelStartLiters: 50, fuelAddedLiters: 0, receiptNumbers: [], fuelConsumedLiters: 14,
        fuelEndLiters: 36, startOdometer: 1000, endOdometer: 1100,
      }],
    });
    const workbook = buildTripSheetWorkbook({
      companyName: 'FiRo', companyAddress: 'Vilnius', periodLabel: '2026-09', includeSummary: true,
      groups: [runGroup(1, '2026-09-02'), runGroup(2, '2026-09-04')],
    });
    const archive = unzipWorkbook(workbook);
    const workbookXml = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXml).toMatch(/<sheet name="NLL182 Karolis Nr.1" sheetId="1"/);
    expect(workbookXml).toMatch(/<sheet name="Suvestinė" sheetId="3"/);
    expect(workbookXml).not.toMatch(/<sheet name="Suvestinė" sheetId="1"/);
    expect(sheetText(archive, 1)).toContain('Kelionės lapas Nr. 1');
  });

  it('writes core.xml timestamps without milliseconds so Excel will open the file', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [SAMPLE_GROUPS[0]!],
    });
    const archive = unzipWorkbook(workbook);
    const core = strFromU8(archive['docProps/core.xml']!);
    expect(core).toMatch(/dcterms:created[^>]*>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z</);
    expect(core).not.toMatch(/\.\d{3}Z</);
  });

  it('strips illegal XML control characters instead of producing a workbook Excel refuses to open', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [{
        month: '2026-08',
        driverName: 'Vairas 1',
        registrationNumber: 'MET630',
        vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 12.5,
        fuelType: 'Dyzelinas',
        rows: [{
          date: '2026-08-19',
          driverName: 'Vairas 1',
          route: 'Savanorių pr. 180\x00\x01\x02, Vilnius',
          distanceKm: 376,
          fuelStartLiters: 50,
          fuelAddedLiters: 0,
          receiptNumbers: [],
          fuelConsumedLiters: 40,
          fuelEndLiters: 10,
          startOdometer: 676420,
          endOdometer: 676796,
        }],
      }],
    });
    const archive = unzipWorkbook(workbook);
    const sheet = sheetText(archive, 1);
    expect(sheet).toContain('Kelionės lapas');
    expect(sheet).toContain('Savanorių pr. 180, Vilnius');
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(sheet)).toBe(false);
  });

  it('packs zip bytes so a Blob never receives a sliced ArrayBuffer view', () => {
    const oversized = new Uint8Array(32);
    oversized.set([1, 2, 3, 4], 8);
    const view = oversized.subarray(8, 12);
    expect(view.byteOffset).toBe(8);
    expect(view.buffer.byteLength).toBe(32);
    const packed = packedBytes(view);
    expect(packed.byteOffset).toBe(0);
    expect(packed.byteLength).toBe(4);
    expect(packed.buffer.byteLength).toBe(4);
    expect([...packed]).toEqual([1, 2, 3, 4]);
  });
});

describe('trip sheet Excel download', () => {
  it('copies workbook bytes into a fresh Uint8Array, not .buffer', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/trip-sheet.tsx'), 'utf8');
    expect(source).toContain('const payload = new Uint8Array(bytes)');
    expect(source).toContain('new Blob([payload]');
    expect(source).not.toContain('payload.buffer');
    expect(source).not.toContain('bytes.buffer');
    expect(source).not.toContain('bytes.slice()');
    expect(source).toContain('periodLabel');
  });
});
