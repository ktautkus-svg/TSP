import { distinctDriverCount, TRIP_SHEET_PRINT_COLUMNS, tripSheetCells, tripSheetColumnLegend, type TripSheetCell } from '@/application/trip-sheet/columns';
import { FUEL_OVER_CAPACITY_NOTE, closingFuelLiters, fuelRemainderExceedsTank, openingFuelLiters } from '@/application/trip-sheet/fuel-balance';

const PRINT_COL_PERCENTS = [6, 10, 16, 7, 10, 8, 9, 12, 8, 7, 7];

export type TripSheetPrintRow = {
  date: string;
  driverName: string;
  route: string;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number | null;
  fuelStart: number | null;
  fuelAdded: number | null;
  fuelConsumed: number | null;
  fuelEnd: number | null;
  receiptNumbers: string[];
};

export type TripSheetPrintGroup = {
  monthLabel: string;
  registrationNumber: string;
  vehicleModel: string;
  driverNames: string;
  fuelNorm: number | null;
  /** Stated tank size. Used only to mark a remainder that is above it. */
  tankCapacityLiters?: number | null;
  rows: TripSheetPrintRow[];
  /** Set on a numbered per-driver sheet ("Kelionės lapas Nr. N"); null on the continuous month sheet. */
  sheetNumber?: number | null;
  /** Period range for this sheet ("2026-09-02 – 2026-09-03"); falls back to the document period. */
  periodLabel?: string;
};

export type TripSheetPrintDocumentInput = {
  companyName: string;
  companyAddress: string;
  periodLabel: string;
  fuelType: string;
  groups: TripSheetPrintGroup[];
};

export function buildTripSheetPrintDocument(input: TripSheetPrintDocumentInput): string {
  const sheets = input.groups.map((group) => renderGroup(group, input)).join('');
  // Deliberately blank <title>: Chrome prints the document title in the top
  // page margin, and the app URL in the bottom one. The iframe is fed via
  // srcdoc (about:srcdoc) so there is no app URL to print, and a single space
  // title keeps that corner empty too.
  return `<!DOCTYPE html>
<html lang="lt">
<head>
  <meta charset="utf-8" />
  <title> </title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    @page { @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; font-family: Arial, Helvetica, sans-serif; } }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font: 11pt Arial, Helvetica, sans-serif; }
    #trip-sheet-print-root { padding: 0; }
    .sheet { page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
    h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4px; }
    .company { font-size: 11pt; font-weight: 700; text-align: center; margin: 0 0 8px; }
    .meta { display: flex; flex-wrap: wrap; gap: 12px 28px; justify-content: center; margin: 0 0 8px; font-size: 10pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10pt; }
    th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
    th { background: #eaeaea; font-size: 8.5pt; font-weight: 700; text-align: center; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 700; background: #f3f3f3; }
    .legend { margin-top: 8px; font-size: 8.5pt; line-height: 1.35; }
    .signatures { margin-top: 14px; display: grid; gap: 8px; font-size: 9.5pt; }
    .summary { margin-top: 10px; border: 1px solid #000; font-size: 9.5pt; }
    .summary-row { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 5px 8px; border-bottom: 1px solid #000; }
    .summary-row:last-child { border-bottom: 0; }
    .summary-label { font-weight: 700; min-width: 90px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div id="trip-sheet-print-root" data-testid="trip-sheet-print-root">${sheets}</div>
</body>
</html>`;
}

