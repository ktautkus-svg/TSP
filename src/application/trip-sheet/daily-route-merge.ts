import { lithuanianDateKey } from '@/domain/lithuanian-time';

export type DailyMergeSheet = {
  routeNumbers: string[];
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  extraDistanceKm?: number | null;
};

/**
 * A vehicle-day can carry more than one trip sheet — the day actually driven
 * plus a leftover/unassigned sheet with no odometer movement (for example a
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
  const odometerKm = sheet.startOdometer !== null && sheet.endOdometer !== null && sheet.endOdometer >= sheet.startOdometer
    ? sheet.endOdometer - sheet.startOdometer
    : null;
  const distanceKm = odometerKm ?? sheet.actualDistanceKm ?? sheet.plannedDistanceKm;
  return (distanceKm ?? 0) > 0 || (sheet.extraDistanceKm ?? 0) > 0;
}

export type DailyMergeFuelEntry = { id: string; filledAt: string };

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
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const localDate = lithuanianDateKey(entry.filledAt) ?? entry.filledAt.slice(0, 10);
    if (localDate === date) matched.push(entry);
  }
  return matched.sort((left, right) => left.filledAt.localeCompare(right.filledAt));
}
