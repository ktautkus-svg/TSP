import { NLL182_ODOMETER_LOG } from './nll182-odometer-log';

/**
 * August 2026 Circle K / Neste fills from Bendras.xlsx.
 * Station addresses were in the sheet but not retained here — do not invent them.
 * Times are Lithuania local (August = UTC+3).
 */
export type ExcelFuelFill = {
  registrationNumber: 'MET630' | 'NLL182';
  localDate: string;
  localTime: string;
  receiptNumber: string;
  liters: number;
};

export const NLL182_OPENING_FUEL_LITERS = 30;
export const NLL182_OPENING_FUEL_EFFECTIVE_AT = '2026-08-01';
export const NLL182_OPENING_FUEL_REPORT_ID = 'open-NLL182-20260801';
export const NLL182_OPENING_FUEL_NOTE = 'Rugpjūčio 1 d. bako likutis pagal administratoriaus nurodymą.';

export const EXCEL_FUEL_LOG: readonly ExcelFuelFill[] = [
  { registrationNumber: 'MET630', localDate: '2026-08-04', localTime: '09:01', receiptNumber: '135/1193', liters: 104.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-05', localTime: '18:14', receiptNumber: '230/419', liters: 107.98 },
  { registrationNumber: 'NLL182', localDate: '2026-08-08', localTime: '22:23', receiptNumber: '476/1186', liters: 87.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-09', localTime: '13:05', receiptNumber: '206/1184', liters: 86.30 },
  { registrationNumber: 'MET630', localDate: '2026-08-09', localTime: '19:53', receiptNumber: '242/426', liters: 46.01 },
  { registrationNumber: 'MET630', localDate: '2026-08-09', localTime: '23:23', receiptNumber: '476/1159', liters: 10.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-09', localTime: '23:38', receiptNumber: '325/1158', liters: 95.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-11', localTime: '09:34', receiptNumber: '148/1145', liters: 100.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-12', localTime: '13:52', receiptNumber: '277/1160', liters: 102.17 },
  { registrationNumber: 'NLL182', localDate: '2026-08-13', localTime: '04:13', receiptNumber: '47/1188', liters: 59.99 },
  { registrationNumber: 'MET630', localDate: '2026-08-13', localTime: '23:42', receiptNumber: '669/1206', liters: 30.07 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '04:30', receiptNumber: '5/1173', liters: 60.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '13:21', receiptNumber: '92/1160', liters: 9.99 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '19:35', receiptNumber: '421/1191', liters: 4.85 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '22:17', receiptNumber: '466/1166', liters: 83.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-17', localTime: '00:45', receiptNumber: '333/1165', liters: 103.31 },
  { registrationNumber: 'MET630', localDate: '2026-08-17', localTime: '17:46', receiptNumber: '449/2177', liters: 73.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-19', localTime: '10:55', receiptNumber: '212/1167', liters: 78.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-20', localTime: '07:49', receiptNumber: '74/1154', liters: 70.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-21', localTime: '02:20', receiptNumber: '13/1214', liters: 45.60 },
  { registrationNumber: 'MET630', localDate: '2026-08-21', localTime: '04:41', receiptNumber: '1/265', liters: 90.00 },
];

const FIRESTORE_ID = /^[a-zA-Z0-9_-]{8,80}$/;

/** Circle K receipt numbers use `/`; Firestore ids cannot. */
export function excelFuelDocumentId(fill: Pick<ExcelFuelFill, 'registrationNumber' | 'localDate' | 'receiptNumber'>): string {
  const date = fill.localDate.replaceAll('-', '');
  const receipt = fill.receiptNumber.replaceAll('/', '-');
  const id = `xlsx-${fill.registrationNumber}-${date}-${receipt}`;
  if (!FIRESTORE_ID.test(id)) {
    throw new Error(`Excel fuel document id is not a valid Firestore id: ${id}`);
  }
  return id;
}

/** August Lithuania is EEST (UTC+3). Stored as ISO so the lt-LT UI shows the local clock. */
export function lithuaniaLocalToIso(date: string, time: string): string {
  const parsed = new Date(`${date}T${time}:00+03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Lithuania local datetime: ${date} ${time}`);
  return parsed.toISOString();
}

export function excelFuelOdometer(registrationNumber: string, date: string): number {
  if (registrationNumber.toUpperCase() !== 'NLL182') return 0;
  return NLL182_ODOMETER_LOG.find((day) => day.date === date)?.endOdometer ?? 0;
}

export function excelFuelLitersTotal(registrationNumber: ExcelFuelFill['registrationNumber']): number {
  return Math.round(
    EXCEL_FUEL_LOG
      .filter((fill) => fill.registrationNumber === registrationNumber)
      .reduce((sum, fill) => sum + fill.liters, 0) * 100,
  ) / 100;
}

export function alreadyHasOpeningFuel(
  reports: readonly { id: string; vehicleId: string; effectiveAt: string; status: string }[],
  vehicleId: string,
): boolean {
  return reports.some((report) => (
    report.id === NLL182_OPENING_FUEL_REPORT_ID
    || (report.vehicleId === vehicleId && report.status === 'approved' && report.effectiveAt === NLL182_OPENING_FUEL_EFFECTIVE_AT)
  ));
}

export function alreadyHasExcelFuelEntry(
  entries: readonly { id: string; vehicleId: string; receiptNumber: string | null }[],
  fill: ExcelFuelFill,
  vehicleId: string,
): boolean {
  const id = excelFuelDocumentId(fill);
  return entries.some((entry) => (
    entry.id === id
    || (entry.vehicleId === vehicleId && entry.receiptNumber === fill.receiptNumber)
  ));
}

export function uncoveredFuelDayKeys(
  entriesByVehicleDate: Map<string, { length: number }>,
  covered: Set<string>,
): string[] {
  return [...entriesByVehicleDate.entries()]
    .filter(([key, entries]) => !covered.has(key) && entries.length > 0)
    .map(([key]) => key)
    .sort();
}

export function parseVehicleDateKey(key: string): { vehicleId: string; date: string } | null {
  const separator = key.lastIndexOf(':');
  if (separator <= 0) return null;
  const date = key.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { vehicleId: key.slice(0, separator), date };
}
