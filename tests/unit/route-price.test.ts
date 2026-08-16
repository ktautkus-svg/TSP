import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUTE_PRICE_SETTINGS,
  estimatePreliminaryRoutePrice,
  normalizeRoutePriceSettings,
} from '../../src/application/routes/route-price';

describe('preliminary route price imported from Maršruto kaina.xlsm logic', () => {
  it('reconciles the workbook own-transport example to 185.60 euro', () => {
    const result = estimatePreliminaryRoutePrice({
      date: '2025-04-26',
      distanceKm: 400,
      weightKg: 2_000,
      stops: 30,
      driverName: 'Dovydas Kučinskis',
      vehicle: { registrationNumber: 'LMC891', maximumPayloadKg: 1_200 },
    });

    expect(result).toMatchObject({
      fuelCostEur: 61.6,
      roadCostEur: 1.85,
      insuranceCostEur: 0.82,
      driverCostEur: 112.5,
      totalEur: 185.6,
      source: 'excel-vehicle',
    });
  });

  it('uses the fixed-day salary rule for matching drivers', () => {
    const result = estimatePreliminaryRoutePrice({
      date: '2026-08-17', distanceKm: 100, weightKg: 1_000, stops: 10,
      driverName: 'Gintaras Gavėnas',
      vehicle: { registrationNumber: 'EFA568', maximumPayloadKg: 2_500 },
    });
    expect(result?.driverCostEur).toBe(95.13);
  });

  it('returns no price before route distance exists and labels unknown vehicles as estimates', () => {
    expect(estimatePreliminaryRoutePrice({
      date: '2026-08-17', distanceKm: null, weightKg: 1_000, stops: 10,
      driverName: 'Karolis Tautkus', vehicle: { registrationNumber: 'V1', maximumPayloadKg: 1_500 },
    })).toBeNull();

    expect(estimatePreliminaryRoutePrice({
      date: '2026-08-17', distanceKm: 111.1, weightKg: 1_474, stops: 13,
      driverName: 'Karolis Tautkus', vehicle: { registrationNumber: 'V1', maximumPayloadKg: 1_500 },
    })?.source).toBe('payload-estimate');
  });

  it('uses editable fuel, payroll and overhead parameters without changing route data', () => {
    const settings = normalizeRoutePriceSettings({
      ...DEFAULT_ROUTE_PRICE_SETTINGS,
      fuelPriceByMonth: DEFAULT_ROUTE_PRICE_SETTINGS.fuelPriceByMonth.map((value, index) => index === 7 ? 2 : value),
      payrollTaxPercent: 0,
      overheadPercent: 0,
    });
    const result = estimatePreliminaryRoutePrice({
      date: '2026-08-17', distanceKm: 100, weightKg: 0, stops: 0,
      driverName: 'Gintaras Gavėnas',
      vehicle: { registrationNumber: 'EFA568', maximumPayloadKg: 2_500 },
    }, settings);

    expect(result?.fuelCostEur).toBe(40);
    expect(result?.driverCostEur).toBe(63);
    expect(result?.overheadEur).toBe(0);
  });

  it('preserves newly created driver and vehicle tariffs during normalization', () => {
    const settings = normalizeRoutePriceSettings({
      ...DEFAULT_ROUTE_PRICE_SETTINGS,
      driverCosts: {
        ...DEFAULT_ROUTE_PRICE_SETTINGS.driverCosts,
        'vairas 10': { type: 'fixed', dailyNetEur: 88 },
      },
      vehicleCosts: {
        ...DEFAULT_ROUTE_PRICE_SETTINGS.vehicleCosts,
        XYZ123: { fuelNormLitersPer100Km: 12.4, annualInsuranceEur: 900, monthlyRoadTaxEur: 75 },
      },
    });

    expect(settings.driverCosts['vairas 10']).toEqual({ type: 'fixed', dailyNetEur: 88 });
    expect(settings.vehicleCosts.XYZ123).toEqual({ fuelNormLitersPer100Km: 12.4, annualInsuranceEur: 900, monthlyRoadTaxEur: 75 });
  });
});
