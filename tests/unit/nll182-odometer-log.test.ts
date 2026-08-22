import { describe, expect, it } from 'vitest';

import {
  NLL182_ODOMETER_LOG,
  odometerDistanceKm,
  parseVehicleDayAssignmentId,
  vehicleDayAssignmentId,
} from '../../src/domain/nll182-odometer-log';

describe('NLL182 GPS odometer log', () => {
  it('covers each day from 2026-08-01 to 2026-08-22 and totals 5398 km', () => {
    expect(NLL182_ODOMETER_LOG).toHaveLength(22);
    expect(NLL182_ODOMETER_LOG[0]).toEqual({ date: '2026-08-01', startOdometer: 274885, endOdometer: 274885 });
    expect(NLL182_ODOMETER_LOG.at(-1)).toEqual({ date: '2026-08-22', startOdometer: 280283, endOdometer: 280283 });
    expect(NLL182_ODOMETER_LOG.reduce((sum, day) => sum + odometerDistanceKm(day.startOdometer, day.endOdometer), 0)).toBe(5398);
    for (let index = 1; index < NLL182_ODOMETER_LOG.length; index += 1) {
      expect(NLL182_ODOMETER_LOG[index]!.startOdometer).toBe(NLL182_ODOMETER_LOG[index - 1]!.endOdometer);
    }
  });

  it('calculates travelled kilometres from start and end odometer readings', () => {
    expect(odometerDistanceKm(274885, 275524)).toBe(639);
    expect(odometerDistanceKm(275524, 275524)).toBe(0);
    const assignmentId = vehicleDayAssignmentId('vehicle-nll182', '2026-08-07');
    expect(assignmentId).toBe('vehicle-day-vehicle-nll182-2026-08-07');
    expect(parseVehicleDayAssignmentId(assignmentId)).toEqual({ vehicleId: 'vehicle-nll182', date: '2026-08-07' });
    expect(parseVehicleDayAssignmentId('assignment-123')).toBeNull();
  });
});
