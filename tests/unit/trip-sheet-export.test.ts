import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('trip sheet Excel export', () => {
  it('creates an accounting-ready workbook from real odometer and fuel fields', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Savanorių pr. 180, Vilnius',
      groups: [SAMPLE_GROUPS[0]!],
    });

    const archive = unzipWorkbook(workbook);
    const sheet = sheetText(archive, 2);
    const styles = strFromU8(archive['xl/styles.xml']!);
    expect(sheet).toContain('Kelionės lapų ataskaita');
    expect(sheet).toContain('Kasos čekio Nr.');
    expect(sheet).toContain('Odometras pradžioje');
    expect(sheet).toContain('Odometras pabaigoje');
    expect(sheet).toContain('Vairuotojas');
    expect(sheet).toContain('Karolis Tautkus');
    expect(sheet).toContain('565638');
    expect(sheet).toContain('675154');
    expect(sheet).toContain('675628');
    expect(sheet).toContain('<v>474</v>');
    expect(sheet).not.toContain('<f>');
    expect(sheet).not.toContain('Sustojimo trukmė');
    expect(sheet).not.toContain('Stovėjimo laikas');
    expect(styles).toContain('formatCode="#,##0.0"');
  });

  it('puts Suvestinė first and writes inlineStr / v cells Excel Desktop will display', () => {
    const workbook = buildTripSheetWorkbook(SAMPLE_INPUT);
    expect(workbook.byteOffset).toBe(0);
    expect(workbook.byteLength).toBe(workbook.buffer.byteLength);
    expect(workbook[0]).toBe(0x50);
    expect(workbook[1]).toBe(0x4b);

    const archive = unzipWorkbook(workbook);
    const workbookXml = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXml).toMatch(/<sheet name="Suvestinė" sheetId="1" r:id="rId1"\/>/);
    expect(workbookXml).toContain('name="MET630 2026-08"');
    expect(workbookXml).toContain('name="NLL182 2026-08"');
    expect(workbookXml).toContain('name="LRI740 2026-08"');

    const summary = sheetText(archive, 1);
    expect(summary).toContain('t="inlineStr"');
    expect(summary).toContain('Kelionės lapų suvestinė');
    expect(summary).toContain('MET630');
    expect(summary).toContain('NLL182');
    expect(summary).toContain('LRI740');
    expect(summary).toMatch(/<c r="F5"[^>]*><v>474<\/v><\/c>/);
    expect(summary).toMatch(/<c r="F6"[^>]*><v>210<\/v><\/c>/);
    expect(summary).toMatch(/<c r="F7"[^>]*><v>12<\/v><\/c>/);
    expect(summary).toMatch(/<c r="F8"[^>]*><v>696<\/v><\/c>/);

    const met = sheetText(archive, 2);
    expect(met).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-17<\/t>/);
    expect(met).toMatch(/<c r="C7"[^>]*><v>474<\/v><\/c>/);
    expect(met).toContain('Kelionės lapų ataskaita');
    expect(met).toContain('Karolis Tautkus');

    const nll = sheetText(archive, 3);
    expect(nll).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-19<\/t>/);
    expect(nll).toMatch(/<c r="C7"[^>]*><v>210<\/v><\/c>/);

    const lri = sheetText(archive, 4);
    expect(lri).toMatch(/<c r="A7" t="inlineStr"[^>]*>[\s\S]*?<t[^>]*>2026-08-09<\/t>/);
    expect(lri).toMatch(/<c r="C7"[^>]*><v>12<\/v><\/c>/);
    expect(lri).toContain('R56');

    for (const index of [1, 2, 3, 4]) {
      const xml = sheetText(archive, index);
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
    const sheet = sheetText(archive, 2);
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
  });
});
