import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_ROUTE_PRICE_SETTINGS } from '../../src/application/routes/route-price';
import { inMemoryFirestore } from '../support/in-memory-firestore';

// Real EmployeeAuthStore settings methods; only Firestore is in memory.
vi.mock('@google-cloud/firestore', () => import('../support/in-memory-firestore'));

const { EmployeeAuthStore } = await import('../../server/employee-auth-store');

const { fuelPriceByYearMonth: _ignored, ...LEGACY_REST } = DEFAULT_ROUTE_PRICE_SETTINGS;
const LEGACY_FUEL = [1.26, 1.25, 1.17, 1.1, 1.08, 1.13, 1.8, 1.8, 1.93, 1.93, 1.93, 1.93];

beforeEach(() => {
  inMemoryFirestore.reset();
});

describe('route-pricing settings document', () => {
  it('reads the existing month-only document as 2026 prices without rewriting it', async () => {
    inMemoryFirestore.seed('tsp_settings', 'route-pricing', { ...LEGACY_REST, fuelPriceByMonth: LEGACY_FUEL, updatedAt: '2026-10-07T12:43:38.565Z' });
    const store = new EmployeeAuthStore();
    const settings = await store.getRoutePriceSettings();
    expect(settings.fuelPriceByYearMonth['2026-07']).toBe(1.8);
    expect(settings.fuelPriceByYearMonth['2026-10']).toBe(1.93);
    expect(settings.fuelPriceByYearMonth['2027-10']).toBeUndefined();
    // Reading never migrates the stored document.
    expect(inMemoryFirestore.read('tsp_settings', 'route-pricing')!.fuelPriceByMonth).toEqual(LEGACY_FUEL);
  });

  it('saves prices by year and month and reads them back', async () => {
    const store = new EmployeeAuthStore();
    const current = await store.getRoutePriceSettings();
    await store.updateRoutePriceSettings({ ...current, fuelPriceByYearMonth: { '2026-10': 1.93, '2027-01': 1.99 } }, 'admin');
    const stored = inMemoryFirestore.read('tsp_settings', 'route-pricing')!;
    expect(stored.fuelPriceByYearMonth).toEqual({ '2026-10': 1.93, '2027-01': 1.99 });
    expect(stored.fuelPriceByMonth).toBeUndefined();
    expect((await store.getRoutePriceSettings()).fuelPriceByYearMonth).toEqual({ '2026-10': 1.93, '2027-01': 1.99 });
  });

  it('keeps stored year-month prices when an older app saves month-only prices', async () => {
    const store = new EmployeeAuthStore();
    const current = await store.getRoutePriceSettings();
    await store.updateRoutePriceSettings({ ...current, fuelPriceByYearMonth: { '2026-10': 1.93, '2027-01': 1.99 } }, 'admin');
    await store.updateRoutePriceSettings({ ...LEGACY_REST, fuelPriceByMonth: LEGACY_FUEL.map(() => 1), overheadPercent: 12 }, 'old-app');
    const after = await store.getRoutePriceSettings();
    expect(after.fuelPriceByYearMonth).toEqual({ '2026-10': 1.93, '2027-01': 1.99 });
    expect(after.overheadPercent).toBe(12);
  });
});
