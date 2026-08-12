import { describe, expect, it } from 'vitest';

import { buildServerTripSheet, type RouteAssignment } from '../../server/employee-auth-store';

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
          { order_number: '11', delivery_status: 'delivered', weight_kg: 200 },
          { order_number: 'R15', delivery_status: 'failed', weight_kg: 150 },
        ],
        shipmentLines: [],
      },
    };

    expect(buildServerTripSheet(assignment, assignment.vehicle)).toMatchObject({
      routeNumbers: ['R11', 'R15'], driverName: 'Vairas 1', startOdometer: 1000, endOdometer: 1081.2,
      actualDistanceKm: 81.2, durationMinutes: 480, totalStops: 2, deliveredStops: 1,
      totalWeightKg: 350, deliveredWeightKg: 200, startAddress: 'Savanorių pr. 180, Vilnius',
      vehicle: { registrationNumber: 'LRI744', model: 'Renault Master' },
    });
  });

  it('normalizes duplicate route numbers and tolerates missing optional measurements', () => {
    const assignment = {
      id: 'assignment-12345678', routeId: 'route-2', driverId: 'driver-12345678', driverName: 'Vairas 2',
      status: 'completed', progress: null, createdBy: 'admin-12345678', assignedAt: '2026-08-12T05:30:00.000Z',
      updatedAt: '2026-08-12T14:10:00.000Z', vehicle: null,
      routeSnapshot: { route: { id: 'route-2', date: '2026-08-12' }, stops: [
        { order_number: '11', delivery_status: 'delivered', weight_kg: null },
        { order_number: 'R11', delivery_status: 'delivered', weight_kg: 25 },
      ], shipmentLines: [] },
    } satisfies RouteAssignment;
    expect(buildServerTripSheet(assignment, null)).toMatchObject({ routeNumbers: ['R11'], actualDistanceKm: null, deliveredWeightKg: 25, vehicle: null });
  });
});
