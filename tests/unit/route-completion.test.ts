import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildRouteCompletionFuelRequest,
  currentRouteCompletionClock,
  persistRouteCompletionFuel,
  resumeRouteCompletionClock,
  routeCompletionTimestamp,
  ROUTE_COMPLETION_HOURS,
  ROUTE_COMPLETION_MINUTES,
  RouteCompletionSingleFlight,
} from '../../src/application/routes/route-completion-form';
import {
  canAddFuelEntryToAssignment,
  selectRouteFuelAssignment,
} from '../../src/domain/fuel-entry-assignment';
import { EmployeeAuthStore, type EmployeeProfile, type RouteAssignment, type ServerFuelEntry } from '../../server/employee-auth-store';

const deliverySource = readFileSync(resolve(import.meta.dirname, '../../src/app/route/[id]/delivery.tsx'), 'utf8');
const apiSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
const storeSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');

describe('route completion form', () => {
  it('defaults the date, hour and minute to the current Lithuanian wall clock', () => {
    expect(currentRouteCompletionClock(new Date('2026-09-13T15:42:59.000Z'))).toEqual({
      date: '2026-09-13',
      hour: '18',
      minute: '42',
    });
  });

  it('offers every compact hour and minute value, including 00:00 and 23:59', () => {
    expect(ROUTE_COMPLETION_HOURS).toEqual(Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')));
    expect(ROUTE_COMPLETION_MINUTES).toEqual(Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0')));
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '00', minute: '00' })).toBe('2026-09-12T21:00:00.000Z');
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '23', minute: '59' })).toBe('2026-09-13T20:59:00.000Z');
  });

  it('fills an interrupted/reopened flow without replacing values already edited', () => {
    const now = new Date('2026-09-13T15:42:00.000Z');
    expect(resumeRouteCompletionClock({}, now)).toEqual({ date: '2026-09-13', hour: '18', minute: '42' });
    expect(resumeRouteCompletionClock({ date: '2026-09-12', hour: '07', minute: '05' }, now))
      .toEqual({ date: '2026-09-12', hour: '07', minute: '05' });
  });

  it('uses selectors rather than a free-text time field in route completion', () => {
    expect(deliverySource).not.toContain('<TimeInput');
    expect(deliverySource).toContain('testID="finish-time-hour"');
    expect(deliverySource).toContain('testID="finish-time-minute"');
    expect(deliverySource).toContain('options={FINISH_HOUR_OPTIONS}');
    expect(deliverySource).toContain('options={FINISH_MINUTE_OPTIONS}');
  });

  it('does not create fuel data when the explicit answer is NE', () => {
    expect(buildRouteCompletionFuelRequest({
      choice: 'no', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '', receiptNumber: '',
    })).toBeNull();
  });

  it('builds a TAIP fuel entry from the selected completion timestamp and known odometer', () => {
    expect(buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250.5,
      litersText: '42,75', receiptNumber: '  C-18  ',
    })).toEqual({
      filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250.5, liters: 42.75, receiptNumber: 'C-18',
    });
  });

  it('stops before route completion when the existing fuel API fails', async () => {
    const request = buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '40', receiptNumber: '',
    });
    const save = vi.fn().mockRejectedValue(new Error('network'));
    await expect(persistRouteCompletionFuel(request, false, save)).rejects.toThrow('network');
    expect(save).toHaveBeenCalledOnce();
    expect(deliverySource.indexOf('const saved = await persistRouteCompletionFuel'))
      .toBeLessThan(deliverySource.indexOf('const result = await new CompleteRoute'));
  });

  it('coalesces a double submit into one completion operation', async () => {
    const guard = new RouteCompletionSingleFlight();
    let release!: (value: string) => void;
    const operation = vi.fn(() => new Promise<string>((resolvePromise) => { release = resolvePromise; }));
    const first = guard.run(operation);
    const second = guard.run(operation);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledOnce();
    release('completed');
    await expect(first).resolves.toBe('completed');
  });

  it('requires an explicit TAIP or NE answer', () => {
    expect(() => buildRouteCompletionFuelRequest({
      choice: null, filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '', receiptNumber: '',
    })).toThrow('Pasirinkite');
    expect(deliverySource).toContain('Ar pilta kuro?');
    expect(deliverySource).toContain('testID="completion-fuel-yes"');
    expect(deliverySource).toContain('testID="completion-fuel-no"');
  });
});

