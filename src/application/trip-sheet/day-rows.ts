import { vehicleDayFuelDistanceKm } from '@/domain/excel-fuel-log';
import { vehicleDayAssignmentId } from '@/domain/nll182-odometer-log';
import { fuelFillContinuesLedger } from '@/application/trip-sheet/fuel-balance';

/**
 * Calendar day stored on the fill. The trip-sheet editor writes the chosen
 * day as noon UTC, and imported fills use the same ISO date prefix. The
 * assignment id must not replace this: a vehicle-day id carries the trip the
 * fill was saved against, which is often the nearest driving day.
 */
export function fuelFillCalendarDate(filledAt: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(filledAt.trim());
  return match?.[1] ?? null;
}

export function indexFuelByVehicleFillDate<T extends { filledAt: string; vehicleId: string }>(
  entries: readonly T[],
): Map<string, T[]> {
  const indexed = new Map<string, T[]>();
  for (const entry of entries) {
    const date = fuelFillCalendarDate(entry.filledAt);
    if (!date || !entry.vehicleId) continue;
    const key = `${entry.vehicleId}:${date}`;
    indexed.set(key, [...(indexed.get(key) ?? []), entry]);
  }
  return indexed;
}

/** Fills whose own calendar date is `date`, one row per entry id. */
export function fuelEntriesOnDate<T extends { id: string; filledAt: string }>(
  entries: readonly T[],
  date: string,
): T[] {
  const seen = new Set<string>();
  const matched: T[] = [];
  for (const entry of entries) {
    if (fuelFillCalendarDate(entry.filledAt) !== date || seen.has(entry.id)) continue;
    seen.add(entry.id);
    matched.push(entry);
  }
  return matched.sort((left, right) => left.filledAt.localeCompare(right.filledAt));
}

export type TripDayFuelEntry = {
  id: string;
  filledAt: string;
  liters: number;
  odometer?: number | null;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  station?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
};

export type TripDaySheet = {
  id: string;
  assignmentId: string;
  date: string;
  driverId: string;
  driverName: string;
  routeNumbers: readonly string[];
  startAddress: string;
  endAddress: string;
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  extraDistanceKm?: number | null;
  fuelNormLitersPer100Km: number | null;
  compensation: { totalNetEur: number; preliminary: boolean } | null;
  vehicle: { id: string } | null;
  source: 'server' | 'local';
  fuelEntries: readonly TripDayFuelEntry[];
};

export type AssembledTripDay = {
  date: string;
  driverId: string;
  driverName: string;
  routeNumbers: string[];
  startAddress: string;
  endAddress: string;
  startOdometer: number | null;
  endOdometer: number | null;
  distanceKm: number | null;
  distanceSource: 'odometer' | 'planned' | null;
  fuelNorm: number | null;
  fuelAdded: number;
  compensationEur: number | null;
  compensationPreliminary: boolean;
  assignmentId: string;
  tripSheetId: string;
  vehicleId: string | null;
  source: 'server' | 'local';
  fuelEntries: TripDayFuelEntry[];
};

/**
 * One row per calendar date that has a trip, a day reading, or a fuel fill.
 * A fill stays on `filledAt`, even when the sheet it was saved under is a
 * different driving day.
 */
