import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildTripSheetWorkbook } from '../../src/application/trip-sheet/export-xlsx';

describe('trip sheet Excel export', () => {
  it('creates an accounting-ready workbook from real odometer and fuel fields', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Savanorių pr. 180, Vilnius',
      groups: [{
        month: '2026-08', driverName: 'Karolis Tautkus', registrationNumber: 'MET630', vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 14.5, fuelType: 'Dyzelinas',
        rows: [{
          date: '2026-08-17', driverName: 'Karolis Tautkus', route: 'R11 · R15', distanceKm: 474, fuelStartLiters: 90, fuelAddedLiters: 49,
          receiptNumbers: ['565638'], fuelConsumedLiters: 68.7, fuelEndLiters: 70.3,
          startOdometer: 675154, endOdometer: 675628,
        }],
      }],
    });

    const archive = unzipSync(workbook);
    const sheet = strFromU8(archive['xl/worksheets/sheet2.xml']!);
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
    expect(sheet).toContain('<f>SUM(C7:C7)</f>');
    expect(sheet).not.toContain('Sustojimo trukmė');
    expect(sheet).not.toContain('Stovėjimo laikas');
    expect(styles).toContain('formatCode="#,##0.0"');
  });

  it('writes core.xml timestamps without milliseconds so Excel will open the file', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [{
        month: '2026-08', driverName: 'Karolis Tautkus', registrationNumber: 'MET630', vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 12, fuelType: 'Dyzelinas',
        rows: [{
          date: '2026-08-17', driverName: 'Karolis Tautkus', route: 'R11', distanceKm: 100,
          fuelStartLiters: 50, fuelAddedLiters: 0, receiptNumbers: [], fuelConsumedLiters: 12, fuelEndLiters: 38,
          startOdometer: 1, endOdometer: 101,
        }],
      }],
    });
    const archive = unzipSync(workbook);
    const core = strFromU8(archive['docProps/core.xml']!);
    expect(core).toMatch(/dcterms:created[^>]*>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z</);
    expect(core).not.toMatch(/\.\d{3}Z</);
  });

  it('strips illegal XML control characters instead of producing a workbook Excel refuses to open', () => {
    // A route/address label built from OCR'd or pasted text can carry stray
    // control bytes (e.g. \x00-\x1F). Those are illegal even when
    // entity-escaped, and a single one anywhere in a worksheet makes Excel
    // discard the sheet's content and show the "we found a problem" repair
    // prompt — reported as the exported file coming back empty.
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [{
        month: '2026-08', driverName: 'Vairas 1', registrationNumber: 'MET630', vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 12.5, fuelType: 'Dyzelinas',
        rows: [{
          date: '2026-08-19', driverName: 'Vairas 1', route: 'Savanorių pr. 180\x00\x01\x02, Vilnius', distanceKm: 376,
          fuelStartLiters: 50, fuelAddedLiters: 0, receiptNumbers: [], fuelConsumedLiters: 40, fuelEndLiters: 10,
          startOdometer: 676420, endOdometer: 676796,
        }],
      }],
    });
    const archive = unzipSync(workbook);
    const sheet = strFromU8(archive['xl/worksheets/sheet2.xml']!);
    expect(sheet).toContain('Savanorių pr. 180, Vilnius');
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(sheet)).toBe(false);
  });

  it('orders <autoFilter> before <mergeCells> in every worksheet, as CT_Worksheet requires', () => {
    // Excel Desktop enforces the strict CT_Worksheet element sequence
    // (…sheetData, autoFilter, …, mergeCells, …). Emitting mergeCells before
    // autoFilter is schema-invalid; lenient readers (openpyxl, LibreOffice,
    // fflate's own unzip) tolerate it, but Excel's own parser silently
    // discards the worksheet's content and "repairs" it into a blank tab —
    // this was the real cause of the reported blank-on-open bug.
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [{
        month: '2026-08', driverName: 'Karolis Tautkus', registrationNumber: 'MET630', vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 12, fuelType: 'Dyzelinas',
        rows: [{
          date: '2026-08-17', driverName: 'Karolis Tautkus', route: 'R11', distanceKm: 100,
          fuelStartLiters: 50, fuelAddedLiters: 0, receiptNumbers: [], fuelConsumedLiters: 12, fuelEndLiters: 38,
          startOdometer: 1, endOdometer: 101,
        }],
      }],
    });
    const archive = unzipSync(workbook);
    for (const name of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
      const sheet = strFromU8(archive[name]!);
      const autoFilterIndex = sheet.indexOf('<autoFilter');
      const mergeCellsIndex = sheet.indexOf('<mergeCells');
      expect(autoFilterIndex).toBeGreaterThan(-1);
      expect(mergeCellsIndex).toBeGreaterThan(-1);
      expect(autoFilterIndex).toBeLessThan(mergeCellsIndex);
    }
  });

  it('adds a first Suvestinė sheet with per-vehicle totals so tab one is never sparse', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [
        {
          month: '2026-08', driverName: 'Karolis Tautkus', registrationNumber: 'MET630', vehicleModel: 'Renault Master',
          fuelNormLitersPer100Km: 12, fuelType: 'Dyzelinas',
          rows: [{
            date: '2026-08-17', driverName: 'Karolis Tautkus', route: 'R11', distanceKm: 100,
            fuelStartLiters: 50, fuelAddedLiters: 30, receiptNumbers: [], fuelConsumedLiters: 12, fuelEndLiters: 68,
            startOdometer: 1, endOdometer: 101,
          }],
        },
        {
          month: '2026-08', driverName: 'Vairas 2', registrationNumber: 'NLL182', vehicleModel: 'Volvo FH',
          fuelNormLitersPer100Km: 28, fuelType: 'Dyzelinas',
          rows: [{
            date: '2026-08-18', driverName: 'Vairas 2', route: 'R15', distanceKm: 250,
            fuelStartLiters: 200, fuelAddedLiters: 100, receiptNumbers: ['998877'], fuelConsumedLiters: 70, fuelEndLiters: 230,
            startOdometer: 500, endOdometer: 750,
          }],
        },
      ],
    });
    const archive = unzipSync(workbook);
    const workbookXmlContent = strFromU8(archive['xl/workbook.xml']!);
    expect(workbookXmlContent).toContain('name="Suvestinė"');
    const summary = strFromU8(archive['xl/worksheets/sheet1.xml']!);
    expect(summary).toContain('Kelionės lapų suvestinė');
    expect(summary).toContain('MET630');
    expect(summary).toContain('NLL182');
    expect(summary).toContain('Karolis Tautkus');
    expect(summary).toContain('Vairas 2');
    expect(summary).toContain('<f>SUM(E4:E5)</f>');
    // Every vehicle sheet must also carry real cell content, not just the summary tab.
    const metSheet = strFromU8(archive['xl/worksheets/sheet2.xml']!);
    const nllSheet = strFromU8(archive['xl/worksheets/sheet3.xml']!);
    expect(metSheet).toContain('MET630');
    expect(metSheet).toContain('<sheetData><row');
    expect(nllSheet).toContain('NLL182');
    expect(nllSheet).toContain('998877');
    expect(nllSheet).toContain('<sheetData><row');
  });

  it('unzips cleanly and every sheet part has non-empty <sheetData> for sample groups (MET630, NLL182, LRI*)', () => {
    const workbook = buildTripSheetWorkbook({
      companyName: 'TSP',
      companyAddress: 'Vilnius',
      groups: [
        {
          month: '2026-08', driverName: 'Karolis Tautkus', registrationNumber: 'MET630', vehicleModel: 'Renault Master',
          fuelNormLitersPer100Km: 12, fuelType: 'Dyzelinas',
          rows: [{
            date: '2026-08-17', driverName: 'Karolis Tautkus', route: 'R11', distanceKm: 100,
            fuelStartLiters: 50, fuelAddedLiters: 30, receiptNumbers: [], fuelConsumedLiters: 12, fuelEndLiters: 68,
            startOdometer: 1, endOdometer: 101,
          }],
        },
        {
          month: '2026-08', driverName: 'Vairas 2', registrationNumber: 'NLL182', vehicleModel: 'Volvo FH',
          fuelNormLitersPer100Km: 28, fuelType: 'Dyzelinas',
          rows: [{
            date: '2026-08-18', driverName: 'Vairas 2', route: 'R15', distanceKm: 250,
            fuelStartLiters: 200, fuelAddedLiters: 100, receiptNumbers: ['998877'], fuelConsumedLiters: 70, fuelEndLiters: 230,
            startOdometer: 500, endOdometer: 750,
          }],
        },
        {
          month: '2026-08', driverName: 'Vairas 3', registrationNumber: 'LRI123', vehicleModel: 'Scania R450',
          fuelNormLitersPer100Km: 32, fuelType: 'Dyzelinas',
          rows: [{
            date: '2026-08-19', driverName: 'Vairas 3', route: 'R22', distanceKm: 400,
            fuelStartLiters: 300, fuelAddedLiters: 150, receiptNumbers: ['112233'], fuelConsumedLiters: 128, fuelEndLiters: 322,
            startOdometer: 900, endOdometer: 1300,
          }],
        },
      ],
    });
    const archive = unzipSync(workbook);
    const sheetParts = ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml'];
    for (const part of sheetParts) {
      expect(archive[part]).toBeDefined();
      const xmlText = strFromU8(archive[part]!);
      expect(xmlText).toMatch(/<sheetData>(?:(?!<\/sheetData>).)*<c\b/s);
    }
    expect(strFromU8(archive['xl/worksheets/sheet3.xml']!)).toContain('NLL182');
    expect(strFromU8(archive['xl/worksheets/sheet4.xml']!)).toContain('LRI123');
  });
});
