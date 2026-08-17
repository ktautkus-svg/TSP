import { describe, expect, it, vi } from 'vitest';
import {
  extractOrderedLocationsFromCandidate,
  RoutePolylineService,
} from '../../src/application/routing/route-polyline-service';
import type { RouteCandidate, RouteOptimizationRequest } from '../../src/domain/routing/models';
import type { GoogleRoutesAdapter } from '../../gateway/providers/google-routes-adapter';

function mockOptimizationRequest(): RouteOptimizationRequest {
  const start = { id: 'start', label: 'Startas', latitude: 54.68, longitude: 25.27 };
  const end = { id: 'end', label: 'Pabaiga', latitude: 54.73, longitude: 25.23 };
  return {
    routeId: 'route-1',
    startLocation: start,
    endLocation: end,
    plannedDepartureAt: '2026-08-03T08:00:00.000Z',
    vehicle: {
      id: 'van',
      type: 'van',
      maximumPayloadKg: 1500,
      useRoadRestrictions: false,
      startLocation: start,
      defaultEndLocation: end,
    },
    stops: [
      {
        id: 'stop-1',
        location: { id: 'stop-1', label: 'Stotelė 1', latitude: 54.69, longitude: 25.28 },
        weightKg: 100,
        serviceDurationMinutes: 10,
        priority: 1,
        deliverBeforeStopIds: [],
        deliverAfterStopIds: [],
        preferEarly: false,
        preferLate: false,
        mustBeFirst: false,
        mustBeLast: false,
      },
      {
        id: 'stop-2',
        location: { id: 'stop-2', label: 'Stotelė 2', latitude: 54.71, longitude: 25.30 },
        weightKg: 200,
        serviceDurationMinutes: 15,
        priority: 1,
        deliverBeforeStopIds: [],
        deliverAfterStopIds: [],
        preferEarly: false,
        preferLate: false,
        mustBeFirst: false,
        mustBeLast: false,
      },
    ],
    planningMode: 'with_time_windows',
    scoring: {
      weights: {
        drivingTime: 1,
        totalWorkTime: 1,
        distance: 1,
        tonneKilometers: 1,
        waitingTime: 1,
        informationalTimeMismatch: 1,
        directionality: 1,
        endLocationConvenience: 1,
        maneuvers: 1,
        userPreferences: 1,
        lateness: 1,
      },
      normalizationCaps: {
        drivingTime: 120,
        totalWorkTime: 180,
        distance: 100,
        tonneKilometers: 500,
        waitingTime: 60,
        informationalTimeMismatch: 60,
        directionality: 10,
        endLocationConvenience: 10,
        maneuvers: 10,
        userPreferences: 10,
        lateness: 120,
      },
      tolerances: {
        durationMinutes: 5,
        distanceKm: 2,
        requiredWindowMinutes: 0,
        latenessToleranceMinutes: 15,
        priorityLatenessToleranceMinutes: 5,
        maxDepartureShiftMinutes: 60,
      },
    },
    trafficMode: 'live',
    maxIterations: 100,
    maxCalculationMs: 2000,
    randomSeeds: [42],
  };
}

function mockRouteCandidate(stopSequence: string[]): RouteCandidate {
  return {
    id: 'candidate-1',
    provider: 'Google Routes',
    stopSequence,
    effectiveDepartureAt: '2026-06-15T07:00:00.000Z',
    departureShiftMinutes: 0,
    generatedBy: ['nearest_neighbor'],
    schedules: [],
    legs: [],
    totalDistanceKm: 12.5,
    drivingMinutes: 24,
    serviceMinutes: 25,
    waitingMinutes: 0,
    totalWorkMinutes: 49,
    totalLateMinutes: 0,
    maximumSingleStopLateMinutes: 0,
    tonneKilometers: 15,
    directionalityPenalty: 0,
    maneuverPenalty: 0,
    violations: [],
    feasible: true,
    criticalRank: {
      unservedRequiredStops: 0,
      requiredWindowViolations: 0,
      totalLateMinutes: 0,
      maximumSingleStopLateMinutes: 0,
      workdayOverrunMinutes: 0,
      criticalRoadOrVehicleViolations: 0,
    },
    rawScoreComponents: {
      drivingTime: 24,
      totalWorkTime: 49,
      distance: 12.5,
      tonneKilometers: 15,
      waitingTime: 0,
      informationalTimeMismatch: 0,
      directionality: 0,
      endLocationConvenience: 0,
      maneuvers: 0,
      userPreferences: 0,
      lateness: 0,
    },
    normalizedScoreComponents: {
      drivingTime: 0.2,
      totalWorkTime: 0.27,
      distance: 0.125,
      tonneKilometers: 0.03,
      waitingTime: 0,
      informationalTimeMismatch: 0,
      directionality: 0,
      endLocationConvenience: 0,
      maneuvers: 0,
      userPreferences: 0,
      lateness: 0,
    },
    totalScore: 0.625,
    localSearch: {
      iterations: 5,
      initialSequence: stopSequence,
      initialObjective: 0.7,
      finalObjective: 0.625,
      improvementPercent: 10.7,
      stoppedBy: 'no_improvement',
    },
    warnings: [],
    explanations: [],
  };
}

describe('RoutePolylineService', () => {
  it('extracts ordered stop locations according to optimal stopSequence', () => {
    const request = mockOptimizationRequest();
    const candidate = mockRouteCandidate(['stop-2', 'stop-1']); // Reordered sequence

    const extracted = extractOrderedLocationsFromCandidate(candidate, request);

    expect(extracted.startLocation.id).toBe('start');
    expect(extracted.endLocation.id).toBe('end');
    expect(extracted.orderedStops).toHaveLength(2);
    expect(extracted.orderedStops[0].id).toBe('stop-2');
    expect(extracted.orderedStops[1].id).toBe('stop-1');
  });

  it('delegates to GoogleRoutesAdapter to fetch polyline for candidate', async () => {
    const request = mockOptimizationRequest();
    const candidate = mockRouteCandidate(['stop-2', 'stop-1']);

    const mockAdapter = {
      fetchRoutePolyline: vi.fn(async () => ({
        provider: 'Google Routes',
        executionMode: 'real' as const,
        encodedPolyline: 'mocked_polyline_string',
        distanceMeters: 12500,
        durationSeconds: 1440,
        legs: [],
        warnings: [],
        fetchedAt: new Date().toISOString(),
        version: 'google-compute-routes-v2',
      })),
    } as unknown as GoogleRoutesAdapter;

    const service = new RoutePolylineService(mockAdapter);
    const result = await service.fetchPolylineForCandidate(candidate, request);

    expect(mockAdapter.fetchRoutePolyline).toHaveBeenCalledOnce();
    expect(result.encodedPolyline).toBe('mocked_polyline_string');
    expect(result.distanceMeters).toBe(12500);
  });
});