export function assembleDailyTripRows(sheets: readonly TripDaySheet[]): AssembledTripDay[] {
  const sheetsByDate = new Map<string, TripDaySheet[]>();
  const fuelByDate = new Map<string, { entry: TripDayFuelEntry; sheet: TripDaySheet }[]>();
  for (const sheet of sheets) {
    sheetsByDate.set(sheet.date, [...(sheetsByDate.get(sheet.date) ?? []), sheet]);
    for (const entry of sheet.fuelEntries) {
      const date = fuelFillCalendarDate(entry.filledAt);
      if (!date) continue;
      fuelByDate.set(date, [...(fuelByDate.get(date) ?? []), { entry, sheet }]);
    }
  }
  return [...new Set([...sheetsByDate.keys(), ...fuelByDate.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((date) => {
      const carried = fuelByDate.get(date) ?? [];
      return assembleDate(date, sheetsByDate.get(date) ?? [], carried.map((item) => item.entry), carried[0]?.sheet ?? null);
    });
}

function assembleDate(
  date: string,
  daySheets: readonly TripDaySheet[],
  datedFuel: readonly TripDayFuelEntry[],
  carrier: TripDaySheet | null,
): AssembledTripDay {
  const fuelEntries = dedupeFuelEntries(datedFuel);
  if (daySheets.length === 0) return fuelOnlyDay(date, fuelEntries, carrier);
  const startOdometer = minimum(daySheets.map((sheet) => sheet.startOdometer));
  const endOdometer = maximum(daySheets.map((sheet) => sheet.endOdometer));
  // The odometer is the truth once both readings are in; the planned figure
  // only stands in until the driver closes the day.
  const odometerKm = startOdometer !== null && endOdometer !== null && endOdometer >= startOdometer
    ? endOdometer - startOdometer
    : null;
  const plannedValues = daySheets
    .map((sheet) => sheet.actualDistanceKm ?? sheet.plannedDistanceKm)
    .filter((value): value is number => value !== null);
  const plannedKm = plannedValues.length > 0 ? plannedValues.reduce((sum, value) => sum + value, 0) : null;
  const extraKm = daySheets.reduce((sum, sheet) => sum + (sheet.extraDistanceKm ?? 0), 0);
  const distanceKm = vehicleDayFuelDistanceKm(odometerKm ?? plannedKm, extraKm);
  const fuelNorm = daySheets.find((sheet) => sheet.fuelNormLitersPer100Km !== null)?.fuelNormLitersPer100Km ?? null;
  const compensation = daySheets.find((sheet) => sheet.compensation)?.compensation ?? null;
  const targetSheet = daySheets[daySheets.length - 1]!;
  return {
    date,
    driverId: targetSheet.driverId,
    driverName: targetSheet.driverName,
    routeNumbers: [...new Set(daySheets.flatMap((sheet) => sheet.routeNumbers))],
    startAddress: daySheets[0]?.startAddress ?? 'Pradžia nenurodyta',
    endAddress: daySheets[daySheets.length - 1]?.endAddress ?? 'Pabaiga nenurodyta',
    startOdometer,
    endOdometer,
    distanceKm,
    distanceSource: odometerKm !== null ? 'odometer' : plannedKm !== null ? 'planned' : null,
    fuelNorm,
    fuelAdded: roundLiters(fuelEntries.reduce((sum, entry) => sum + entry.liters, 0)),
    compensationEur: compensation?.totalNetEur ?? null,
    compensationPreliminary: compensation?.preliminary ?? true,
    assignmentId: targetSheet.assignmentId,
    tripSheetId: targetSheet.id,
    vehicleId: targetSheet.vehicle?.id ?? null,
    source: targetSheet.source,
    fuelEntries,
  };
}

function fuelOnlyDay(date: string, fuelEntries: TripDayFuelEntry[], carrier: TripDaySheet | null): AssembledTripDay {
  const vehicleId = carrier?.vehicle?.id ?? null;
  return {
    date,
    driverId: carrier?.driverId ?? 'unassigned',
    driverName: carrier?.driverName ?? 'Nepriskirtas',
    routeNumbers: [],
    startAddress: 'Kuro pylimas',
    endAddress: 'Kuro pylimas',
    startOdometer: null,
    endOdometer: null,
    distanceKm: null,
    distanceSource: null,
    fuelNorm: carrier?.fuelNormLitersPer100Km ?? null,
    fuelAdded: roundLiters(fuelEntries.reduce((sum, entry) => sum + entry.liters, 0)),
    compensationEur: null,
    compensationPreliminary: true,
    assignmentId: vehicleId ? vehicleDayAssignmentId(vehicleId, date) : carrier?.assignmentId ?? `fuel-day-${date}`,
    tripSheetId: vehicleId ? `trip-sheet-${vehicleDayAssignmentId(vehicleId, date)}` : `fuel-day-${date}`,
    vehicleId,
    source: carrier?.source ?? 'server',
    fuelEntries,
  };
}

/** Shown kilometres. A fill with no trip is 0 km of travel; the ledger still sees a null distance so consumption stays 0 without a norm. */
export function presentedDistanceKm(day: {
  startAddress: string;
  endAddress: string;
  distanceKm: number | null;
}): number | null {
  return fuelFillContinuesLedger(day) ? 0 : day.distanceKm;
}

export function tripSheetRouteLabel(day: {
  routeNumbers: readonly string[];
  startAddress: string;
  endAddress: string;
}): string {
  if (day.routeNumbers.length > 0) return day.routeNumbers.join(' · ');
  if (day.startAddress === 'Kuro pylimas' && day.endAddress === 'Kuro pylimas') return '—';
  if (day.startAddress === day.endAddress) return day.startAddress;
  return `${day.startAddress} - ${day.endAddress}`;
}

/**
 * Collapse fills that appear under more than one sheet on the same date to a single entry.
 * Leftover assignments can staple the same fill onto two sheets — 08-27 NLL once showed 166.8 l twice.
 */
function dedupeFuelEntries(entries: readonly TripDayFuelEntry[]): TripDayFuelEntry[] {
  const seen = new Set<string>();
  const result: TripDayFuelEntry[] = [];
  for (const entry of entries) {
    const key = entry.id || `${entry.filledAt}|${entry.liters}|${entry.receiptNumber ?? ''}|${entry.odometer ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result.sort((left, right) => left.filledAt.localeCompare(right.filledAt));
}

function minimum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.min(...present) : null;
}

function maximum(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

function roundLiters(value: number): number {
  return Math.round(value * 100) / 100;
}