function renderGroup(group: TripSheetPrintGroup, input: TripSheetPrintDocumentInput): string {
  const company = [input.companyName, input.companyAddress].filter((part) => part.trim()).join(', ') || ' ';
  const firstOdometer = group.rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null;
  const lastOdometer = [...group.rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null;
  const tankCapacityLiters = group.tankCapacityLiters ?? null;
  const firstFuel = openingFuelLiters(group.rows.map((row) => row.fuelStart));
  const lastFuel = closingFuelLiters(group.rows.map((row) => row.fuelEnd));
  const overCapacity = group.rows.some((row) =>
    fuelRemainderExceedsTank(row.fuelStart, tankCapacityLiters) || fuelRemainderExceedsTank(row.fuelEnd, tankCapacityLiters));
  const totalDistance = group.rows.reduce((sum, row) => sum + (row.distanceKm ?? 0), 0);
  const totalFuel = group.rows.reduce((sum, row) => sum + (row.fuelConsumed ?? 0), 0);
  const totalFuelAdded = group.rows.reduce((sum, row) => sum + (row.fuelAdded ?? 0), 0);
  const headers = TRIP_SHEET_PRINT_COLUMNS.map((column) =>
    `<th title="${escapeHtml(column.full)}">${escapeHtml(column.short)}</th>`).join('');
  const columns = PRINT_COL_PERCENTS.map((width) => `<col style="width:${width}%" />`).join('');
  const drivers = distinctDriverCount(group.rows.map((row) => row.driverName));
  const body = group.rows.map((row, index) => `<tr>${tripSheetCells({
    lineNumber: index + 1,
    date: row.date,
    route: row.route,
    driverName: row.driverName,
    distinctDriverCount: drivers,
    distanceKm: row.distanceKm,
    fuelStart: row.fuelStart,
    fuelAdded: row.fuelAdded,
    receiptNumbers: row.receiptNumbers,
    fuelConsumed: row.fuelConsumed,
    fuelEnd: row.fuelEnd,
    startOdometer: row.startOdometer,
    endOdometer: row.endOdometer,
  }).map((cell) => printCell(cell, tankCapacityLiters, '—')).join('')}</tr>`).join('');
  const totalCells = tripSheetCells({
    lineNumber: null,
    date: '',
    route: 'Iš viso',
    driverName: '',
    distinctDriverCount: 1,
    distanceKm: totalDistance,
    fuelStart: firstFuel,
    fuelAdded: totalFuelAdded,
    receiptNumbers: [],
    fuelConsumed: totalFuel,
    fuelEnd: lastFuel,
    startOdometer: firstOdometer,
    endOdometer: lastOdometer,
  });
  const heading = group.sheetNumber == null ? 'Kelionės lapas' : `Kelionės lapas Nr. ${group.sheetNumber}`;
  const period = group.periodLabel?.trim() || input.periodLabel;
  return `<section class="sheet">
    <h1>${escapeHtml(heading)}</h1>
    <p class="company">${escapeHtml(company)}</p>
    <div class="meta">
      <span>Transporto priemonė: ${escapeHtml(group.vehicleModel)} · ${escapeHtml(group.registrationNumber)}</span>
      <span>Degalų norma: ${escapeHtml(formatFuelNorm(group.fuelNorm))}</span>
      <span>Kuro tipas: ${escapeHtml(input.fuelType)}</span>
      <span>Vairuotojas(-ai): ${escapeHtml(group.driverNames)}</span>
      <span>Laikotarpis: ${escapeHtml(period)}</span>
      <span>Mėnuo: ${escapeHtml(group.monthLabel)}</span>
    </div>
    <table>
      <colgroup>${columns}</colgroup>
      <thead><tr>${headers}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>${totalCells.map((cell) => printCell(cell, tankCapacityLiters, '')).join('')}</tr></tfoot>
    </table>
    <p class="legend">${escapeHtml(tripSheetColumnLegend(TRIP_SHEET_PRINT_COLUMNS))}</p>
    <div class="signatures">
      <div>Kelionės lapą išdavė ______________________________ (vardas, pavardė, parašas, data)</div>
      <div>Vadovas ______________________________ (vardas, pavardė, parašas, data)</div>
      <div>Kelionės lapą priėmė ______________________________ (vardas, pavardė, parašas, data)</div>
    </div>
    <div class="summary">
      <div class="summary-row">
        <span class="summary-label">Odometras</span>
        <span>Pradžioje: ${formatNumber(firstOdometer)}</span>
        <span>Pabaigoje: ${formatNumber(lastOdometer)}</span>
        <span>Atstumas: ${formatNumber(totalDistance)} km</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Degalai</span>
        <span>L. d.d.p.: ${firstFuel === null ? '—' : formatLiters(firstFuel)}</span>
        <span>L. d.d.pb.: ${lastFuel === null ? '—' : formatLiters(lastFuel)}</span>
        <span>Įpilta: ${formatLiters(totalFuelAdded)}</span>
        <span>Sunaudota: ${formatLiters(totalFuel)}</span>
        <span>Norma: ${escapeHtml(formatFuelNorm(group.fuelNorm))}</span>
      </div>
    </div>
    ${overCapacity ? `<p class="legend">${escapeHtml(FUEL_OVER_CAPACITY_NOTE)}</p>` : ''}
  </section>`;
}

function printCell(cell: TripSheetCell, tankCapacityLiters: number | null, emptyText: string): string {
  if (cell.key === 'fuelStart' || cell.key === 'fuelEnd') {
    return fuelNumberCell(typeof cell.value === 'number' ? cell.value : null, tankCapacityLiters);
  }
  if (cell.key === 'consumed') {
    const shown = typeof cell.value === 'number' ? formatLiters(cell.value) : (emptyText === '' ? '' : '0,00');
    return `<td class="num">${shown}</td>`;
  }
  if (cell.key === 'line') return `<td class="num">${typeof cell.value === 'number' ? String(cell.value) : ''}</td>`;
  if (typeof cell.value === 'number') return `<td class="num">${cell.key === 'added' ? formatLiters(cell.value) : formatNumber(cell.value)}</td>`;
  const text = cell.value === null || cell.value === '' ? emptyText : cell.value;
  return `<td>${escapeHtml(text)}</td>`;
}

function fuelNumberCell(value: number | null, tankCapacityLiters: number | null): string {
  if (value === null) return '<td class="num">—</td>';
  if (!fuelRemainderExceedsTank(value, tankCapacityLiters)) return `<td class="num">${formatLiters(value)}</td>`;
  return `<td class="num" title="${escapeHtml(FUEL_OVER_CAPACITY_NOTE)}">${formatLiters(value)}</td>`;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value);
}

/** Fuel litres always show two decimals. */
function formatLiters(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatFuelNorm(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value)} L/100km`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
