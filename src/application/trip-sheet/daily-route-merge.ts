import { lithuanianDateKey } from '@/domain/lithuanian-time';

export type DailyMergeSheet = {
  routeNumbers: string[];
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  extraDistanceKm?: number | null;
  /**
   * Kilometres this assignment recorded before a vehicle-day odometer was
   * copied onto every sheet that shares the date. When set, it — not the
   * copied readings — decides whether the sheet's route numbers belong on
   * the day. Absent when the sheet still carries its own readings.
   */
  ownDistanceKm?: number | null;
};

/**
 * Movement this sheet recorded on its own. Odometer delta wins, then the
 * recorded actual distance, then the planned figure. A zero result is a
 * leftover or a day the vehicle did not move.
 */
export function sheetMovementKm(
  sheet: Pick<DailyMergeSheet, 'startOdometer' | 'endOdometer' | 'actualDistanceKm' | 'plannedDistanceKm'>,
): number {
  const odometerKm = sheet.startOdometer !== null && sheet.endOdometer !== null && sheet.endOdometer >= sheet.startOdometer
    ? sheet.endOdometer - sheet.startOdometer
    : null;
  return odometerKm ?? sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0;
}

/**
 * A vehicle-day can carry more than one trip sheet — the day actually driven
 * plus a leftover/unassigned sheet with no movement of its own (for example a
 * route really completed on a different calendar day but still stamped with
 * this date). Only sheets that actually moved the vehicle contribute their
 * route numbers to the day's label; otherwise a stray 0 km sheet's routes get
 * concatenated onto a day the driver never drove them on. When nothing that
 * day shows any movement (e.g. a rest day), fall back to every sheet so the
 * label is not silently blanked.
 */
export function dailyRouteNumbers(daySheets: DailyMergeSheet[]): string[] {
  const driven = daySheets.filter(sheetHasDistance);
  const source = driven.length > 0 ? driven : daySheets;
  return [...new Set(source.flatMap((sheet) => sheet.routeNumbers))];
}

function sheetHasDistance(sheet: DailyMergeSheet): boolean {
  // applyDayReading copies one vehicle-day odometer onto every sheet for that
  // date, so the visible start/end can no longer tell a driven route from a
  // leftover. ownDistanceKm is the assignment's movement from before that copy.
  const distanceKm = typeof sheet.ownDistanceKm === 'number' ? sheet.ownDistanceKm : sheetMovementKm(sheet);
  return distanceKm > 0 || (sheet.extraDistanceKm ?? 0) > 0;
}

export type DailyMergeFuelEntry = {
  id: string;
  filledAt: string;
  liters?: number;
  receiptNumber?: string | null;
  odometer?: number | null;
};

/**
 * Fuel added for a calendar day is the set of distinct fills whose filled-at
 * instant falls on that Lithuania calendar date — never every fill attached
 * to every trip sheet that merely shares the date field, which double-counts
 * a fill actually made on a different day but recorded against a leftover
 * sheet stamped with this one (and would double-count the same fill twice if
 * it were somehow attached to two merged sheets).
 */
export function dailyFuelEntries<T extends DailyMergeFuelEntry>(entries: T[], date: string): T[] {
  const seen = new Set<string>();
  const matched: T[] = [];
  for (const entry of entries) {
    const key = entry.id || `${entry.filledAt}|${entry.liters ?? ''}|${entry.receiptNumber ?? ''}|${entry.odometer ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // No timezone-naive fallback here on purpose: a raw ISO slice would
    // silently reintroduce the same misattribution bug near local midnight.
    // An unparseable filledAt has no Lithuanian calendar day, so it is
    // excluded rather than guessed.
    const localDate = lithuanianDateKey(entry.filledAt);
    if (localDate === date) matched.push(entry);
  }
  return matched.sort((left, right) => left.filledAt.localeCompare(right.filledAt));
}
