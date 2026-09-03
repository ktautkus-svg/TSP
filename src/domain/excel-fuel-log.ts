import { NLL182_ODOMETER_LOG } from './nll182-odometer-log';

/**
 * August 2026 Circle K fills from the production receipt table (authoritative).
 * Station addresses are not retained here — do not invent them.
 *
 * localTime rules:
 * - When a receipt number already existed in the prior catalog, reuse that Lithuania local time.
 * - New receipts (no prior match) use 12:00 Lithuania; August is EEST (UTC+3).
 */
export type ExcelFuelFill = {
  registrationNumber: 'MET630' | 'NLL182';
  localDate: string;
  localTime: string;
  receiptNumber: string;
  liters: number;
  /** Stable Firestore id when Circle K trn is missing; otherwise derived. */
  documentId?: string;
};

/** NLL182 tank opening — first operational day with fills is Aug 13. */
export const NLL182_OPENING_FUEL_LITERS = 30;
export const NLL182_OPENING_FUEL_EFFECTIVE_AT = '2026-08-13';
export const NLL182_OPENING_FUEL_REPORT_ID = 'open-NLL182-20260813';
export const NLL182_OPENING_FUEL_NOTE = 'Rugpjūčio 13 d. bako likutis pagal administratoriaus nurodymą.';

/** MET630 tank opening on Aug 1. */
export const MET630_OPENING_FUEL_LITERS = 110;
export const MET630_OPENING_FUEL_EFFECTIVE_AT = '2026-08-01';
export const MET630_OPENING_FUEL_REPORT_ID = 'open-MET630-20260801';
export const MET630_OPENING_FUEL_NOTE = 'Rugpjūčio 1 d. bako likutis pagal administratoriaus nurodymą.';

/** Firestore tsp_settings doc — one-shot production migration flag (full August reset). */
export const FUEL_AUGUST_2026_MIGRATION_ID = 'fuel-august-2026-v2';

/**
 * Follow-up one-shot flag: remove two erroneous MET630 fills and correct
 * MET630 2026-08-03 day kilometres to 617. Runs after v2 on boot.
 */
export const FUEL_AUGUST_2026_V3_MIGRATION_ID = 'fuel-august-2026-v3';

/**
 * Follow-up one-shot flag after v3: add MET630 2026-08-31 fill 08/52 (95.07 L)
 * and record 615.50 km of non-assigned remainder so fuel uses 915.50 while
 * Karolis’s completed assignment stays 300 km. Runs after v3 on boot.
 */
export const FUEL_AUGUST_2026_V4_MIGRATION_ID = 'fuel-august-2026-v4';

export const FUEL_AUGUST_2026_NORMS = {
  MET630: 12,
  NLL182: 13.9,
} as const;

/** Authoritative MET630 day distance for 2026-08-03 (prior faulty reading ~217). */
export const MET630_AUGUST_03_2026_DATE = '2026-08-03';
export const MET630_AUGUST_03_2026_DISTANCE_KM = 617;

/**
 * MET630 2026-08-31: vehicle drove 915.50 km. Karolis’s completed assignment
 * (R54;R11) is 300 km for wages. The 615.50 remainder is other-driver /
 * unassigned km used only in fuel consumption — never a fake second user.
 */
export const MET630_AUGUST_31_2026_DATE = '2026-08-31';
export const MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM = 915.5;
export const MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM = 300;
export const MET630_AUGUST_31_2026_EXTRA_DISTANCE_KM = 615.5;
export const MET630_AUGUST_31_2026_ASSIGNMENT_ID = 'a6f3ea27-0e1b-474f-ba45-f77266ea1ce4';
export const MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID = 'xlsx-manual-08-52';
export const MET630_AUGUST_31_2026_MANUAL_FILL_ALT_DOCUMENT_ID = 'manual-08-52';
export const MET630_AUGUST_31_2026_MANUAL_FILL: ExcelFuelFill = {
  registrationNumber: 'MET630',
  localDate: MET630_AUGUST_31_2026_DATE,
  localTime: '12:00',
  receiptNumber: '08/52',
  liters: 95.07,
  documentId: MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID,
};

/**
 * MET630 fills removed in v3 (Circle K transaction id + receipt).
 * Matched in live store by xlsx document id, receipt number, or transaction id.
 */
