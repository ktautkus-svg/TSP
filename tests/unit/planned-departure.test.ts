import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
import type { DeliveryStop, Route } from '../../src/domain/route';

const loading = readFileSync('src/app/route/[id]/loading.tsx', 'utf8');

function routeFixture(overrides: Partial<Route> = {}): Route {
  const endpoint = {
    originalAddress: 'Bazė',
    geocodingQuery: null,
    normalizedAddress: 'Bazė',
    latitude: 55.93,
    longitude: 23.31,
  };
  return {
    id: 'route-1',
    vehicleId: null,
    date: '2026-08-10',
    status: 'draft',
    planningMode: 'with_time_windows',
    estimatedDistanceKm: null,
    actualDistanceKm: null,
    totalWeightKg: 100,
    remainingWeightKg: 100,
    totalStops: 1,
    remainingStops: 1,
    startOdometer: null,
    endOdometer: null,
    createdAt: '2026-08-09T20:00:00.000Z',
    updatedAt: '2026-08-09T20:00:00.000Z',
    startedAt: null,
    completedAt: null,
    startLocation: endpoint,
    endLocation: endpoint,
    plannedDepartureAt: '2026-08-10T01:00:00.000Z',
    selectedRunId: null,
    selectedCandidateId: null,
    estimatedDurationMinutes: null,
    sourceImportAuditId: null,
    unknownWeightStops: 0,
    remainingUnknownWeightStops: 0,
    cancelledAt: null,
    startOdometerRecordedAt: null,
    startOdometerSkippedAt: null,
    endOdometerRecordedAt: null,
    activeSequenceSnapshotAt: null,
    completionStartedAt: null,
    completionEndOdometerDraft: null,
    completionSummary: null,
    ...overrides,
  };
}

function stopFixture(): DeliveryStop {
  return {
    id: 'stop-1',
    sourceStopId: null,
    routeId: 'route-1',
    originalOrder: 1,
    optimizedOrder: 1,
    activeOrder: 1,
    orderNumber: '1',
    recipient: 'Gavėjas',
    address: 'Adresas',
    originalAddress: 'Adresas',
    geocodingQuery: null,
    normalizedAddress: 'Adresas',
    addressValidationState: 'auto_confirmed',
    geocodingError: null,
    latitude: 55.94,
    longitude: 23.32,
    deliveryTimeFrom: '08:00',
    deliveryTimeTo: '16:00',
    requiredTimeWindow: true,
    serviceDurationMinutes: 10,
    plannedArrivalAt: null,
    plannedDepartureAt: null,
    latestEstimatedArrivalAt: null,
    legDistanceKm: null,
    legDurationMinutes: null,
    etaUpdatedAt: null,
    etaApproximate: false,
    weightKg: 60,
    priorityFirst: false,
    phone: null,
    notes: null,
    loadingStatus: 'pending',
    deliveryStatus: 'pending',
    failureReason: null,
    failureComment: null,
    loadedAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: '2026-08-09T20:00:00.000Z',
    updatedAt: '2026-08-09T20:00:00.000Z',
  };
}

describe('planned departure stays until Start', () => {
  it('keeps a past planned start on the optimization request instead of bumping to now', () => {
    const planned = '2026-08-10T01:00:00.000Z'; // 04:00 LT summer
    const request = buildOptimizationRequestFromRoute(routeFixture({ plannedDepartureAt: planned }), [stopFixture()]);
    expect(request.plannedDepartureAt).toBe(planned);
  });

  it('falls back to now only when the route has no planned start at all', () => {
    const before = Date.now();
    const request = buildOptimizationRequestFromRoute(routeFixture({ plannedDepartureAt: null }), [stopFixture()]);
    const after = Date.now();
    const ms = Date.parse(request.plannedDepartureAt);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after + 1_000);
  });

  it('shows the planned start on loading and starts live ETAs only from StartRoute', () => {
    expect(loading).toContain('Planuojamas išvykimas');
    expect(loading).toContain('loading-departure-label');
    expect(loading).toContain('StartRoute');
    expect(loading).toContain('statusRail');
    expect(loading).toContain('orderBadge');
    expect(loading).toContain('Laukia pakrovimo');
  });
});
