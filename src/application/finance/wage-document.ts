import { formatDateKey } from '@/application/reporting/period-range';
import {
  summarizeWageDays,
  wageDayCell,
  wageTableColumns,
  wageTotalCell,
  type WageColumnKey,
  type WageDayRow,
  type WagePeriodTotals,
} from '@/application/finance/wage-report';

export type WagePrintInput = {
  companyName: string;
  employeeName: string;
  periodLabel: string;
  days: readonly WageDayRow[];
};

const eurFormatter = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFormatter = new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 });

export function buildWagePrintDocument(input: WagePrintInput): string {
  const totals = summarizeWageDays(input.days);
  const showDriver = new Set(input.days.map((day) => day.driverId)).size > 1;
  const columns = wageTableColumns(showDriver);
  const company = input.companyName.trim() || 'FiRo';
  const headers = columns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join('');
  const body = input.days.map((day) => `<tr>${columns.map((column) => `<td class="${column.format === 'text' ? '' : 'num'}">${escapeHtml(displayDay(day, column.key))}</td>`).join('')}</tr>`).join('');
  const footer = `<tr>${columns.map((column) => `<td class="${column.format === 'text' ? '' : 'num'}">${escapeHtml(displayTotal(totals, column.key))}</td>`).join('')}</tr>`;
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
    h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4px; }
    .company { font-size: 11pt; font-weight: 700; text-align: center; margin: 0 0 8px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: center; margin: 0 0 8px; font-size: 10pt; }
    .note { margin: 0 0 8px; font-size: 9pt; text-align: center; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
    th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
    th { background: #eaeaea; font-weight: 700; text-align: center; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 700; background: #f3f3f3; }
  </style>
</head>
<body>
  <h1>FiRo</h1>
  <p class="company">${escapeHtml(company)}</p>
  <div class="meta">
    <span>Darbuotojas: ${escapeHtml(input.employeeName)}</span>
    <span>Laikotarpis: ${escapeHtml(input.periodLabel)}</span>
    <span>Reisų: ${totals.routes}</span>
    <span>Km: ${escapeHtml(qtyFormatter.format(totals.km))}</span>
    <span>Kuras: ${escapeHtml(eurFormatter.format(totals.fuelCostEur))}</span>
    <span>Atlygis: ${escapeHtml(eurFormatter.format(totals.payEur))}</span>
    <span>Iš viso: ${escapeHtml(eurFormatter.format(totals.totalEur))}</span>
  </div>
  <p class="note">Atlygis yra dienų sumų suma. Iš viso prideda kuro pylimų kainą. Bazinis dienos atlygis skaičiuojamas vieną kartą.</p>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot>${footer}</tfoot>
  </table>
</body>
</html>`;
}

function displayDay(day: WageDayRow, key: WageColumnKey): string {
  if (key === 'date') return formatDateKey(day.date);
  return formatValue(wageDayCell(day, key), key, '—');
}

function displayTotal(totals: WagePeriodTotals, key: WageColumnKey): string {
  if (key === 'date') return 'Iš viso';
  return formatValue(wageTotalCell(totals, key), key, '');
}

function formatValue(value: string | number | null, key: WageColumnKey, empty: string): string {
  if (value === null || value === '') return empty;
  if (typeof value !== 'number') return value;
  if (key === 'stops') return String(value);
  if (key === 'km' || key === 'kg') return qtyFormatter.format(value);
  return eurFormatter.format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
