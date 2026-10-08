import { describe, expect, it } from 'vitest';

import { fuelFillDate, fuelMoneyForLiters, fuelPriceForDate, tripFuelMoney } from '../../src/application/finance/fuel-price';
import { priceTripSheets } from '../../src/application/finance/trip-price';
import { aggregateWageDays, summarizeWageDays } from '../../src/application/finance/wage-report';
import {
  DEFAULT_ROUTE_PRICE_SETTINGS,
  normalizeRoutePriceSettings,
  type RoutePriceSettings,
} from '../../src/application/routes/route-price';
import type { ServerFuelEntry, ServerTripSheet } from '../../src/infrastructure/auth/employee-session';

// The prices Karolis saved in "Kuro ir atlygio parametrai": 1,80 €/l for
// July–August and 1,93 €/l from September.
const SAVED: RoutePriceSettings = normalizeRoutePriceSettings({
  ...DEFAULT_ROUTE_PRICE_SETTINGS,
  fuelPriceByMonth: [1.26, 1.25, 1.17, 1.1, 1.08, 1.13, 1.8, 1.8, 1.93, 1.93, 1.93, 1.93],
});

function fuelEntry(overrides: Partial<ServerFuelEntry> = {}): ServerFuelEntry {
  return {
    id: 'fuel-1',
    tripSheetId: 'sheet-nll',
    assignmentId: 'assignment-nll',
    routeId: 'route-nll',
    driverId: 'driver-1',
    driverName: 'Karolis',
    vehicleId: 'veh-nll',
    registrationNumber: 'NLL182',
    filledAt: '2026-10-05T06:30:00.000Z',
    odometer: null,
    liters: 83,
    pricePerLiter: null,
    totalCost: null,
    station: null,
    receiptNumber: '3/1200',
    notes: null,
    createdAt: '2026-10-05T06:30:00.000Z',
    createdBy: 'admin',
    ...overrides,
  } as ServerFuelEntry;
}

function nllTrip(overrides: Partial<ServerTripSheet> = {}): ServerTripSheet {
  return {
    id: 'sheet-nll',
    assignmentId: 'assignment-nll',
    routeId: 'route-nll',
    routeNumbers: ['R09'],
    status: 'completed',
    date: '2026-10-05',
    driverId: 'driver-1',
    driverName: 'Karolis Tautkus',
    vehicle: { id: 'veh-nll', registrationNumber: 'NLL182', maximumPayloadKg: 1_400 } as ServerTripSheet['vehicle'],
    fuelNormLitersPer100Km: 13.2,
    startOdometer: 100_000,
    endOdometer: 100_533,
    actualDistanceKm: 533,
    plannedDistanceKm: null,
    startedAt: null,
    completedAt: null,
    durationMinutes: null,
    totalStops: 12,
    deliveredStops: 12,
    totalWeightKg: 1_000,
    deliveredWeightKg: 1_000,
    startAddress: '',
    endAddress: '',
    compensation: null,
    fuelEntries: [],
    ...overrides,
  } as ServerTripSheet;
}

describe('litre price valid for a date', () => {
  it('reads the saved month price and never invents one', () => {
    expect(fuelPriceForDate(SAVED, '2026-10-05')).toBe(1.93);
    expect(fuelPriceForDate(SAVED, '2026-08-31')).toBe(1.8);
    expect(fuelPriceForDate(SAVED, '2026-10-05T23:10:00.000Z')).toBe(1.93);
    expect(fuelPriceForDate(null, '2026-10-05')).toBeNull();
    expect(fuelPriceForDate(SAVED, 'not a date')).toBeNull();
    const zeroOctober = { ...SAVED, fuelPriceByMonth: SAVED.fuelPriceByMonth.map((value, index) => (index === 9 ? 0 : value)) };
    expect(fuelPriceForDate(zeroOctober, '2026-10-05')).toBeNull();
  });

  it('uses the fill day of an ISO timestamp, falling back to the sheet date', () => {
    expect(fuelFillDate('2026-09-30T21:00:00.000Z', '2026-10-01')).toBe('2026-09-30');
    expect(fuelFillDate('', '2026-10-01')).toBe('2026-10-01');
    expect(fuelFillDate(null, '2026-10-01')).toBe('2026-10-01');
  });

  it('never turns litres into euros when the price is missing', () => {
    expect(fuelMoneyForLiters(83, '2026-10-05', SAVED)).toEqual({ liters: 83, pricePerLiter: 1.93, costEur: 160.19 });
    expect(fuelMoneyForLiters(83, '2026-10-05', null)).toEqual({ liters: 83, pricePerLiter: null, costEur: null });
  });

  it('computes trip fuel from km × norm / 100 × litre price (2026-10-05, NLL182, 533 km)', () => {
    expect(tripFuelMoney({ distanceKm: 533, fuelNormLitersPer100Km: 13.2, date: '2026-10-05', settings: SAVED }))
      .toEqual({ liters: 70.36, pricePerLiter: 1.93, costEur: 135.79 });
    expect(tripFuelMoney({ distanceKm: null, fuelNormLitersPer100Km: 13.2, date: '2026-10-05', settings: SAVED })).toBeNull();
    expect(tripFuelMoney({ distanceKm: 533, fuelNormLitersPer100Km: null, date: '2026-10-05', settings: SAVED })).toBeNull();
  });
});

