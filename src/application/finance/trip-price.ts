import {
  applyActualFuelMoney,
  estimatePreliminaryRoutePrice,
  isFinalTripCost,
  type PreliminaryRoutePrice,
  type RoutePriceSettings,
} from '@/application/routes/route-price';
import { allocateFuelMoney, type FuelMoneyEntry } from '@/application/routes/fuel-entry-money';
import type { ServerFuelEntry, ServerTripSheet } from '@/infrastructure/auth/employee-session';

export type PricedTripSheet = {
  sheet: ServerTripSheet;
  price: PreliminaryRoutePrice & { fuelCostKnown: boolean };
  final: boolean;
  /** Fills in the period that had neither a receipt total nor a litre price. */
  fuelUnpricedCount: number;
};

function moneyEntry(entry: ServerFuelEntry): FuelMoneyEntry {
  return {
    id: entry.id,
    liters: entry.liters,
    pricePerLiter: entry.pricePerLiter,
    totalCost: entry.totalCost,
    vehicleId: entry.vehicleId,
    tripSheetId: entry.tripSheetId,
  };
}

/**
 * Trip cost for "Reiso kaina". Fuel is the money actually poured:
 * receipt total, otherwise litres × that fill's litre price. A missing
 * price stays unknown. The monthly tariff is not used as a fuel guess.
 * Road, insurance, driver and overhead stay on the existing estimate.
 */
export function priceTripSheets(sheets: readonly ServerTripSheet[], settings: RoutePriceSettings | null): PricedTripSheet[] {
  const allocation = allocateFuelMoney(sheets.map((sheet) => ({
    id: sheet.id,
    date: sheet.date,
    vehicleId: sheet.vehicle?.id ?? null,
    fuelEntries: sheet.fuelEntries.map(moneyEntry),
  })));
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
    }, settings ?? undefined);
    if (!price) return [];
    const fuel = allocation.bySheetId.get(sheet.id);
    const priced = applyActualFuelMoney(price, fuel?.moneyEur ?? null);
    return [{ sheet, price: priced, final: isFinalTripCost(sheet), fuelUnpricedCount: fuel?.unpricedCount ?? 0 }];
  }).sort((left, right) => right.sheet.date.localeCompare(left.sheet.date));
}
