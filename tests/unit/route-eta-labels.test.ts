import { describe, expect, it } from 'vitest';

import { arrivalWindowStatus, deliveryWindowValue, windowUrgencyColor } from '@/ui/route-eta-labels';
import type { DeliveryStop } from '@/domain/route';

function buildStop(overrides: Partial<DeliveryStop> = {}): DeliveryStop {
  return {
    id: 'stop-1',
    sourceStopId: null,
    routeId: 'route-1',
    originalOrder: 0,
    optimizedOrder: null,
    activeOrder: null,
    orderNumber: null,
    recipient: '',
    address: 'Test 1',
    originalAddress: 'Test 1',
    geocodingQuery: null,
    normalizedAddress: 'Test 1',
    addressValidationState: 'auto_confirmed',
    geocodingError: null,
    latitude: 0,
    longitude: 0,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    serviceDurationMinutes: 0,
    plannedArrivalAt: null,
    plannedDepartureAt: null,
    latestEstimatedArrivalAt: null,
    legDistanceKm: null,
    legDurationMinutes: null,
    etaUpdatedAt: null,
    etaApproximate: false,
    weightKg: null,
    priorityFirst: false,
    phone: null,
    notes: null,
    ...overrides,
  } as DeliveryStop;
}

describe('windowUrgencyColor', () => {
  const routeDate = '2026-08-08';

  it('returns null when the stop has no delivery window', () => {
    const stop = buildStop({ deliveryTimeTo: null });
    expect(windowUrgencyColor(stop, routeDate, new Date(`${routeDate}T10:00:00`).getTime())).toBeNull();
  });

  it('returns null when there is no stop or route date', () => {
    expect(windowUrgencyColor(null, routeDate)).toBeNull();
    expect(windowUrgencyColor(buildStop({ deliveryTimeTo: '12:00' }), null)).toBeNull();
  });

  it('returns success when more than 60 minutes remain', () => {
    const stop = buildStop({ deliveryTimeTo: '12:00' });
    const now = new Date(`${routeDate}T10:00:00`).getTime();
    expect(windowUrgencyColor(stop, routeDate, now)).toBe('success');
  });

  it('returns warning when 60 minutes or fewer remain', () => {
    const stop = buildStop({ deliveryTimeTo: '12:00' });
    const now = new Date(`${routeDate}T11:00:00`).getTime();
    expect(windowUrgencyColor(stop, routeDate, now)).toBe('warning');
  });

  it('returns warning right at the exact 60 minute boundary', () => {
    const stop = buildStop({ deliveryTimeTo: '12:00' });
    const now = new Date(`${routeDate}T11:00:00.000`).getTime();
    expect(windowUrgencyColor(stop, routeDate, now)).toBe('warning');
  });

  it('returns danger once the deadline has passed', () => {
    const stop = buildStop({ deliveryTimeTo: '12:00' });
    const now = new Date(`${routeDate}T12:00:01`).getTime();
    expect(windowUrgencyColor(stop, routeDate, now)).toBe('danger');
  });
});

describe('arrivalWindowStatus', () => {
  const routeDate = '2026-08-08';

  it('clearly distinguishes on-time, risk, early and missed-window arrivals', () => {
    const base = { deliveryTimeFrom: '10:00', deliveryTimeTo: '12:00' };
    expect(arrivalWindowStatus(buildStop({ ...base, latestEstimatedArrivalAt: `${routeDate}T11:20:00` }), routeDate)).toMatchObject({ state: 'on_time', color: 'success' });
    expect(arrivalWindowStatus(buildStop({ ...base, latestEstimatedArrivalAt: `${routeDate}T11:50:00` }), routeDate)).toMatchObject({ state: 'at_risk', color: 'warning' });
    expect(arrivalWindowStatus(buildStop({ ...base, latestEstimatedArrivalAt: `${routeDate}T09:40:00` }), routeDate)).toMatchObject({ state: 'early', color: 'warning' });
    expect(arrivalWindowStatus(buildStop({ ...base, latestEstimatedArrivalAt: `${routeDate}T12:10:00` }), routeDate)).toMatchObject({ state: 'late', color: 'danger' });
  });

  it('compares the local ETA clock time when an active route continues on the next calendar day', () => {
    const stop = buildStop({
      deliveryTimeFrom: '06:00',
      deliveryTimeTo: '08:00',
      latestEstimatedArrivalAt: '2026-08-09T06:40:00',
    });

    expect(arrivalWindowStatus(stop, '2026-08-08')).toMatchObject({ state: 'on_time', color: 'success' });
  });

  it('keeps a missing window neutral and formats a real window compactly', () => {
    expect(arrivalWindowStatus(buildStop(), routeDate)).toMatchObject({ state: 'unavailable', color: 'textMuted' });
    expect(deliveryWindowValue(buildStop({ deliveryTimeFrom: '08:00', deliveryTimeTo: '10:00' }))).toBe('08:00–10:00');
  });
});
