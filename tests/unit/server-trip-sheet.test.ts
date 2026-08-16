import { describe, expect, it } from 'vitest';

import { attachDailyCompensation, buildServerTripSheet, tripSheetFuelNorm, type RouteAssignment } from '../../server/employee-auth-store';
import { DEFAULT_ROUTE_PRICE_SETTINGS } from '../../src/application/routes/route-price';

describe('server trip sheet', () => {
  it('builds an accounting-ready sheet from a completed assigned route', () => {
    const assignment: RouteAssignment = {
      id: 'assignment-12345678', routeId: 'route-1', driverId: 'driver-12345678', driverName: 'Vairas 1',
      status: 'completed', progress: null, createdBy: 'admin-12345678',
      assignedAt: '2026-08-12T05:30:00.000Z', updatedAt: '2026-08-12T14:10:00.000Z',
      vehicle: { id: 'LRI744', registrationNumber: 'LRI744', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-1', date: '2026-08-12', status: 'completed', total_stops: 2, total_weight_kg: 350,
          estimated_distance_km: 78.5, actual_distance_km: 81.2, start_odometer: 1000, end_odometer: 1081.2,
          started_at: '2026-08-12T06:00:00.000Z', completed_at: '2026-08-12T14:00:00.000Z',
          start_location_json: JSON.stringify({ originalAddress: 'Savanorių pr. 180, Vilnius' }),
          end_location_json: JSON.stringify({ normalizedAddress: 'Savanorių pr. 180, Vilnius' }),
        },
        stops: [
          { order_number: 'RS608084', delivery_status: 'delivered', weight_kg: 200 },
          { order_number: 'RS608513š', delivery_status: 'failed', weight_kg: 150 },
        ],
        shipmentLines: [
          { route_code: 'R11', order_number: 'RS608084' },
          { route_code: 'R15', order_number: 'RS608513š' },
        ],
      },
    };

    expect(buildServerTripSheet(assignment, assignment.vehicle)).toMatchObject({
      routeNumbers: ['R11', 'R15'], driverName: 'Vairas 1', startOdometer: 1000, endOdometer: 1081.2,
      actualDistanceKm: 81.2, durationMinutes: 480, totalStops: 2, deliveredStops: 1,
      totalWeightKg: 350, deliveredWeightKg: 200, startAddress: 'Savanorių pr. 180, Vilnius',
      fuelNormLitersPer100Km: null,
      vehicle: { registrationNumber: 'LRI744', model: 'Renault Master' },
    });
  });

  it('uses the configured vehicle fuel norm and falls back by payload size', () => {
    expect(tripSheetFuelNorm({ id: 'LRI744', registrationNumber: 'LRI744', model: 'Renault Master', maximumPayloadKg: 1500 }, DEFAULT_ROUTE_PRICE_SETTINGS))
      .toBe(DEFAULT_ROUTE_PRICE_SETTINGS.vehicleCosts.LRI744.fuelNormLitersPer100Km);
    expect(tripSheetFuelNorm({ id: 'XYZ123', registrationNumber: 'XYZ123', model: 'Kitas', maximumPayloadKg: 2500 }, DEFAULT_ROUTE_PRICE_SETTINGS))
      .toBe(DEFAULT_ROUTE_PRICE_SETTINGS.fallbackVehicleCosts.medium.fuelNormLitersPer100Km);
  });

  it('normalizes duplicate route numbers and tolerates missing optional measurements', () => {
    const assignment = {
      id: 'assignment-12345678', routeId: 'route-2', driverId: 'driver-12345678', driverName: 'Vairas 2',
      status: 'completed', progress: null, createdBy: 'admin-12345678', assignedAt: '2026-08-12T05:30:00.000Z',
      updatedAt: '2026-08-12T14:10:00.000Z', vehicle: null,
      routeSnapshot: { route: { id: 'route-2', date: '2026-08-12' }, stops: [
        { order_number: 'RS608084', delivery_status: 'delivered', weight_kg: null },
        { order_number: 'RS608513', delivery_status: 'delivered', weight_kg: 25 },
      ], shipmentLines: [
        { route_code: 'R11', order_number: 'RS608084' },
        { route_code: 'r11', order_number: 'RS608513' },
        { route_code: 'RS608084', order_number: 'RS608084' },
      ] },
    } satisfies RouteAssignment;
    expect(buildServerTripSheet(assignment, null)).toMatchObject({ routeNumbers: ['R11'], actualDistanceKm: null, deliveredWeightKg: 25, vehicle: null });
  });

  it('calculates one fixed daily amount and switches from planned to odometer kilometres', () => {
    const base = buildServerTripSheet({
      id: 'assignment-12345678', routeId: 'route-1', driverId: 'driver-12345678', driverName: 'Vairas',
      status: 'completed', progress: null, createdBy: 'admin', assignedAt: '2026-08-12T05:00:00.000Z', updatedAt: '2026-08-12T10:00:00.000Z', vehicle: null,
      routeSnapshot: { route: { id: 'route-1', date: '2026-08-12', actual_distance_km: 100, total_weight_kg: 1000, total_stops: 10 }, stops: [], shipmentLines: [] },
    }, null);
    const second = { ...base, id: 'trip-sheet-2', assignmentId: 'assignment-2', routeId: 'route-2', actualDistanceKm: null, plannedDistanceKm: 50, totalWeightKg: 500, totalStops: 5, status: 'assigned' as const };
    const [calculated] = attachDailyCompensation([base, second]);
    expect(calculated.compensation).toMatchObject({
      distanceKm: 150, distanceSource: 'planned', weightKg: 1500, stops: 15,
      fixedAmountEur: 23, distanceAmountEur: 7.5, weightAmountEur: 9, stopsAmountEur: 9.75,
      totalNetEur: 49.25, preliminary: true,
    });
  });
});
