import type { EarningsRow } from '@/domain/statistics';

// The slice of ServerTripSheet this transform needs. Vehicle filtering
// happens on the caller's side (against sheet.vehicle.id) before this ever
// sees the list, so only the three fields actually read here are asked for.
export type EarningsSheetInput = {
  driverId: string;
  date: string;
  compensation: { totalNetEur: number } | null;
};

/**
 * Trip sheets into one earnings figure per day.
 *
 * Compensation is computed per driver per day on the server
 * (attachDailyCompensation) and the SAME figure is attached to every sheet
 * that day — a driver with two routes on Monday gets two sheets both carrying
 * Monday's one total. Summing per sheet would double it, so this dedupes by
 * driver+date before summing anything.
 */
export function toEarningsRows(sheets: readonly EarningsSheetInput[]): EarningsRow[] {
  const byKey = new Map<string, EarningsRow>();
  for (const sheet of sheets) {
    if (!sheet.compensation) continue;
    const key = `${sheet.driverId}:${sheet.date}`;
    if (!byKey.has(key)) byKey.set(key, { date: sheet.date, totalNetEur: sheet.compensation.totalNetEur });
  }
  return [...byKey.values()];
}
