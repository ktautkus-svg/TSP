import {
  applyActualFuelMoney,
  DEFAULT_ROUTE_PRICE_SETTINGS,
  estimatePreliminaryRoutePrice,
  isFinalTripCost,
  type PreliminaryRoutePrice,
  type RoutePriceSettings,
} from '@/application/routes/route-price';
import type { ServerTripSheet } from '@/infrastructure/auth/employee-session';

export type PricedTripSheet = {
  sheet: ServerTripSheet;
  price: PreliminaryRoutePrice & { fuelCostKnown: boolean };
  final: boolean;
};

/**
 * Trip cost for "Reiso kaina". Fuel is always the norm formula:
 * km × vehicle norm / 100 litres × the litre price saved for the trip's year
 * and month (none saved → unknown, never another year's price). Receipt
 * totals stay in fuel history and accounting; they are not the trip's fuel cost.
 *
 * `settings === null` means the saved settings could not be loaded. Fuel is
 * then unknown ("—") instead of silently using the built-in tariff.
 */
export function priceTripSheets(sheets: readonly ServerTripSheet[], settings: RoutePriceSettings | null): PricedTripSheet[] {
  return sheets.flatMap((sheet) => {
    if (!sheet.vehicle) return [];
    const price = estimatePreliminaryRoutePrice({
      date: sheet.date,
      distanceKm: sheet.actualDistanceKm ?? sheet.plannedDistanceKm,
      weightKg: sheet.totalWeightKg,
      stops: sheet.totalStops,
      driverName: sheet.driverName,
      vehicle: { registrationNumber: sheet.vehicle.registrationNumber, maximumPayloadKg: sheet.vehicle.maximumPayloadKg },
      fuelNormLitersPer100Km: sheet.fuelNormLitersPer100Km,
    }, settings ?? DEFAULT_ROUTE_PRICE_SETTINGS);
    if (!price) return [];
    const priced = settings !== null && price.fuelPriceKnown
      ? { ...price, fuelCostKnown: true }
      : applyActualFuelMoney(price, null);
    return [{ sheet, price: priced, final: isFinalTripCost(sheet) }];
  }).sort((left, right) => right.sheet.date.localeCompare(left.sheet.date));
}
