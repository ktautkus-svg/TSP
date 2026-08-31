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
    const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']!);
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
    const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('Savanorių pr. 180, Vilnius');
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(sheet)).toBe(false);
  });
});