describe('route fuel assignment integrity', () => {
  it('accepts an in-progress assignment only for the route-scoped flow', () => {
    expect(canAddFuelEntryToAssignment('in_progress', 'active_route')).toBe(true);
    expect(canAddFuelEntryToAssignment('in_progress', 'trip_sheet')).toBe(false);
    expect(canAddFuelEntryToAssignment('completed', 'trip_sheet')).toBe(true);
    expect(canAddFuelEntryToAssignment('assigned', 'active_route')).toBe(false);
    expect(canAddFuelEntryToAssignment('downloaded', 'active_route')).toBe(false);
    expect(canAddFuelEntryToAssignment('cancelled', 'active_route')).toBe(false);
  });

  it('keeps the selected route associated with its own assignment and vehicle', () => {
    const selected = selectRouteFuelAssignment([
      { id: 'other', routeId: 'route-2', status: 'in_progress' as const, vehicleId: 'VAN-2' },
      { id: 'historical', routeId: 'route-1', status: 'completed' as const, vehicleId: 'OLD-VAN' },
      { id: 'active', routeId: 'route-1', status: 'in_progress' as const, vehicleId: 'VAN-1' },
    ], 'route-1');
    expect(selected).toMatchObject({ id: 'active', routeId: 'route-1', vehicleId: 'VAN-1' });
  });

  it('reproduces the old active-assignment rejection and stores the route fill after the scoped fix', async () => {
    const assignment: RouteAssignment = {
      id: 'assignment-12345678',
      routeId: 'route-12345678',
      driverId: 'driver-12345678',
      driverName: 'Vairuotojas',
      status: 'in_progress',
      progress: null,
      createdBy: 'admin-12345678',
      assignedAt: '2026-09-13T05:00:00.000Z',
      updatedAt: '2026-09-13T15:00:00.000Z',
      vehicle: { id: 'VAN123', registrationNumber: 'VAN123', model: 'Fiat Ducato', maximumPayloadKg: 1500 },
      routeSnapshot: { route: { id: 'route-12345678', start_odometer: 1000 }, stops: [], shipmentLines: [] },
    };
    let created: ServerFuelEntry | null = null;
    const store = new EmployeeAuthStore();
    Object.assign(store as unknown as Record<string, unknown>, {
      assignments: { doc: () => ({ get: async () => ({ data: () => assignment }) }) },
      vehicles: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      vehicleDayReadings: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      fuelEntries: { doc: () => ({ create: async (entry: ServerFuelEntry) => { created = entry; } }) },
    });
    const profile = {
      id: assignment.driverId,
      displayName: assignment.driverName,
      role: 'driver',
      permissions: { canEnterTripReadings: false },
    } as EmployeeProfile;
    const input = { filledAt: '2026-09-13T15:42:00.000Z', odometer: 1075, liters: 42 };

    await expect(store.addFuelEntry(profile, assignment.id, input)).rejects.toMatchObject({ code: 'TRIP_SHEET_NOT_FOUND' });
    await expect(store.addFuelEntry(profile, assignment.id, input, 'active_route')).resolves.toMatchObject({
      assignmentId: assignment.id,
      routeId: assignment.routeId,
      vehicleId: assignment.vehicle?.id,
      filledAt: input.filledAt,
      odometer: input.odometer,
      liters: input.liters,
    });
    expect(created).toMatchObject({ assignmentId: assignment.id, routeId: assignment.routeId, vehicleId: 'VAN123' });
  });

  it('routes active fuel through the existing addFuelEntry path without weakening trip-sheet rules', () => {
    expect(apiSource).toContain('selectRouteFuelAssignment(await store.listAssignments(profile), routeId)');
    expect(apiSource).toContain("}, 'active_route');");
    expect(storeSource).toContain("context: FuelEntryAssignmentContext = 'trip_sheet'");
    expect(storeSource).toContain('canAddFuelEntryToAssignment(assignment.status, context)');
  });
});