describe('Reiso kaina fuel', () => {
  it('prices the trip by the norm formula with the saved price, not the built-in ~1 €/l tariff or receipts', () => {
    const receipt = fuelEntry({ totalCost: 50, pricePerLiter: 1.5, liters: 33.33 });
    const [trip] = priceTripSheets([nllTrip({ fuelEntries: [receipt] })], SAVED);
    expect(trip!.price.fuelCostKnown).toBe(true);
    expect(trip!.price.fuelLiters).toBe(70.36);
    expect(trip!.price.fuelPricePerLiter).toBe(1.93);
    expect(trip!.price.fuelCostEur).toBe(135.79);
    // The built-in default for October is 1,13 €/l — the old screen used it.
    expect(DEFAULT_ROUTE_PRICE_SETTINGS.fuelPriceByMonth[9]).toBe(1.13);
    expect(trip!.price.fuelCostEur).not.toBe(Math.round(70.356 * 1.13 * 100) / 100);
    // Fuel is part of the trip total.
    expect(trip!.price.totalEur).toBeGreaterThan(trip!.price.fuelCostEur);
  });

  it('prefers the vehicle norm on the trip sheet over the registration table', () => {
    const [trip] = priceTripSheets([nllTrip({ fuelNormLitersPer100Km: 15 })], SAVED);
    expect(trip!.price.fuelLiters).toBe(79.95);
    expect(trip!.price.fuelCostEur).toBe(154.3);
  });

  it('shows fuel as unknown, outside the total, when the saved prices could not be loaded', () => {
    const [known] = priceTripSheets([nllTrip()], SAVED);
    const [unknown] = priceTripSheets([nllTrip()], null);
    expect(unknown!.price.fuelCostKnown).toBe(false);
    expect(unknown!.price.fuelCostEur).toBe(0);
    expect(unknown!.price.fuelLiters).toBe(70.36);
    expect(unknown!.price.totalEur).toBeLessThan(known!.price.totalEur);
    expect(unknown!.price.assumptions).toContain('Kuro piniginė suma nežinoma');
  });
});

describe('wage report fuel money', () => {
  it('charges poured litres × the price valid on the fill date and ignores receipt totals', () => {
    const sheet = nllTrip({ fuelEntries: [fuelEntry({ totalCost: 99.99, pricePerLiter: 1.2 })] });
    const days = aggregateWageDays([sheet], [], (date) => fuelPriceForDate(SAVED, date));
    expect(days[0]!.figures.fuelLiters).toBe(83);
    expect(days[0]!.figures.fuelCostEur).toBe(160.19);
    expect(days[0]!.figures.fuelUnpricedLiters).toBe(0);
    const totals = summarizeWageDays(days);
    expect(totals.fuelCostEur).toBe(160.19);
    expect(totals.totalEur).toBeCloseTo(totals.fuelCostEur + totals.payEur);
  });

  it('keeps litres visible but out of the euro sum when no price exists', () => {
    const sheet = nllTrip({ fuelEntries: [fuelEntry()] });
    const days = aggregateWageDays([sheet], [], () => null);
    expect(days[0]!.figures.fuelLiters).toBe(83);
    expect(days[0]!.figures.fuelCostEur).toBe(0);
    expect(days[0]!.figures.fuelUnpricedLiters).toBe(83);
    expect(summarizeWageDays(days).fuelUnpricedLiters).toBe(83);
  });

  it('prices each fill by its own month', () => {
    const sheet = nllTrip({
      fuelEntries: [
        fuelEntry({ id: 'aug', filledAt: '2026-08-31T10:00:00.000Z', liters: 10 }),
        fuelEntry({ id: 'sep', filledAt: '2026-09-01T10:00:00.000Z', liters: 10 }),
      ],
    });
    const days = aggregateWageDays([sheet], [], (date) => fuelPriceForDate(SAVED, date));
    expect(days[0]!.figures.fuelCostEur).toBe(37.3);
  });
});
