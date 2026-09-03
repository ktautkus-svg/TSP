import { describe, expect, it } from 'vitest';

import {
  applyAdminAssignmentComplete,
  HistoricalCompleteError,
  historicalStopDeliveredAt,
  resolveAdminCompleteTimestamps,
} from '../../src/domain/historical-assignment-complete';
import { completionPunctuality, lithuanianDateKey } from '../../src/domain/lithuanian-time';
import {
  buildServerTripSheet,
  tripSheetWorkDate,
  type RouteAssignment,
} from '../../server/employee-auth-store';

const NOW = '2026-09-03T07:15:00.000Z';
const AUG3_START = '2026-08-03T06:00:00.000+03:00';
const AUG3_END = '2026-08-03T16:30:00.000+03:00';

function assignmentFromComplete(
  snapshot: { route: Record<string, unknown>; stops: Record<string, unknown>[] },
  result: ReturnType<typeof applyAdminAssignmentComplete>,
): RouteAssignment {
  return {
    id: 'assignment-aug3-backfill',
    routeId: 'route-1788407220642-xh5w5ldr',
    driverId: 'driver-karolis',
    driverName: 'Karolis',
    status: 'completed',
    progress: result.progress,
    createdBy: 'admin',
    assignedAt: '2026-09-03T06:00:00.000Z',
    updatedAt: result.updatedAt,
    vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
    routeSnapshot: {
      route: result.route,
      stops: result.stops,
      shipmentLines: [{ route_code: 'R11', order_number: 'RS1' }],
    },
  };
}

