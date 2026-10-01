import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { TRIP_SHEET_COLUMNS, tripSheetCells } from '../../src/application/trip-sheet/columns';
import { buildTripSheetWorkbook } from '../../src/application/trip-sheet/export-xlsx';
import { buildTripSheetPrintDocument, type TripSheetPrintRow } from '../../src/application/trip-sheet/print-document';

function row(overrides: Partial<TripSheetPrintRow> = {}): TripSheetPrintRow {
  return {
    date: '2026-09-14',
    driverName: 'Karolis Tautkus',
    route: 'R1',
    startOdometer: 100,
    endOdometer: 200,
    distanceKm: 100,
    fuelStart: 91.3,
    fuelAdded: 0,
    fuelConsumed: 13.9,
    fuelEnd: 77.4,
    receiptNumbers: [],
    ...overrides,
  };
}

function document(rows: TripSheetPrintRow[], driverNames = 'Karolis Tautkus') {
  return buildTripSheetPrintDocument({
    companyName: 'FiRo',
    companyAddress: 'Vilnius',
    periodLabel: '2026-09',
    fuelType: 'Dyzelinas',
    groups: [{
      monthLabel: '2026 m. rugsėjis',
      registrationNumber: 'NLL182',
      vehicleModel: 'Renault Master',
      driverNames,
      fuelNorm: 13.9,
      rows,
    }],
  });
}

function bodyCells(html: string, index: number): string[] {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((match) => match[1] ?? '');
  return [...(rows[index] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1] ?? '');
}

