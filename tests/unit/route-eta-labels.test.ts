import { describe, expect, it } from 'vitest';

import { windowUrgencyColor } from '@/ui/route-eta-labels';
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