describe('admin historical assignment complete', () => {
  it('keeps a same-day complete on today when timestamps are omitted', () => {
    const result = applyAdminAssignmentComplete({
      route: { id: 'route-today', date: '2026-08-03', status: 'assigned', total_stops: 2 },
      stops: [
        { id: 's1', delivery_status: 'pending', delivery_time_from: '08:00', delivery_time_to: '17:00' },
        { id: 's2', delivery_status: 'pending', delivery_time_from: '08:00', delivery_time_to: '17:00' },
      ],
    }, {}, NOW);

    expect(result.startedAt).toBeNull();
    expect(result.completedAt).toBe(NOW);
    expect(result.stops.every((stop) => stop.delivery_status === 'pending')).toBe(true);
    expect(result.summary).toMatchObject({ deliveredStops: 0, unmarkedStops: 2 });
    expect(tripSheetWorkDate(assignmentFromComplete({ route: {}, stops: [] }, result))).toBe('2026-09-03');
  });

  it('lists the completed trip sheet under 2026-08-03 when admin supplies Aug 3 LT timestamps', () => {
    const snapshot = {
      route: {
        id: 'route-1788407220642-xh5w5ldr',
        date: '2026-08-03',
        status: 'assigned',
        total_stops: 22,
        estimated_duration_minutes: 480,
      },
      stops: Array.from({ length: 22 }, (_, index) => ({
        id: `stop-${index + 1}`,
        delivery_status: 'pending',
        delivery_time_from: index < 11 ? '08:00' : '12:00',
        delivery_time_to: index < 11 ? '12:00' : '17:00',
        weight_kg: 20,
        latitude: 54.68,
        longitude: 25.27,
      })),
    };

    const result = applyAdminAssignmentComplete(snapshot, {
      startedAt: AUG3_START,
      completedAt: AUG3_END,
      markAllDelivered: true,
    }, NOW);

    expect(lithuanianDateKey(result.startedAt ?? '')).toBe('2026-08-03');
    expect(lithuanianDateKey(result.completedAt)).toBe('2026-08-03');
    expect(result.stops).toHaveLength(22);
    expect(result.stops.every((stop) => stop.delivery_status === 'delivered')).toBe(true);
    expect(result.stops.every((stop) => stop.latitude === 54.68 && stop.longitude === 25.27)).toBe(true);
    expect(result.summary).toMatchObject({
      deliveredStops: 22,
      failedStops: 0,
      unmarkedStops: 0,
      onTimeStops: 22,
      lateStops: 0,
      actualDurationMinutes: 630,
    });

    for (const stop of result.stops) {
      expect(lithuanianDateKey(String(stop.delivered_at))).toBe('2026-08-03');
      expect(completionPunctuality({
        deliveredAt: String(stop.delivered_at),
        deliveryTimeFrom: String(stop.delivery_time_from),
        deliveryTimeTo: String(stop.delivery_time_to),
      })).toBe('on_time');
    }

    const sheet = buildServerTripSheet(assignmentFromComplete(snapshot, result), {
      id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500,
    });
    expect(sheet.date).toBe('2026-08-03');
    expect(sheet.deliveredStops).toBe(22);
    expect(sheet.startedAt).toBe(new Date(AUG3_START).toISOString());
    expect(sheet.completedAt).toBe(new Date(AUG3_END).toISOString());
  });

  it('keeps existing delivered_at and windows when backfilling the rest', () => {
    const existing = '2026-08-03T09:15:00.000+03:00';
    const result = applyAdminAssignmentComplete({
      route: { id: 'route-mix', date: '2026-08-03', status: 'assigned' },
      stops: [
        { id: 'kept', delivery_status: 'delivered', delivered_at: existing, delivery_time_from: '08:00', delivery_time_to: '12:00' },
        { id: 'failed', delivery_status: 'failed', failure_reason: 'closed', delivery_time_from: '10:00', delivery_time_to: '16:00' },
        { id: 'pending', delivery_status: 'pending', delivery_time_from: '13:00', delivery_time_to: '17:00' },
      ],
    }, { startedAt: AUG3_START, completedAt: AUG3_END, markAllDelivered: true }, NOW);

    expect(result.stops[0]?.delivered_at).toBe(existing);
    expect(result.stops[1]).toMatchObject({ delivery_status: 'delivered', failure_reason: null });
    expect(result.stops[2]?.delivery_status).toBe('delivered');
    expect(result.stops[1]?.delivery_time_from).toBe('10:00');
    expect(result.stops[2]?.delivery_time_to).toBe('17:00');
  });

  it('uses planned arrival clock on the work day when a stop has no window', () => {
    const deliveredAt = historicalStopDeliveredAt(
      { planned_arrival_at: '2026-08-24T10:15:00.000+03:00' },
      new Date(AUG3_START).toISOString(),
      new Date(AUG3_END).toISOString(),
    );
    expect(lithuanianDateKey(deliveredAt)).toBe('2026-08-03');
    expect(completionPunctuality({
      deliveredAt,
      plannedArrivalAt: deliveredAt,
    })).toBe('on_time');
  });

  it('rejects invalid, inverted, and future timestamps', () => {
    expect(() => resolveAdminCompleteTimestamps({ startedAt: 'not-a-date' }, null, NOW))
      .toThrow(HistoricalCompleteError);
    expect(() => resolveAdminCompleteTimestamps({ startedAt: AUG3_END, completedAt: AUG3_START }, null, NOW))
      .toThrow(/Pradžios laikas/);
    expect(() => resolveAdminCompleteTimestamps({ completedAt: '2026-09-04T00:00:00.000Z' }, null, NOW))
      .toThrow(/ateityje/);
  });

  it('overrides a mistaken live started_at when admin supplies historical startedAt', () => {
    const result = applyAdminAssignmentComplete({
      route: {
        id: 'route-started-today',
        date: '2026-08-03',
        status: 'in_progress',
        started_at: NOW,
      },
      stops: [{ id: 's1', delivery_status: 'pending', delivery_time_from: '08:00', delivery_time_to: '17:00' }],
    }, { startedAt: AUG3_START, completedAt: AUG3_END }, NOW);
    expect(lithuanianDateKey(result.startedAt ?? '')).toBe('2026-08-03');
    expect(tripSheetWorkDate(assignmentFromComplete({ route: {}, stops: [] }, result))).toBe('2026-08-03');
  });

  it('still lands on August 3 when only completedAt is supplied', () => {
    const result = applyAdminAssignmentComplete({
      route: { id: 'route-complete-only', date: '2026-08-03', status: 'assigned' },
      stops: [{ id: 's1', delivery_status: 'pending' }],
    }, { completedAt: AUG3_END }, NOW);
    expect(result.startedAt).toBeNull();
    expect(tripSheetWorkDate(assignmentFromComplete({ route: {}, stops: [] }, result))).toBe('2026-08-03');
  });
});
