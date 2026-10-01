export type TripSheetColumn = {
  key: string;
  short: string;
  full: string;
};

/**
 * One column list for the screen, the print/PDF sheet and Excel.
 * Bodies must be rendered from `tripSheetCells`, not a second hand-written order.
 */
export const TRIP_SHEET_COLUMNS = [
  { key: 'line', short: 'Eil. nr.', full: 'Eilės numeris' },
  { key: 'date', short: 'Data', full: 'Data' },
  { key: 'route', short: 'Maršrutas', full: 'Maršrutas' },
  { key: 'km', short: 'Km', full: 'Nuvažiuota, km' },
  { key: 'fuelStart', short: 'Kuras pradžioje', full: 'Kuras pradžioje, l' },
  { key: 'added', short: 'Įpilta', full: 'Įpilta, l' },
  { key: 'receipt', short: 'Čekio nr.', full: 'Čekio numeris' },
  { key: 'consumed', short: 'Sunaudotas kuro kiekis', full: 'Sunaudotas kuro kiekis, l' },
  { key: 'fuelEnd', short: 'Kuro likutis', full: 'Kuro likutis, l' },
  { key: 'odoStart', short: 'Odo prad.', full: 'Odometras pradžioje' },
  { key: 'odoEnd', short: 'Odo pab.', full: 'Odometras pabaigoje' },
] as const satisfies readonly TripSheetColumn[];

export const TRIP_SHEET_GRID_COLUMNS = TRIP_SHEET_COLUMNS;
export const TRIP_SHEET_PRINT_COLUMNS = TRIP_SHEET_COLUMNS;

const NUMERIC_COLUMN_KEYS = new Set<string>(['line', 'km', 'fuelStart', 'added', 'consumed', 'fuelEnd', 'odoStart', 'odoEnd']);

export function tripSheetColumnIsNumeric(key: string): boolean {
  return NUMERIC_COLUMN_KEYS.has(key);
}

export function tripSheetColumnLegend(columns: readonly TripSheetColumn[]): string {
  return columns
    .filter((column) => column.short !== column.full)
    .map((column) => `${column.short} — ${column.full}`)
    .join(' · ');
}

export function distinctDriverCount(names: readonly string[]): number {
  return new Set(names.map((name) => name.trim()).filter(Boolean)).size;
}

/**
 * The per-row driver column is gone because the sheet heading already names
 * the driver. A continuous sheet that mixes several drivers keeps the name
 * on the route cell, otherwise that day would no longer say who drove.
 */
export function tripSheetDisplayedRoute(route: string, driverName: string, drivers: number): string {
  const name = driverName.trim();
  if (drivers <= 1 || !name) return route;
  return `${route} · ${name}`;
}

export type TripSheetCellInput = {
  lineNumber: number | null;
  date: string;
  route: string;
  driverName: string;
  distinctDriverCount: number;
  distanceKm: number | null;
  fuelStart: number | null;
  fuelAdded: number | null;
  receiptNumbers: readonly (string | null | undefined)[];
  fuelConsumed: number | null;
  fuelEnd: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
};

export type TripSheetCell = {
  key: (typeof TRIP_SHEET_COLUMNS)[number]['key'];
  value: number | string | null;
};

export function tripSheetCells(input: TripSheetCellInput): TripSheetCell[] {
  const receipts = input.receiptNumbers.map((value) => value?.trim() ?? '').filter(Boolean).join(' / ');
  const values: Record<TripSheetCell['key'], number | string | null> = {
    line: input.lineNumber,
    date: input.date,
    route: tripSheetDisplayedRoute(input.route, input.driverName, input.distinctDriverCount),
    km: input.distanceKm,
    fuelStart: input.fuelStart,
    added: input.fuelAdded,
    receipt: receipts || null,
    consumed: input.fuelConsumed,
    fuelEnd: input.fuelEnd,
    odoStart: input.startOdometer,
    odoEnd: input.endOdometer,
  };
  return TRIP_SHEET_COLUMNS.map((column) => ({ key: column.key, value: values[column.key] }));
}
