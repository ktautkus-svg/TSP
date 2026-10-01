import { buildFormattedTableWorkbook, type TableColumnFormat } from '@/application/trip-sheet/export-xlsx';
import {
  summarizeWageDays,
  wageDayCell,
  wageTableColumns,
  wageTotalCell,
  type WageDayRow,
} from '@/application/finance/wage-report';

export type WageWorkbookInput = {
  companyName: string;
  employeeName: string;
  periodLabel: string;
  days: readonly WageDayRow[];
};

export function buildWageWorkbook(input: WageWorkbookInput): Uint8Array {
  const totals = summarizeWageDays(input.days);
  const showDriver = new Set(input.days.map((day) => day.driverId)).size > 1;
  const columns = wageTableColumns(showDriver);
  const company = input.companyName.trim();
  const subtitle = [company && company !== 'FiRo' ? company : '', input.employeeName, input.periodLabel].filter(Boolean).join(' · ');
  return buildFormattedTableWorkbook({
    sheetName: 'Atlygis',
    title: 'FiRo',
    subtitle,
    headers: columns.map((column) => column.header),
    rows: input.days.map((day) => columns.map((column) => wageDayCell(day, column.key))),
    totalRow: columns.map((column) => wageTotalCell(totals, column.key)),
    columnFormats: columns.map((column) => column.format as TableColumnFormat),
    columnWidths: columns.map((column) => (column.key === 'driver' ? 24 : column.key === 'date' ? 14 : 14)),
    notes: [
      { label: 'Kuras, €', value: totals.fuelCostEur, format: 'eur' },
      { label: 'Iš viso (kuras + atlygis), €', value: totals.totalEur, format: 'eur' },
    ],
  });
}
