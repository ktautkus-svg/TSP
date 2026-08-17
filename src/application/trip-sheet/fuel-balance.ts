export function calculateTripFuelEnd(startLiters: number | null, addedLiters: number, consumedLiters: number | null): number | null {
  return startLiters === null || consumedLiters === null ? null : Math.max(0, startLiters + addedLiters - consumedLiters);
}

export type FuelLedgerInputDay = {
  date: string;
  /** Odometer difference for the day; null when the readings are not in yet. */
  distanceKm: number | null;
  /** Litres per 100 km for the vehicle driven that day. */
  fuelNormLPer100Km: number | null;
  /** Everything filled that day, in litres. */
  addedLiters: number;
};

export type FuelLedgerDay = FuelLedgerInputDay & {
  startLiters: number | null;
  consumedLiters: number | null;
  endLiters: number | null;
  /**
   * Why the balance is unknown, so the screen can say which entry is missing
   * instead of showing a bare dash:
   *  - 'no_opening'  – the period has no starting balance yet
   *  - 'no_odometer' – that day's odometer readings are missing
   *  - 'no_norm'     – the vehicle has no fuel norm set
   */
  missing: 'no_opening' | 'no_odometer' | 'no_norm' | null;
};

/**
 * Walks a month day by day the way the paper trip sheet does:
 *
 *   day's consumption = km x norm / 100
 *   day's closing     = day's opening + filled - consumed
 *   next day's opening = this day's closing
 *
 * The opening balance of the first day is the figure read off the tank at the
 * start of the period (a full tank, say 110 l).
 *
 * The closing balance is deliberately NOT clamped at zero. A negative number
 * means the books do not add up — usually a fill that was never entered, a
 * wrong odometer reading, or a norm that is too high — and hiding that behind a
 * 0 would leave the driver trusting a figure that is already wrong.
 *
 * A day without odometer readings or without a norm breaks the chain: its
 * consumption is unknowable, so every later day stays unknown too until a new
 * opening balance is entered. That is on purpose — guessing one day's usage
 * would silently corrupt the rest of the month.
 */
export function buildFuelLedger(
  days: FuelLedgerInputDay[],
  openingLiters: number | null,
): FuelLedgerDay[] {
  let carried = openingLiters;
  return days.map((day) => {
    const startLiters = carried;
    const consumedLiters = day.distanceKm === null || day.fuelNormLPer100Km === null
      ? null
      : round((day.distanceKm * day.fuelNormLPer100Km) / 100);
    const endLiters = startLiters === null || consumedLiters === null
      ? null
      : round(startLiters + day.addedLiters - consumedLiters);
    carried = endLiters;
    return {
      ...day,
      startLiters,
      consumedLiters,
      endLiters,
      missing: missingReason(startLiters, day),
    };
  });
}

function missingReason(startLiters: number | null, day: FuelLedgerInputDay): FuelLedgerDay['missing'] {
  if (day.distanceKm === null) return 'no_odometer';
  if (day.fuelNormLPer100Km === null) return 'no_norm';
  if (startLiters === null) return 'no_opening';
  return null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
