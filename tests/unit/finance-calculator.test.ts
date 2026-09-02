import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  averageVehicleDayCosts,
  DEFAULT_ROUTE_PRICE_SETTINGS,
  estimateCalculatorRoutePrice,
  estimateVariableDriverEarnings,
  isFinalTripCost,
} from '../../src/application/routes/route-price';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hubSource = readFileSync(resolve(root, 'src/app/finance.tsx'), 'utf8');
const calculatorSource = readFileSync(resolve(root, 'src/app/finance/calculator.tsx'), 'utf8');
const routePriceSource = readFileSync(resolve(root, 'src/app/finance/route-price.tsx'), 'utf8');
const layoutSource = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');

describe('finance calculator and trip-cost finality', () => {
  it('registers Skaičiuoklė beside other finance tabs', () => {
    expect(hubSource).toContain('testID="finance-open-calculator"');
    expect(hubSource).toContain('Skaičiuoklė');
    expect(layoutSource).toContain('finance/calculator');
    expect(calculatorSource).toContain('Preliminari reiso kaina');
    expect(calculatorSource).toContain('Preliminarus atlygis');
    expect(calculatorSource).toContain('testID="calculator-wage-manual"');
  });

  it('keeps the trip-cost list phone-readable with expand-for-detail and prelim/final labels', () => {
    expect(routePriceSource).toContain('Vardas Pavardė');
    expect(routePriceSource).toContain('Mašinos nr');
    expect(routePriceSource).toContain('preliminarinė');
    expect(routePriceSource).toContain('galutinė');
    expect(routePriceSource).toContain('isFinalTripCost');
    expect(routePriceSource).toContain('route-price-expand-');
    expect(routePriceSource).not.toContain('Kelių+draud.');
    expect(routePriceSource).not.toContain('detailHeaderRow');
  });

  it('treats completed routes with odometer distance as final and others as preliminary', () => {
    expect(isFinalTripCost({
      status: 'completed',
      actualDistanceKm: 415,
      startOdometer: 1000,
      endOdometer: 1415,
    })).toBe(true);
    expect(isFinalTripCost({
      status: 'completed',
      actualDistanceKm: null,
      startOdometer: null,
      endOdometer: null,
    })).toBe(false);
    expect(isFinalTripCost({
      status: 'in_progress',
      actualDistanceKm: 100,
      startOdometer: 10,
      endOdometer: 110,
    })).toBe(false);
  });

  it('averages road and insurance from stored vehicle tariffs when no vehicle is chosen', () => {
    const averages = averageVehicleDayCosts('2026-09-02', DEFAULT_ROUTE_PRICE_SETTINGS);
    expect(averages.vehicleCount).toBeGreaterThan(5);
    expect(averages.roadCostEur).toBeGreaterThan(0);
    expect(averages.insuranceCostEur).toBeGreaterThan(0);
    expect(averages.fuelNormLitersPer100Km).toBeGreaterThan(0);
  });

  it('estimates a preliminary trip price with average overhead and manual wage', () => {
    const price = estimateCalculatorRoutePrice({
      date: '2026-09-02',
      distanceKm: 400,
      weightKg: 1_200,
      stops: 14,
      wageMode: 'manual',
      manualDriverNetEur: 90,
    });
    expect(price).not.toBeNull();
    expect(price!.fuelCostEur).toBeGreaterThan(0);
    expect(price!.roadCostEur + price!.insuranceCostEur).toBeGreaterThan(0);
    expect(price!.driverCostEur).toBeCloseTo(90 * 1.51, 1);
    expect(price!.assumptions.some((item) => item.includes('vidurkis'))).toBe(true);
  });

  it('estimates variable driver earnings from km, points and kg', () => {
    const earnings = estimateVariableDriverEarnings({
      distanceKm: 400,
      weightKg: 1_200,
      stops: 14,
    });
    const rates = DEFAULT_ROUTE_PRICE_SETTINGS.defaultDriverCost;
    expect(earnings.totalNetEur).toBeCloseTo(
      rates.baseNetEur + rates.perKmEur * 400 + rates.perKgEur * 1_200 + rates.perStopEur * 14,
      2,
    );
  });
});
