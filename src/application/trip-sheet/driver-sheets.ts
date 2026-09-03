/**
 * Splits one vehicle-month into numbered per-driver trip sheets ("kelionės
 * lapas Nr. N").
 *
 * The paper rule Karolis works to: a driver keeps ONE sheet for as long as they
 * are the one using the vehicle. The moment another driver takes the same
 * vehicle out, the first driver's sheet is closed; when that driver sits back
 * down afterwards they open a *new*, higher-numbered sheet. Numbering runs
 * separately per driver inside the same vehicle-month.
 *
 * Consequences the callers rely on:
 *  - Consecutive calendar days of the same driver on the same vehicle are one
 *    sheet, even across a gap of days when the vehicle simply stood still
 *    (no activity at all). An empty day never splits a sheet on its own.
 *  - A day used by a different driver *does* split it, even a 0 km / leftover
 *    assignment day — that day belongs to the other driver, not this one.
 *  - The fuel ledger is still walked across the whole vehicle-month elsewhere;
 *    a run only carries the slice of already-computed days that fall inside it,
 *    so the first day of "Nr. 2" opens on whatever the previous driver left in
 *    the tank, never on a fictitious full tank.
 */

export type VehicleDay<T> = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Stable driver identity (id preferred; fall back to name upstream). */
  driverKey: string;
  /** Human-readable driver name for headings. */
  driverName: string;
  /**
   * Did the vehicle actually work that day? A day with real distance or a real
   * fill is active; a bare 0 km leftover-assignment day is not, and a day the
   * vehicle stood idle is not.
   */
  active: boolean;
  /** Caller payload for the day (the rendered/exported row). */
  row: T;
};

export type DriverSheetRun<T> = {
  driverKey: string;
  driverName: string;
  /** 1-based, per driver, within this vehicle-month. */
  sheetNumber: number;
  startDate: string;
  endDate: string;
  /** The active days that belong to this run, in date order. */
  days: T[];
};

/**
 * @param days every day of ONE vehicle-month, every driver, in any order.
 */
export function splitDriverSheetRuns<T>(days: VehicleDay<T>[]): DriverSheetRun<T>[] {
  const active = days
    .filter((day) => day.active)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));

  const runs: DriverSheetRun<T>[] = [];
  const numberByDriver = new Map<string, number>();
  let current: (DriverSheetRun<T> & { _days: VehicleDay<T>[] }) | null = null;

  for (const day of active) {
    if (current && current.driverKey === day.driverKey) {
      current._days.push(day);
      current.endDate = day.date;
      current.days.push(day.row);
      continue;
    }
    if (current) runs.push(stripInternal(current));
    const nextNumber = (numberByDriver.get(day.driverKey) ?? 0) + 1;
    numberByDriver.set(day.driverKey, nextNumber);
    current = {
      driverKey: day.driverKey,
      driverName: day.driverName,
      sheetNumber: nextNumber,
      startDate: day.date,
      endDate: day.date,
      days: [day.row],
      _days: [day],
    };
  }
  if (current) runs.push(stripInternal(current));
  return runs;
}

function stripInternal<T>(run: DriverSheetRun<T> & { _days: VehicleDay<T>[] }): DriverSheetRun<T> {
  const { _days, ...rest } = run;
  void _days;
  return rest;
}

/** "2026-08-01 – 2026-08-02", or a single date when the run is one day. */
export function driverSheetRunPeriod(run: Pick<DriverSheetRun<unknown>, 'startDate' | 'endDate'>): string {
  return run.startDate === run.endDate ? run.startDate : `${run.startDate} – ${run.endDate}`;
}
