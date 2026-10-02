import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TRIP_SHEET_GRID_COLUMNS, TRIP_SHEET_PRINT_COLUMNS, tripSheetColumnLegend } from '../../src/application/trip-sheet/columns';
import { buildTripSheetPrintDocument } from '../../src/application/trip-sheet/print-document';

const tripSheetSource = readFileSync(resolve(import.meta.dirname, '../../src/app/trip-sheet.tsx'), 'utf8');
const htmlSource = readFileSync(resolve(import.meta.dirname, '../../src/app/+html.tsx'), 'utf8');

const sampleDocument = () => buildTripSheetPrintDocument({
  companyName: 'FiRo',
  companyAddress: 'Savanorių pr. 180, Vilnius',
  periodLabel: '2026-08',
  fuelType: 'Dyzelinas',
  groups: [{
    monthLabel: '2026 m. rugpjūtis',
    registrationNumber: 'MET630',
    vehicleModel: 'Renault Master',
    driverNames: 'Karolis Tautkus',
    fuelNorm: 14.5,
    rows: [{
      date: '2026-08-17',
      driverName: 'Karolis Tautkus',
      route: 'R11 · R15',
      startOdometer: 675154,
      endOdometer: 675628,
      distanceKm: 474,
      fuelStart: 90,
      fuelAdded: 49,
      fuelConsumed: 68.7,
      fuelEnd: 70.3,
      receiptNumbers: ['565638'],
    }],
  }],
});

describe('trip sheet print document', () => {
  it('prints a dedicated kelionės lapas HTML table, not a screenshot of the app screen', () => {
    expect(tripSheetSource).not.toContain('html2canvas');
    expect(tripSheetSource).not.toContain('toDataURL');
    expect(tripSheetSource).toContain('buildTripSheetPrintDocument');
    expect(tripSheetSource).toContain('printHtmlDocument');
    expect(tripSheetSource).toContain('iframe');
    expect(tripSheetSource).not.toContain('setPrintMode(true)');
    expect(tripSheetSource).not.toContain('window.print()');

    const html = sampleDocument();
    expect(html).toContain('data-testid="trip-sheet-print-root"');
    expect(html).toContain('id="trip-sheet-print-root"');
    expect(html).toContain('<table>');
    expect(html).toContain('@page { size: A4 landscape');
    expect(html).toContain('Kelionės lapas');
    expect(html).toContain('Karolis Tautkus');
    expect(html).toContain('R11 · R15');
    expect(html).toContain('565638');
    expect(html).not.toContain('Spausdinti / PDF');
    expect(html).not.toContain('Atnaujinti');
    expect(html).not.toContain('trip-sheet-toolbar');
    expect(html).not.toContain('html2canvas');
  });

  it('prints a clean A4 sheet: blank <title>, no app URL, one h1 per sheet', () => {
    const html = sampleDocument();
    // Chrome stamps the document <title> in the top page margin — keep it blank.
    expect(html).not.toContain('<title>Kelionės lapas</title>');
    expect(html).toContain('<title> </title>');
    // Exactly one <h1>Kelionės lapas</h1> for a single sheet, no app chrome/URL.
    expect(html.match(/<h1>/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/<h1>Kelionės lapas<\/h1>/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('localhost');
    // The iframe is fed via srcdoc (about:srcdoc) so no parent URL prints.
    expect(tripSheetSource).toContain('iframe.srcdoc = html');
    expect(tripSheetSource).not.toContain('frameDocument.write(html)');
    expect(html).toContain('@page { size: A4 landscape; margin: 10mm; }');
  });

  it('numbers a per-driver run sheet in the h1 and shows its own period', () => {
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
        sheetNumber: 2,
        periodLabel: '2026-09-04 – 2026-09-05',
        rows: [{
          date: '2026-09-04', driverName: 'Karolis Tautkus', route: 'R11',
          startOdometer: 1, endOdometer: 2, distanceKm: 1, fuelStart: 10, fuelAdded: 0,
          fuelConsumed: 0.1, fuelEnd: 9.9, receiptNumbers: [],
        }],
      }],
    });
    expect(html).toContain('<h1>Kelionės lapas Nr. 2</h1>');
    expect(html).toContain('Laikotarpis: 2026-09-04 – 2026-09-05');
  });

  it('uses abbreviated column headers with a legend of the full Lithuanian names', () => {
    const html = sampleDocument();
    expect(html).toContain('>L. d.d.p.<');
    expect(html).toContain('>Od. pr.<');
    expect(html).toContain('>Od. pab.<');
    expect(html).toContain('>Įp., l<');
    expect(html).toContain('>Sąn. n., l<');
    expect(html).toContain('title="Likutis dienos pradžioje"');
    expect(html).toContain('title="Odometras pradžioje"');
    expect(html).toContain('L. d.d.p. — Likutis dienos pradžioje');
    expect(html).not.toMatch(/<th[^>]*>Odometras pradžioje<\/th>/);
    expect(html).not.toMatch(/<th[^>]*>Kuras dienos pradžioje/);
    expect(html).not.toMatch(/<th[^>]*>Degalų sąnaudos pagal normą/);

    expect(tripSheetSource).toContain('TRIP_SHEET_GRID_COLUMNS');
    expect(tripSheetSource).toContain('trip-sheet-column-legend');
    expect(tripSheetColumnLegend(TRIP_SHEET_GRID_COLUMNS)).toContain('L. d.d.p. — Likutis dienos pradžioje');
    expect(TRIP_SHEET_PRINT_COLUMNS.some((column) => column.short === 'L. d.d.p.')).toBe(true);
  });

  it('hides nav, filters, metric cards and action buttons from a browser print of the screen', () => {
    expect(htmlSource).toContain('[data-testid="trip-sheet-toolbar"]');
    expect(htmlSource).toContain('[data-testid="trip-sheet-metrics"]');
    expect(htmlSource).toContain('[data-testid="trip-sheet-month-total"]');
    expect(htmlSource).not.toContain('trip-sheet-print-view');
  });
});
