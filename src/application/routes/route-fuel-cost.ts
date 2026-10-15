export type RouteFuelQuote = {
  distanceKm: number | null;
  litersPer100Km: number | null;
  pricePerLiter: number | null;
  consumedLiters: number | null;
};

export type RouteFuelCost = {
  predictedEur: number | null;
  actualEur: number | null;
};

/** Planned kilometres, the vehicle norm and the litre price. Missing inputs stay empty. */
export function predictFuelCostEur(quote: RouteFuelQuote): number | null {
  const distanceKm = nonNegative(quote.distanceKm);
  const litersPer100Km = nonNegative(quote.litersPer100Km);
  const pricePerLiter = nonNegative(quote.pricePerLiter);
  if (distanceKm === null || litersPer100Km === null || pricePerLiter === null) return null;
  return money(distanceKm * litersPer100Km / 100 * pricePerLiter);
}

/** Consumed litres times the litre price. This is not the planned estimate. */
export function actualFuelCostEur(quote: RouteFuelQuote): number | null {
  const consumedLiters = nonNegative(quote.consumedLiters);
  const pricePerLiter = nonNegative(quote.pricePerLiter);
  if (consumedLiters === null || pricePerLiter === null) return null;
  return money(consumedLiters * pricePerLiter);
}

export function routeFuelCost(quote: RouteFuelQuote): RouteFuelCost {
  return {
    predictedEur: predictFuelCostEur(quote),
    actualEur: actualFuelCostEur(quote),
  };
}

/**
 * A vehicle-day odometer distance belongs to one route only when that day
 * has no other route. Several routes are not split by guesswork.
 */
export function consumedLitersForSingleRoute(input: {
  litersPer100Km: number | null;
  odometerKm: number | null;
  routeCountOnVehicleDay: number;
}): number | null {
  if (input.routeCountOnVehicleDay !== 1) return null;
  const norm = nonNegative(input.litersPer100Km);
  const km = nonNegative(input.odometerKm);
  if (norm === null || km === null) return null;
  return money(km * norm / 100);
}

export function monthIndexFromDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? Number(match[2]) : Number.NaN;
  return month >= 1 && month <= 12 ? month - 1 : 0;
}

export function monthFuelPrice(date: string, prices: readonly number[] | null | undefined): number | null {
  if (!prices || prices.length === 0) return null;
  const price = prices[monthIndexFromDate(date)];
  return nonNegative(price);
}

/** An entered vehicle norm wins. Otherwise only an exact plate profile, never a payload guess. */
export function explicitFuelNorm(vehicleNorm: number | null | undefined, profileNorm: number | null | undefined): number | null {
  return nonNegative(vehicleNorm) ?? nonNegative(profileNorm);
}

function nonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
