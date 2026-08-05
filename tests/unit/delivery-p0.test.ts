import { describe, expect, it } from 'vitest';

import { normalizeGoogleDepartureAt } from '../../gateway/providers/adapter-utils';
import {
  DELIVERY_FAILURE_REASONS,
  deliveryMatchesFilter,
} from '../../src/domain/delivery-failure';
import { calculateRouteMetrics } from '../../src/domain/metrics';
import { failedDeliveryLabel, userVisibleStopNote } from '../../src/ui/route-labels';

describe('P0 failed-delivery workflow', () => {
  it('exposes exactly the five daily failure reasons', () => {
    expect(DELIVERY_FAILURE_REASONS).toEqual([
      'Nedirba',
      'Liko sandėlyje',
      'Netilpo',
      'Netinka produkcija',
      'Kita',
    ]);
  });

  it('keeps pending, failed and delivered filters separate', () => {
    expect(deliveryMatchesFilter('undelivered', 'pending')).toBe(true);
    expect(deliveryMatchesFilter('undelivered', 'failed')).toBe(false);
    expect(deliveryMatchesFilter('failed', 'failed')).toBe(true);
    expect(deliveryMatchesFilter('delivered', 'delivered')).toBe(true);
    expect(['pending', 'failed', 'delivered'].every((status) =>
      deliveryMatchesFilter('all', status as 'pending' | 'failed' | 'delivered'))).toBe(true);
  });

  it('does not count failed stops in remaining stops, weight or distance share', () => {
    expect(calculateRouteMetrics([
      { weightKg: 10, deliveryStatus: 'delivered' },
      { weightKg: 20, deliveryStatus: 'failed' },
      { weightKg: 30, deliveryStatus: 'pending' },
    ])).toMatchObject({
      remainingStops: 1,
      remainingWeightKg: 30,
      deliveredStops: 1,
      failedStops: 1,
    });
  });

  it('renders failure reason once and a distinct optional comment on its own line', () => {
    expect(failedDeliveryLabel('Nedirba', null)).toBe('Nepavyko: Nedirba');
    expect(failedDeliveryLabel('Nedirba', 'Nedirba')).toBe('Nepavyko: Nedirba');
    expect(failedDeliveryLabel('Kita', 'Vartai užrakinti')).toBe('Nepavyko: Kita\nKomentaras: Vartai užrakinti');
    expect(failedDeliveryLabel('Nerastas gavėjas', 'Nerastas gavėjas')).toBe('Nepavyko: Nerastas gavėjas');
  });

  it('hides generated order summaries but keeps a real user note', () => {
    expect(userVisibleStopNote('2 užsakymo eilutė(-ės): S605795, S606007')).toBeNull();
    expect(userVisibleStopNote('Užsakymų numeriai: S605795, S606007')).toBeNull();
    expect(userVisibleStopNote('Palikti prekes prie galinių vartų')).toBe('Palikti prekes prie galinių vartų');
  });

  it('moves a stale provider departure safely into the future', () => {
    const normalized = normalizeGoogleDepartureAt('2026-08-03T08:00:00.000Z', Date.parse('2026-08-03T10:00:00.000Z'));
    expect(normalized).toBe('2026-08-03T10:01:00.000Z');
  });
});
