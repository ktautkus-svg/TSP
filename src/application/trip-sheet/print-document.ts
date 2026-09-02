import { TRIP_SHEET_PRINT_COLUMNS, tripSheetColumnLegend } from '@/application/trip-sheet/columns';

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
  rows: TripSheetPrintRow[];
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
  return `<!DOCTYPE html>
<html lang="lt">
<head>
  <meta charset="utf-8" />
  <title>Kelionės lapas</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
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
  const firstFuel = group.rows.find((row) => row.fuelStart !== null)?.fuelStart ?? null;
  const lastFuel = [...group.rows].reverse().find((row) => row.fuelEnd !== null)?.fuelEnd ?? null;
  const totalDistance = group.rows.reduce((sum, row) => sum + (row.distanceKm ?? 0), 0);
  const totalFuel = group.rows.reduce((sum, row) => sum + (row.fuelConsumed ?? 0), 0);
  const totalFuelAdded = group.rows.reduce((sum, row) => sum + (row.fuelAdded ?? 0), 0);
  const headers = TRIP_SHEET_PRINT_COLUMNS.map((column) =>
    `<th title="${escapeHtml(column.full)}">${escapeHtml(column.short)}</th>`).join('');
  const body = group.rows.map((row) => `<tr>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(row.driverName)}</td>
      <td>${escapeHtml(row.route)}</td>
      <td class="num">${formatNumber(row.startOdometer)}</td>
      <td class="num">${formatNumber(row.endOdometer)}</td>
      <td class="num">${formatNumber(row.distanceKm)}</td>
      <td class="num">${row.fuelStart === null ? '—' : formatNumber(row.fuelStart)}</td>
      <td class="num">${formatNumber(row.fuelAdded)}</td>
      <td>${escapeHtml(row.receiptNumbers.filter(Boolean).join(' / ') || '—')}</td>
      <td class="num">${row.fuelConsumed === null ? '0,00' : formatNumber(row.fuelConsumed)}</td>
      <td class="num">${row.fuelEnd === null ? '—' : formatNumber(row.fuelEnd)}</td>
    </tr>`).join('');
  return `<section class="sheet">
    <h1>Kelionės lapas</h1>
    <p class="company">${escapeHtml(company)}</p>
    <div class="meta">
      <span>Transporto priemonė: ${escapeHtml(group.vehicleModel)} · ${escapeHtml(group.registrationNumber)}</span>
      <span>Degalų norma: ${escapeHtml(formatFuelNorm(group.fuelNorm))}</span>
      <span>Kuro tipas: ${escapeHtml(input.fuelType)}</span>
      <span>Vairuotojas(-ai): ${escapeHtml(group.driverNames)}</span>
      <span>Laikotarpis: ${escapeHtml(input.periodLabel)}</span>
      <span>Mėnuo: ${escapeHtml(group.monthLabel)}</span>
    </div>
    <table>
      <thead><tr>${headers}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td></td><td></td>
        <td>Iš viso</td>
        <td class="num">${formatNumber(firstOdometer)}</td>
        <td class="num">${formatNumber(lastOdometer)}</td>
        <td class="num">${formatNumber(totalDistance)}</td>
        <td></td>
        <td class="num">${formatNumber(totalFuelAdded)}</td>
        <td></td>
        <td class="num">${formatNumber(totalFuel)}</td>
        <td class="num">${lastFuel === null ? '—' : formatNumber(lastFuel)}</td>
      </tr></tfoot>
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
        <span>L. d.d.p.: ${firstFuel === null ? '—' : formatNumber(firstFuel)}</span>
        <span>L. d.d.pb.: ${lastFuel === null ? '—' : formatNumber(lastFuel)}</span>
        <span>Įpilta: ${formatNumber(totalFuelAdded)}</span>
        <span>Sunaudota: ${formatNumber(totalFuel)}</span>
        <span>Norma: ${escapeHtml(formatFuelNorm(group.fuelNorm))}</span>
      </div>
    </div>
  </section>`;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value);
}

function formatFuelNorm(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value)} L/100km`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
