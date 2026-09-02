export type TripSheetColumn = {
  key: string;
  short: string;
  full: string;
};

/** On-screen grid columns. Short labels keep the table readable; `full` is the legend/tooltip. */
export const TRIP_SHEET_GRID_COLUMNS = [
  { key: 'date', short: 'Data', full: 'Data' },
  { key: 'driver', short: 'Vair.', full: 'Vairuotojas' },
  { key: 'route', short: 'Maršr.', full: 'Kur važiuota' },
  { key: 'odoStart', short: 'Od. pr.', full: 'Odometras pradžioje' },
  { key: 'odoEnd', short: 'Od. pab.', full: 'Odometras pabaigoje' },
  { key: 'km', short: 'Km', full: 'Nuvažiuota, km' },
  { key: 'consumed', short: 'Sąn., l', full: 'Sunaudota pagal normą, l' },
  { key: 'added', short: 'Įp., l', full: 'Įpilta, l' },
  { key: 'fuelStart', short: 'L. d.d.p.', full: 'Likutis dienos pradžioje' },
  { key: 'fuelEnd', short: 'L. d.d.pb.', full: 'Likutis dienos pabaigoje' },
] as const satisfies readonly TripSheetColumn[];

/** Print/PDF document columns (official kelionės lapas layout). */
export const TRIP_SHEET_PRINT_COLUMNS = [
  { key: 'date', short: 'Data', full: 'Data' },
  { key: 'driver', short: 'Vair.', full: 'Vairuotojas' },
  { key: 'route', short: 'Maršr.', full: 'Maršrutas' },
  { key: 'odoStart', short: 'Od. pr.', full: 'Odometras pradžioje' },
  { key: 'odoEnd', short: 'Od. pab.', full: 'Odometras pabaigoje' },
  { key: 'km', short: 'Km', full: 'Atstumas, km' },
  { key: 'fuelStart', short: 'L. d.d.p.', full: 'Likutis dienos pradžioje' },
  { key: 'added', short: 'Įp., l', full: 'Įpilta kuro, l' },
  { key: 'receipt', short: 'Ček. Nr.', full: 'Kasos čekio Nr.' },
  { key: 'consumed', short: 'Sąn. n., l', full: 'Degalų sąnaudos pagal normą, l' },
  { key: 'fuelEnd', short: 'L. d.d.pb.', full: 'Kuro likutis dienos pabaigoje' },
] as const satisfies readonly TripSheetColumn[];

export function tripSheetColumnLegend(columns: readonly TripSheetColumn[]): string {
  return columns
    .filter((column) => column.short !== column.full)
    .map((column) => `${column.short} — ${column.full}`)
    .join(' · ');
}