describe('trip sheet column layout', () => {
  it('numbers chronological rows from 1 and keeps a fuel fill in place', () => {
    const html = document([
      row({ date: '2026-09-14', route: 'R1', distanceKm: 100, fuelEnd: 77.4 }),
      row({
        date: '2026-09-15', route: 'Kuro pylimas', driverName: 'Karolis Tautkus',
        distanceKm: null, startOdometer: null, endOdometer: null,
        fuelStart: 77.4, fuelAdded: 83, fuelConsumed: 0, fuelEnd: 160.4, receiptNumbers: ['44'],
      }),
      row({ date: '2026-09-16', route: 'R2', distanceKm: 50, fuelStart: 160.4, fuelEnd: 153.4, startOdometer: 200, endOdometer: 250 }),
    ]);
    expect(bodyCells(html, 0)[0]).toBe('1');
    expect(bodyCells(html, 0)[1]).toContain('2026-09-14');
    expect(bodyCells(html, 1)[0]).toBe('2');
    expect(bodyCells(html, 1)[2]).toContain('Kuro pylimas');
    expect(bodyCells(html, 2)[0]).toBe('3');
    expect(bodyCells(html, 2)[1]).toContain('2026-09-16');
    const footer = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
    expect(footer).toContain('Iš viso');
    expect(footer).not.toMatch(/<td class="num">[123]<\/td>/);
  });

  it('keeps fuel and odometer values in the new column positions', () => {
    const cells = bodyCells(document([row({
      distanceKm: 474,
      fuelStart: 90,
      fuelAdded: 49,
      fuelConsumed: 68.7,
      fuelEnd: 70.3,
      receiptNumbers: ['565638'],
      startOdometer: 675154,
      endOdometer: 675628,
      route: 'R11 · R15',
      date: '2026-08-17',
    })]), 0);
    expect(cells.map((cell) => cell.replace(/<[^>]+>/g, ''))).toEqual([
      '1',
      '2026-08-17',
      'R11 · R15',
      '474',
      '90,00',
      '49,00',
      '565638',
      expect.stringContaining('68'),
      expect.stringContaining('70'),
      expect.stringMatching(/675/),
      expect.stringMatching(/628/),
      'Karolis Tautkus',
    ]);
    expect(TRIP_SHEET_COLUMNS.map((column) => column.key)).toEqual([
      'line', 'date', 'route', 'km', 'fuelStart', 'added', 'receipt', 'consumed', 'fuelEnd', 'odoStart', 'odoEnd', 'driver',
    ]);
    const keys = tripSheetCells({
      lineNumber: 1, date: '2026-08-17', route: 'R11', driverName: 'Karolis', distinctDriverCount: 1,
      distanceKm: 474, fuelStart: 90, fuelAdded: 49, receiptNumbers: ['565638'], fuelConsumed: 68.7,
      fuelEnd: 70.3, startOdometer: 10, endOdometer: 20,
    }).map((cell) => cell.key);
    expect(keys).toEqual(TRIP_SHEET_COLUMNS.map((column) => column.key));
  });

  it('shows the driver in its own last column, never inside the route', () => {
    const html = document([
      row({ date: '2026-09-01', route: 'R1', driverName: 'Karolis Tautkus' }),
      row({ date: '2026-09-02', route: 'R2', driverName: 'Aleksandras' }),
    ], 'Karolis Tautkus, Aleksandras');
    expect(html).toContain('Vairuotojas(-ai): Karolis Tautkus, Aleksandras');
    expect(bodyCells(html, 0)[2]).not.toContain('Karolis');
    expect(bodyCells(html, 0)[11]).toContain('Karolis Tautkus');
    expect(bodyCells(html, 1)[11]).toContain('Aleksandras');
    expect(html).not.toMatch(/<th[^>]*>Vair\.<\/th>/);
  });

  it('writes the same column order and the same totals to Excel', () => {
    const bytes = buildTripSheetWorkbook({
      companyName: 'FiRo',
      companyAddress: 'Vilnius',
      periodLabel: '2026-09',
      includeSummary: false,
      groups: [{
        month: '2026-09',
        driverName: 'Karolis Tautkus, Aleksandras',
        registrationNumber: 'NLL182',
        vehicleModel: 'Renault Master',
        fuelNormLitersPer100Km: 13.9,
        fuelType: 'Dyzelinas',
        rows: [
          {
            date: '2026-09-14', driverName: 'Karolis Tautkus', route: 'R1', distanceKm: 100,
            fuelStartLiters: 91.3, fuelAddedLiters: 0, receiptNumbers: [], fuelConsumedLiters: 13.9,
            fuelEndLiters: 77.4, startOdometer: 100, endOdometer: 200,
          },
          {
            date: '2026-09-15', driverName: 'Aleksandras', route: 'Kuro pylimas', distanceKm: null,
            fuelStartLiters: 77.4, fuelAddedLiters: 83, receiptNumbers: ['44'], fuelConsumedLiters: 0,
            fuelEndLiters: 160.4, startOdometer: null, endOdometer: null,
          },
        ],
      }],
    });
    const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
    const header = sheet.match(/<row r="6">([\s\S]*?)<\/row>/)?.[1] ?? '';
    let cursor = 0;
    for (const column of TRIP_SHEET_COLUMNS) {
      const at = header.indexOf(`>${column.short}<`, cursor);
      expect(at).toBeGreaterThanOrEqual(0);
      cursor = at + 1;
    }
    expect(sheet).toMatch(/<c r="A7"[^>]*><v>1<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="A8"[^>]*><v>2<\/v><\/c>/);
    expect(sheet).toContain('Kuro pylimas');
    expect(sheet).not.toContain('Kuro pylimas · Aleksandras');
    expect(sheet).toContain('Aleksandras');
    expect(sheet).toContain('<v>100</v>');
    expect(sheet).toContain('<v>83</v>');
    expect(sheet).toContain('<v>13.9</v>');
    expect(sheet).toContain('<v>160.4</v>');
    expect(sheet).toContain('<v>91.3</v>');
    const total = sheet.match(/<row r="9">([\s\S]*?)<\/row>/)?.[1] ?? '';
    expect(total).toContain('Iš viso');
    expect(total).not.toContain('<v>1</v>');
    expect(total).not.toContain('<v>2</v>');
    expect(total).toContain('<v>100</v>');
    expect(total).toContain('<v>83</v>');
  });
});