export const FUEL_AUGUST_2026_V3_REMOVED_FILLS = [
  {
    registrationNumber: 'MET630' as const,
    localDate: '2026-08-09',
    receiptNumber: '242/426',
    liters: 46.01,
    transactionId: '42655388',
  },
  {
    registrationNumber: 'MET630' as const,
    localDate: '2026-08-29',
    receiptNumber: '89/1222',
    liters: 30.00,
    transactionId: '42959044',
  },
] as const;

/** Previous NLL opener id/date that must be removed when the Aug 13 opener replaces it. */
export const STALE_AUGUST_OPENING_REPORT_IDS = [
  'open-NLL182-20260801',
] as const;

export const EXCEL_FUEL_LOG: readonly ExcelFuelFill[] = [
  // MET630 — times reused from prior catalog when receipt matched; else 12:00.
  // v3 removed 242/426 (trn 42655388) and 89/1222 (trn 42959044).
  { registrationNumber: 'MET630', localDate: '2026-08-04', localTime: '09:01', receiptNumber: '135/1193', liters: 104.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-05', localTime: '18:14', receiptNumber: '230/419', liters: 107.98 },
  { registrationNumber: 'MET630', localDate: '2026-08-09', localTime: '23:23', receiptNumber: '476/1159', liters: 10.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-09', localTime: '23:38', receiptNumber: '325/1158', liters: 95.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-11', localTime: '09:34', receiptNumber: '148/1145', liters: 100.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-12', localTime: '13:52', receiptNumber: '277/1160', liters: 102.17 },
  { registrationNumber: 'MET630', localDate: '2026-08-13', localTime: '23:42', receiptNumber: '669/1206', liters: 30.07 },
  { registrationNumber: 'MET630', localDate: '2026-08-17', localTime: '00:45', receiptNumber: '333/1165', liters: 103.31 },
  { registrationNumber: 'MET630', localDate: '2026-08-19', localTime: '10:55', receiptNumber: '212/1167', liters: 78.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-21', localTime: '04:41', receiptNumber: '1/265', liters: 90.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-26', localTime: '12:00', receiptNumber: '362/1165', liters: 90.00 },
  { registrationNumber: 'MET630', localDate: '2026-08-27', localTime: '12:00', receiptNumber: '271/1215', liters: 86.10 },
  { registrationNumber: 'MET630', localDate: '2026-08-29', localTime: '12:00', receiptNumber: '834/1206', liters: 9.50 },
  { registrationNumber: 'MET630', localDate: '2026-08-30', localTime: '12:00', receiptNumber: '151/563', liters: 102.00 },
  MET630_AUGUST_31_2026_MANUAL_FILL,
  // NLL182 — no fills before 2026-08-13.
  { registrationNumber: 'NLL182', localDate: '2026-08-13', localTime: '04:13', receiptNumber: '47/1188', liters: 59.99 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '04:30', receiptNumber: '5/1173', liters: 60.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '13:21', receiptNumber: '92/1160', liters: 9.99 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '19:35', receiptNumber: '421/1191', liters: 4.85 },
  { registrationNumber: 'NLL182', localDate: '2026-08-16', localTime: '22:17', receiptNumber: '466/1166', liters: 83.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-17', localTime: '17:46', receiptNumber: '449/2177', liters: 73.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-20', localTime: '07:49', receiptNumber: '74/1154', liters: 70.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-21', localTime: '02:20', receiptNumber: '13/1214', liters: 45.60 },
  { registrationNumber: 'NLL182', localDate: '2026-08-23', localTime: '12:00', receiptNumber: '19/571', liters: 70.52 },
  { registrationNumber: 'NLL182', localDate: '2026-08-23', localTime: '12:00', receiptNumber: '227/2189', liters: 86.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-25', localTime: '12:00', receiptNumber: '131/1213', liters: 30.00 },
  { registrationNumber: 'NLL182', localDate: '2026-08-26', localTime: '12:00', receiptNumber: '29/1184', liters: 76.85 },
  { registrationNumber: 'NLL182', localDate: '2026-08-26', localTime: '12:00', receiptNumber: '405/789', liters: 83.61 },
  { registrationNumber: 'NLL182', localDate: '2026-08-27', localTime: '12:00', receiptNumber: '205/1218', liters: 14.47 },
  { registrationNumber: 'NLL182', localDate: '2026-08-27', localTime: '12:00', receiptNumber: '6/1126', liters: 68.91 },
];

const FIRESTORE_ID = /^[a-zA-Z0-9_-]{8,80}$/;
const AUGUST_2026_PLATES = new Set(['MET630', 'NLL182']);

/** Circle K receipt numbers use `/`; Firestore ids cannot. */
export function excelFuelDocumentId(fill: Pick<ExcelFuelFill, 'registrationNumber' | 'localDate' | 'receiptNumber' | 'documentId'>): string {
  if (fill.documentId) {
    if (!FIRESTORE_ID.test(fill.documentId)) {
      throw new Error(`Excel fuel document id is not a valid Firestore id: ${fill.documentId}`);
    }
    return fill.documentId;
  }
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
  reportId: string = NLL182_OPENING_FUEL_REPORT_ID,
  effectiveAt: string = NLL182_OPENING_FUEL_EFFECTIVE_AT,
): boolean {
  return reports.some((report) => (
    report.id === reportId
    || (report.vehicleId === vehicleId && report.status === 'approved' && report.effectiveAt === effectiveAt)
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

/**
 * August 2026 MET630/NLL182 fuel rows that the production reset must remove
 * before inserting the authoritative receipt table.
 */
export function isStaleAugust2026FuelEntry(entry: {
  id: string;
  registrationNumber?: string | null;
  vehicleId?: string | null;
  filledAt?: string | null;
}, vehicleIds: ReadonlySet<string>): boolean {
  const plate = String(entry.registrationNumber ?? '').trim().toUpperCase();
  const matchesPlate = AUGUST_2026_PLATES.has(plate)
    || (typeof entry.vehicleId === 'string' && vehicleIds.has(entry.vehicleId));
  if (!matchesPlate) return false;
  const filledAt = String(entry.filledAt ?? '');
  const filledDate = filledAt.slice(0, 10);
  if (/^2026-08-\d{2}$/.test(filledDate)) return true;
  // xlsx-* ids encode the plate/date even when filledAt was wrong.
  if (entry.id.startsWith('xlsx-') && /xlsx-(MET630|NLL182)-202608/.test(entry.id)) return true;
  return false;
}

export function isStaleAugustOpeningReport(report: {
  id: string;
  vehicleId: string;
  registrationNumber?: string | null;
  effectiveAt: string;
  kind?: string | null;
}, vehicleIds: ReadonlySet<string>): boolean {
  if (STALE_AUGUST_OPENING_REPORT_IDS.includes(report.id as typeof STALE_AUGUST_OPENING_REPORT_IDS[number])) {
    return true;
  }
  const plate = String(report.registrationNumber ?? '').trim().toUpperCase();
  const matchesVehicle = vehicleIds.has(report.vehicleId) || AUGUST_2026_PLATES.has(plate);
  if (!matchesVehicle) return false;
  if (report.id === MET630_OPENING_FUEL_REPORT_ID || report.id === NLL182_OPENING_FUEL_REPORT_ID) {
    return false;
  }
  // Replace other August openings for these two plates so the ledger anchors once.
  return report.kind === 'admin_correction' && /^2026-08-\d{2}$/.test(report.effectiveAt);
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

/** Live fuel rows that v3 must delete (trn id preferred, then xlsx id / receipt). */
export function isFuelAugust2026V3RemovedEntry(entry: {
  id: string;
  registrationNumber?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
  filledAt?: string | null;
}): boolean {
  for (const target of FUEL_AUGUST_2026_V3_REMOVED_FILLS) {
    const haystack = `${entry.id}\n${entry.notes ?? ''}\n${entry.receiptNumber ?? ''}`;
    if (haystack.includes(target.transactionId)) return true;

    const expectedId = excelFuelDocumentId({
      registrationNumber: target.registrationNumber,
      localDate: target.localDate,
      receiptNumber: target.receiptNumber,
    });
    if (entry.id === expectedId) return true;

    const plate = String(entry.registrationNumber ?? '').trim().toUpperCase();
    if (plate !== target.registrationNumber) continue;
    if (entry.receiptNumber === target.receiptNumber) return true;
  }
  return false;
}

/**
 * Correct MET630 2026-08-03 day kilometres to 617 while preserving an absolute
 * odometer start when one already exists (or is supplied from a trip sheet).
 */
export function correctedMet630August03Odometers(existing: {
  startOdometer: number | null;
  endOdometer?: number | null;
} | null): { startOdometer: number; endOdometer: number; distanceKm: number } {
  const distanceKm = MET630_AUGUST_03_2026_DISTANCE_KM;
  const start = existing?.startOdometer;
  if (typeof start === 'number' && Number.isFinite(start)) {
    const endOdometer = Math.round((start + distanceKm) * 10) / 10;
    return { startOdometer: start, endOdometer, distanceKm };
  }
  // Day-distance only — no absolute chain available.
  return { startOdometer: 0, endOdometer: distanceKm, distanceKm };
}

const MET630_AUGUST_31_MANUAL_FILL_IDS = new Set([
  MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID,
  MET630_AUGUST_31_2026_MANUAL_FILL_ALT_DOCUMENT_ID,
  `xlsx-MET630-20260831-08-52`,
]);

/** Live fuel rows that v4 must delete before upserting čekis 08/52. */
export function isFuelAugust2026V4ManualFillEntry(entry: {
  id: string;
  registrationNumber?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
}): boolean {
  if (MET630_AUGUST_31_MANUAL_FILL_IDS.has(entry.id)) return true;
  const haystack = `${entry.id}\n${entry.notes ?? ''}\n${entry.receiptNumber ?? ''}`;
  if (haystack.includes(MET630_AUGUST_31_2026_MANUAL_FILL_DOCUMENT_ID)) return true;
  if (haystack.includes(MET630_AUGUST_31_2026_MANUAL_FILL_ALT_DOCUMENT_ID)) return true;

  const plate = String(entry.registrationNumber ?? '').trim().toUpperCase();
  if (plate !== 'MET630') return false;
  return entry.receiptNumber === MET630_AUGUST_31_2026_MANUAL_FILL.receiptNumber;
}

/**
 * Assigned (driver-wage) odometers for MET630 2026-08-31. Extra 615.50 km is
 * stored separately so applyDayReading cannot overlay 915.50 onto Karolis.
 */
export function met630August31AssignedOdometers(existing: {
  startOdometer: number | null;
  endOdometer?: number | null;
} | null): {
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
  extraDistanceKm: number;
} {
  const distanceKm = MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM;
  const extraDistanceKm = MET630_AUGUST_31_2026_EXTRA_DISTANCE_KM;
  const start = existing?.startOdometer;
  if (typeof start === 'number' && Number.isFinite(start)) {
    const endOdometer = Math.round((start + distanceKm) * 10) / 10;
    return { startOdometer: start, endOdometer, distanceKm, extraDistanceKm };
  }
  return { startOdometer: 0, endOdometer: distanceKm, distanceKm, extraDistanceKm };
}

export function extraDistanceKmOf(value: { extraDistanceKm?: number | null } | null | undefined): number {
  const extra = value?.extraDistanceKm;
  return typeof extra === 'number' && Number.isFinite(extra) && extra > 0 ? extra : 0;
}

/**
 * Fuel/ledger kilometres: assigned (or odometer) distance plus non-assigned
 * remainder. Wages must keep using assigned distance only.
 */
export function vehicleDayFuelDistanceKm(
  assignedDistanceKm: number | null,
  extraDistanceKm?: number | null,
): number | null {
  const extra = extraDistanceKmOf({ extraDistanceKm });
  if (assignedDistanceKm === null && extra === 0) return null;
  return Math.round(((assignedDistanceKm ?? 0) + extra) * 10) / 10;
}

/** Restore Karolis’s 300 km if a previous overlay wrote the full 915.50 onto the assignment. */
export function shouldRestoreMet630August31AssignedDistance(existing: {
  actualDistanceKm: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
}): { restoreActual: boolean; restoreOdometerSpan: boolean } {
  const actual = existing.actualDistanceKm;
  const restoreActual = actual !== MET630_AUGUST_31_2026_ASSIGNED_DISTANCE_KM;
  const start = existing.startOdometer;
  const end = existing.endOdometer;
  const span = start !== null && end !== null
    ? Math.round((end - start) * 10) / 10
    : null;
  const restoreOdometerSpan = span === MET630_AUGUST_31_2026_VEHICLE_DISTANCE_KM;
  return { restoreActual, restoreOdometerSpan };
}
