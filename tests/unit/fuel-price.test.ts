import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// The production settings document as saved before prices had a year: one
// price per month (1,80 €/l July–August, 1,93 €/l from September).
const { fuelPriceByYearMonth: _ignored, ...LEGACY_REST } = DEFAULT_ROUTE_PRICE_SETTINGS;
const LEGACY_DOCUMENT = {
  ...LEGACY_REST,
  fuelPriceByMonth: [1.26, 1.25, 1.17, 1.1, 1.08, 1.13, 1.8, 1.8, 1.93, 1.93, 1.93, 1.93],
  updatedAt: '2026-10-07T12:43:38.565Z',
};
const SAVED: RoutePriceSettings = normalizeRoutePriceSettings(LEGACY_DOCUMENT);

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
    const zeroOctober = { ...SAVED, fuelPriceByYearMonth: { ...SAVED.fuelPriceByYearMonth, '2026-10': 0 } };
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
    expect(DEFAULT_ROUTE_PRICE_SETTINGS.fuelPriceByYearMonth['2026-10']).toBe(1.13);
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

describe('litre prices stored by year and month', () => {
  it('keeps the prices saved before years existed, as 2026, without a migration', () => {
    expect(SAVED.fuelPriceByYearMonth).toEqual({
      '2026-01': 1.26, '2026-02': 1.25, '2026-03': 1.17, '2026-04': 1.1, '2026-05': 1.08, '2026-06': 1.13,
      '2026-07': 1.8, '2026-08': 1.8, '2026-09': 1.93, '2026-10': 1.93, '2026-11': 1.93, '2026-12': 1.93,
    });
    expect('fuelPriceByMonth' in SAVED).toBe(false);
    // Saving and reading back keeps the same prices (normalize is stable).
    expect(normalizeRoutePriceSettings(JSON.parse(JSON.stringify(SAVED))).fuelPriceByYearMonth).toEqual(SAVED.fuelPriceByYearMonth);
  });

  it('never borrows another year’s price for a month without one', () => {
    expect(fuelPriceForDate(SAVED, '2027-10-05')).toBeNull();
    expect(fuelPriceForDate(SAVED, '2025-10-05')).toBeNull();
    const [trip] = priceTripSheets([nllTrip({ date: '2027-10-05' })], SAVED);
    expect(trip!.price.fuelCostKnown).toBe(false);
    expect(trip!.price.fuelPriceKnown).toBe(false);
    expect(trip!.price.fuelPricePerLiter).toBeNull();
    expect(trip!.price.fuelCostEur).toBe(0);
    expect(trip!.price.fuelLiters).toBe(70.36);
    expect(trip!.price.assumptions.join(' ')).toContain('Kuro piniginė suma nežinoma');
    const days = aggregateWageDays([nllTrip({ date: '2027-10-05', fuelEntries: [fuelEntry({ filledAt: '2027-10-05T06:00:00.000Z' })] })], [], (date) => fuelPriceForDate(SAVED, date));
    expect(days[0]!.figures.fuelCostEur).toBe(0);
    expect(days[0]!.figures.fuelUnpricedLiters).toBe(83);
  });

  it('uses a price entered for another year only in that year', () => {
    const with2027 = normalizeRoutePriceSettings({ ...SAVED, fuelPriceByYearMonth: { ...SAVED.fuelPriceByYearMonth, '2027-10': 2.05 } });
    expect(fuelPriceForDate(with2027, '2027-10-05')).toBe(2.05);
    expect(fuelPriceForDate(with2027, '2026-10-05')).toBe(1.93);
    expect(fuelPriceForDate(with2027, '2027-09-05')).toBeNull();
  });

  it('drops malformed keys and non-positive prices from a saved document', () => {
    const settings = normalizeRoutePriceSettings({
      fuelPriceByYearMonth: { '2026-10': 1.93, '2026-13': 1.5, '26-10': 1.5, '2026-11': 0, '2026-12': -1, '2027-01': 'x' },
    });
    expect(settings.fuelPriceByYearMonth).toEqual({ '2026-10': 1.93 });
    // An explicitly empty price table stays empty instead of reviving defaults.
    expect(normalizeRoutePriceSettings({ fuelPriceByYearMonth: {} }).fuelPriceByYearMonth).toEqual({});
  });
});

describe('litre price entry', () => {
  it('lets the admin choose the year and enter or clear each month for that year', () => {
    const panel = readFileSync(resolve(import.meta.dirname, '../../src/components/route-price-settings-panel.tsx'), 'utf8');
    expect(panel).toContain('testID="route-price-fuel-year-prev"');
    expect(panel).toContain('testID="route-price-fuel-year-next"');
    expect(panel).toContain('fuelPriceYearMonthKey(fuelYear, index + 1)');
    expect(panel).toContain('draft.fuelPriceByYearMonth[key] ?? null');
    // Clearing a field removes the price instead of saving 0 or keeping the old one.
    expect(panel).toMatch(/if \(!trimmed\) \{ onChange\(null\); return; \}/);
    expect(panel).toContain('if (value === null) delete prices[key];');
    expect(panel).not.toContain('fuelPriceByMonth');
  });
});
