import { fuelPriceForYearMonth, type RoutePriceSettings } from '@/application/routes/route-price';

/**
 * Litre price valid on a date, taken from the saved route-pricing settings
 * ("Kuro ir atlygio parametrai", one price per calendar year and month).
 *
 * Returns null when the settings were not loaded or that year-month has no
 * price. Callers must then show the money as unknown ("—"); they must never
 * borrow another year's price, use a built-in tariff or show litres as euros.
 */
export function fuelPriceForDate(settings: RoutePriceSettings | null, date: string): number | null {
  if (!settings) return null;
  return fuelPriceForYearMonth(settings, date);
}

/** Calendar day of a fuel fill (filledAt is stored as an ISO timestamp). */
export function fuelFillDate(filledAt: string | null | undefined, fallbackDate: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec((filledAt ?? '').trim());
  return match?.[1] ?? fallbackDate;
}

export type FuelMoney = {
  liters: number;
  pricePerLiter: number | null;
  /** null when no valid litre price exists for the date. */
  costEur: number | null;
};

/** Money for a known number of litres: litres × the price valid on `date`. */
export function fuelMoneyForLiters(liters: number, date: string, settings: RoutePriceSettings | null): FuelMoney {
  const safeLiters = Number.isFinite(liters) && liters > 0 ? liters : 0;
  const pricePerLiter = fuelPriceForDate(settings, date);
  return {
    liters: round2(safeLiters),
    pricePerLiter,
    costEur: pricePerLiter === null ? null : round2(safeLiters * pricePerLiter),
  };
}

/** Trip fuel by the vehicle norm: km × norm / 100 litres, then × the valid litre price. */
export function tripFuelMoney(input: {
  distanceKm: number | null;
  fuelNormLitersPer100Km: number | null;
  date: string;
  settings: RoutePriceSettings | null;
}): FuelMoney | null {
  const { distanceKm, fuelNormLitersPer100Km } = input;
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  if (fuelNormLitersPer100Km === null || !Number.isFinite(fuelNormLitersPer100Km) || fuelNormLitersPer100Km <= 0) return null;
  return fuelMoneyForLiters(distanceKm * fuelNormLitersPer100Km / 100, input.date, input.settings);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
