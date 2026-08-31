import type { ServerTripSheet } from '@/infrastructure/auth/employee-session';

export type WageDayRow = {
  key: string;
  date: string;
  driverId: string;
  driverName: string;
  wageEur: number;
  preliminary: boolean;
  sheets: ServerTripSheet[];
};

/**
 * Compensation is calculated once per driver and workday, then attached by
 * the server to every trip sheet from that day. The report must therefore
 * collapse those sheets before rendering or summing the amount; otherwise a
 * daily amount looks like a route price and appears repeatedly beside
 * unrelated per-route kilometres.
 */
export function aggregateWageDays(sheets: readonly ServerTripSheet[]): WageDayRow[] {
  const days = new Map<string, WageDayRow>();
  for (const sheet of sheets) {
    const key = `${sheet.driverId}:${sheet.date}`;
    const current = days.get(key);
    if (current) {
      current.sheets.push(sheet);
      current.preliminary = current.preliminary || Boolean(sheet.compensation?.preliminary);
      continue;
    }
    days.set(key, {
      key,
      date: sheet.date,
      driverId: sheet.driverId,
      driverName: sheet.driverName,
      wageEur: sheet.compensation?.totalNetEur ?? 0,
      preliminary: Boolean(sheet.compensation?.preliminary),
      sheets: [sheet],
    });
  }
  return [...days.values()].sort((left, right) =>
    right.date.localeCompare(left.date) || left.driverName.localeCompare(right.driverName, 'lt'));
}
