import { describe, expect, it } from 'vitest';

import { buildOptimizationRequestFromRoute } from '../../src/application/routes/route-request-builder';
import type { DeliveryStop, Route, RouteEndpoint } from '../../src/domain/route';

const endpoint: RouteEndpoint = {
  originalAddress: 'Tilžės g. 1, Šiauliai',
  geocodingQuery: 'Tilžės g. 1, Šiauliai',
  normalizedAddress: 'Tilžės g. 1, Šiauliai',
  latitude: 55.93,
  longitude: 23.31,
};

function stop(overrides: Partial<DeliveryStop>): DeliveryStop {
  return {
    id: overrides.id ?? 'stop-1',
    sourceStopId: null,
    routeId: 'route-1',
    originalOrder: 1,
    optimizedOrder: null,
    activeOrder: null,
    orderNumber: null,
    recipient: 'Gavėjas',
    address: 'Tilžės g. 1, Šiauliai',
    originalAddress: 'Tilžės g. 1, Šiauliai',
    geocodingQuery: 'Tilžės g. 1, Šiauliai',
    normalizedAddress: 'Tilžės g. 1, Šiauliai',
    addressValidationState: 'auto_confirmed',
    geocodingError: null,
    latitude: 55.93,
    longitude: 23.31,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    serviceDurationMinutes: 15,
    plannedArrivalAt: null,
    plannedDepartureAt: null,
    latestEstimatedArrivalAt: null,
    legDistanceKm: null,
    legDurationMinutes: null,
    etaUpdatedAt: null,
    etaApproximate: false,
    weightKg: 5,
    priorityFirst: false,
    priorityRank: null,
    phone: null,
    notes: null,
    loadingStatus: 'pending',
    deliveryStatus: 'pending',
    failureReason: null,
    failureComment: null,
    loadedAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const route: Route = {
  id: 'route-1',
  vehicleId: 'vehicle-1',
  date: '2026-09-01',
  status: 'draft',
  planningMode: 'ignore_time_windows',
  estimatedDistanceKm: null,
  actualDistanceKm: null,
  totalWeightKg: 0,
  remainingWeightKg: 0,
  totalStops: 3,
  remainingStops: 3,
  startOdometer: null,
  endOdometer: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
  startLocation: endpoint,
  endLocation: endpoint,
  plannedDepartureAt: '2026-09-01T08:00:00.000Z',
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
};

describe('route priority rebuild', () => {
  it('uses the current priority order when generating a fresh route request', () => {
    const stops = [
      stop({ id: 'stop-a', originalOrder: 1, priorityFirst: true, priorityRank: 2 }),
      stop({ id: 'stop-b', originalOrder: 2, priorityFirst: true, priorityRank: 1 }),
      stop({ id: 'stop-c', originalOrder: 3, priorityFirst: false, priorityRank: null }),
    ];

    const request = buildOptimizationRequestFromRoute(route, stops);
    const byId = new Map(request.stops.map((item) => [item.id, item]));

    expect(byId.get('stop-b')?.deliverBeforeStopIds).toEqual(['stop-a']);
    expect(byId.get('stop-b')?.preferEarly).toBe(true);
    expect(byId.get('stop-a')?.preferEarly).toBe(true);
    expect(byId.get('stop-c')?.preferEarly).toBe(false);
    expect(byId.get('stop-b')?.priority).toBeGreaterThan(byId.get('stop-a')?.priority ?? 0);
  });
});
