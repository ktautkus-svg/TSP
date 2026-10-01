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
  /**
   * A "Kuro pylimas" row: fuel was filled and the vehicle did not travel.
   * Consumption that day is 0 l, so the running balance continues.
   */
  fuelOnly?: boolean;
};

/** Shown beside a remainder that is above the stated tank size. The number itself stays. */
export const FUEL_OVER_CAPACITY_NOTE = 'Apskaičiuotas kuro likutis viršija nurodytą bako talpą';

/**
 * A synthetic fill row has no odometer on purpose. That is 0 km of travel,
 * so the fuel ledger keeps going. A normal day with a missing odometer is
 * not this case — its consumption is still unknown.
 */
export function fuelFillContinuesLedger(day: {
  startAddress: string;
  endAddress: string;
  distanceKm: number | null;
}): boolean {
  return day.startAddress === 'Kuro pylimas' && day.endAddress === 'Kuro pylimas' && day.distanceKm === null;
}

/** True only when a calculated remainder is strictly above the stated tank. Equality is inside the tank. */
export function fuelRemainderExceedsTank(liters: number | null, tankCapacityLiters: number | null): boolean {
  if (liters === null || tankCapacityLiters === null) return false;
  if (!Number.isFinite(liters) || !Number.isFinite(tankCapacityLiters) || tankCapacityLiters <= 0) return false;
  return liters > tankCapacityLiters;
}

/** First calculated day-start remainder in chronological order. */
export function openingFuelLiters(values: readonly (number | null)[]): number | null {
  return values.find((value) => value !== null) ?? null;
}

/**
 * Last calculated day-end remainder in chronological order.
 * A later unknown day is skipped; an over-capacity number is kept.
 */
export function closingFuelLiters(values: readonly (number | null)[]): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null) return value;
  }
  return null;
}

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
 * A normal day without odometer readings or without a norm breaks the chain:
 * its consumption is unknowable, so every later day stays unknown too until a
 * new opening balance is entered. That is on purpose — guessing one day's usage
 * would silently corrupt the rest of the month.
 *
 * A "Kuro pylimas" row is the exception. It has no kilometres because the
 * vehicle did not travel, so consumption is 0 l and the balance carries on.
 * The result is never clipped to the tank: a remainder above the stated
 * capacity stays as the calculated number.
 */
export function buildFuelLedger(
  days: FuelLedgerInputDay[],
  openingLiters: number | null,
): FuelLedgerDay[] {
  let carried = openingLiters;
  return days.map((day) => {
    const startLiters = carried;
    const consumedLiters = day.fuelOnly
      ? 0
      : day.distanceKm === null || day.fuelNormLPer100Km === null
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
  if (day.fuelOnly) return startLiters === null ? 'no_opening' : null;
  if (day.distanceKm === null) return 'no_odometer';
  if (day.fuelNormLPer100Km === null) return 'no_norm';
  if (startLiters === null) return 'no_opening';
  return null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export { extraDistanceKmOf, vehicleDayFuelDistanceKm } from '@/domain/excel-fuel-log';
