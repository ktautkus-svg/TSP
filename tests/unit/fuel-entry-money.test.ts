import { describe, expect, it } from 'vitest';

import { allocateFuelMoney, fuelEntryMoneyEur, sumFuelMoney } from '../../src/application/routes/fuel-entry-money';
import { applyActualFuelMoney, estimatePreliminaryRoutePrice } from '../../src/application/routes/route-price';

const vehicle = { registrationNumber: 'EFA568', maximumPayloadKg: 2500 };

describe('fuel entry money', () => {
  it('uses a known receipt total and does not treat litres as euros', () => {
    expect(fuelEntryMoneyEur({ id: 'a', liters: 80, totalCost: 124.5, pricePerLiter: 1.4 })).toBe(124.5);
    expect(fuelEntryMoneyEur({ id: 'b', liters: 80, totalCost: null, pricePerLiter: null })).toBeNull();
    expect(sumFuelMoney([{ id: 'b', liters: 80 }]).moneyEur).toBeNull();
  });

  it('multiplies litres by the litre price when the receipt total is missing', () => {
    expect(fuelEntryMoneyEur({ id: 'a', liters: 40, pricePerLiter: 1.499 })).toBe(59.96);
  });

  it('sums several fills once and ignores rejected, deleted and other-vehicle fills', () => {
    const entries = [
      { id: 'a', liters: 10, totalCost: 15, vehicleId: 'van' },
      { id: 'a', liters: 10, totalCost: 15, vehicleId: 'van' },
      { id: 'b', liters: 20, pricePerLiter: 1.5, vehicleId: 'van' },
      { id: 'c', liters: 50, totalCost: 70, vehicleId: 'other' },
      { id: 'd', liters: 30, totalCost: 40, vehicleId: 'van', status: 'rejected' },
      { id: 'e', liters: 12, totalCost: 18, vehicleId: 'van', deletedAt: '2026-09-01' },
    ];
    const sum = sumFuelMoney(entries, 'van');
    expect(sum.moneyEur).toBe(45);
    expect(sum.countedIds).toEqual(['a', 'b']);
  });

  it('keeps the period total equal to the trip split', () => {
    const allocation = allocateFuelMoney([
      { id: 'sheet-1', date: '2026-09-01', vehicleId: 'van', fuelEntries: [{ id: 'a', liters: 40, totalCost: 60, tripSheetId: 'sheet-1', vehicleId: 'van' }] },
      { id: 'sheet-2', date: '2026-09-02', vehicleId: 'van', fuelEntries: [{ id: 'a', liters: 40, totalCost: 60, tripSheetId: 'sheet-1', vehicleId: 'van' }, { id: 'b', liters: 10, pricePerLiter: 1.2, tripSheetId: 'sheet-2', vehicleId: 'van' }] },
    ]);
    expect(allocation.bySheetId.get('sheet-1')?.moneyEur).toBe(60);
    expect(allocation.bySheetId.get('sheet-2')?.moneyEur).toBe(12);
    expect(allocation.total.moneyEur).toBe(72);
  });

  it('replaces the tariff fuel estimate without changing the other cost parts', () => {
    const tariff = estimatePreliminaryRoutePrice({
      date: '2026-08-17', distanceKm: 100, weightKg: 0, stops: 0,
      driverName: 'Gintaras Gavėnas',
      vehicle,
    });
    expect(tariff).not.toBeNull();
    const priced = applyActualFuelMoney(tariff!, 60);
    expect(priced.fuelCostKnown).toBe(true);
    expect(priced.fuelCostEur).toBe(60);
    expect(priced.driverCostEur).toBe(tariff!.driverCostEur);
    expect(priced.roadCostEur).toBe(tariff!.roadCostEur);
    expect(priced.insuranceCostEur).toBe(tariff!.insuranceCostEur);
    const unknown = applyActualFuelMoney(tariff!, null);
    expect(unknown.fuelCostKnown).toBe(false);
    expect(unknown.fuelCostEur).toBe(0);
    expect(unknown.totalEur).toBeLessThan(tariff!.totalEur);
  });
});
