import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildRouteCompletionFuelRequest,
  currentRouteCompletionClock,
  persistRouteCompletionFuel,
  resumeRouteCompletionClock,
  routeCompletionClockForOpen,
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
const workdaySource = readFileSync(resolve(import.meta.dirname, '../../src/application/routes/route-workday.ts'), 'utf8');

describe('route completion form', () => {
  it('defaults the date, hour and minute to the current Lithuanian wall clock', () => {
    expect(currentRouteCompletionClock(new Date('2026-09-13T15:42:59.000Z'))).toEqual({
      date: '2026-09-13',
      hour: '18',
      minute: '42',
    });
  });

  it('defaults wall-clock midnight and end-of-day correctly', () => {
    expect(currentRouteCompletionClock(new Date('2026-09-12T21:00:00.000Z'))).toEqual({
      date: '2026-09-13',
      hour: '00',
      minute: '00',
    });
    expect(currentRouteCompletionClock(new Date('2026-09-13T20:59:00.000Z'))).toEqual({
      date: '2026-09-13',
      hour: '23',
      minute: '59',
    });
  });

  it('offers every compact hour and minute value, including 00:00 and 23:59', () => {
    expect(ROUTE_COMPLETION_HOURS).toEqual(Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')));
    expect(ROUTE_COMPLETION_MINUTES).toEqual(Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0')));
    expect(ROUTE_COMPLETION_HOURS[0]).toBe('00');
    expect(ROUTE_COMPLETION_HOURS[23]).toBe('23');
    expect(ROUTE_COMPLETION_MINUTES[0]).toBe('00');
    expect(ROUTE_COMPLETION_MINUTES[59]).toBe('59');
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '00', minute: '00' })).toBe('2026-09-12T21:00:00.000Z');
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '23', minute: '59' })).toBe('2026-09-13T20:59:00.000Z');
  });

  it('rejects free-text or out-of-range hour/minute values', () => {
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '24', minute: '00' })).toBeNull();
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '12', minute: '60' })).toBeNull();
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '9', minute: '05' })).toBeNull();
    expect(routeCompletionTimestamp({ date: '2026-09-13', hour: '09', minute: '5' })).toBeNull();
  });

  it('fills an interrupted/reopened flow without replacing values already edited', () => {
    const now = new Date('2026-09-13T15:42:00.000Z');
    expect(resumeRouteCompletionClock({}, now)).toEqual({ date: '2026-09-13', hour: '18', minute: '42' });
    expect(resumeRouteCompletionClock({ date: '2026-09-12', hour: '07', minute: '05' }, now))
      .toEqual({ date: '2026-09-12', hour: '07', minute: '05' });
  });

  it('never leaves date/hour/minute empty on reopen when prior values are blank or whitespace', () => {
    const now = new Date('2026-09-13T15:42:00.000Z');
    expect(resumeRouteCompletionClock({ date: '  ', hour: '', minute: '\t' }, now))
      .toEqual({ date: '2026-09-13', hour: '18', minute: '42' });
    expect(resumeRouteCompletionClock({ date: '2026-09-10', hour: '  ', minute: '11' }, now))
      .toEqual({ date: '2026-09-10', hour: '18', minute: '11' });
  });

  it('replaces out-of-range hour/minute leftovers on reopen instead of keeping free-text values', () => {
    const now = new Date('2026-09-13T15:42:00.000Z');
    expect(resumeRouteCompletionClock({ date: '2026-09-10', hour: '9', minute: '5' }, now))
      .toEqual({ date: '2026-09-10', hour: '18', minute: '42' });
    expect(resumeRouteCompletionClock({ date: '2026-09-10', hour: '24', minute: '60' }, now))
      .toEqual({ date: '2026-09-10', hour: '18', minute: '42' });
  });

  it('uses live wall clock on a fresh open and preserves edits when resuming', () => {
    const now = new Date('2026-09-13T15:42:00.000Z');
    const stale = { date: '2026-09-12', hour: '08', minute: '15' };
    expect(routeCompletionClockForOpen(false, stale, now)).toEqual({
      date: '2026-09-13',
      hour: '18',
      minute: '42',
    });
    expect(routeCompletionClockForOpen(true, stale, now)).toEqual(stale);
    expect(routeCompletionClockForOpen(true, { date: '', hour: '07', minute: '' }, now)).toEqual({
      date: '2026-09-13',
      hour: '07',
      minute: '42',
    });
  });

  it('refreshes the completion clock on return arrival after a long-running delivery screen', () => {
    const mountedClock = currentRouteCompletionClock(new Date('2026-09-12T06:00:00.000Z'));
    const arrival = new Date('2026-09-13T21:00:00.000Z');
    expect(routeCompletionClockForOpen(false, mountedClock, arrival))
      .toEqual({ date: '2026-09-14', hour: '00', minute: '00' });
    expect(routeCompletionClockForOpen(true, mountedClock, arrival)).toEqual(mountedClock);
    const arrivalHandler = deliverySource.slice(
      deliverySource.indexOf('const confirmReturnArrival ='),
      deliverySource.indexOf('const saveLateStartOdometer ='),
    );
    expect(arrivalHandler).toContain('routeCompletionClockForOpen(');
    expect(arrivalHandler).toContain('Boolean(route?.completionStartedAt)');
    for (const field of ['Date', 'Hour', 'Minute']) {
      expect(arrivalHandler).toContain(`setFinish${field}(clock.${field.toLowerCase()})`);
    }
  });

  it('uses selectors rather than a free-text time field in route completion', () => {
    expect(deliverySource).not.toContain('<TimeInput');
    expect(deliverySource).toContain('testID="finish-time-hour"');
    expect(deliverySource).toContain('testID="finish-time-minute"');
    expect(deliverySource).toContain('options={FINISH_HOUR_OPTIONS}');
    expect(deliverySource).toContain('options={FINISH_MINUTE_OPTIONS}');
    expect(deliverySource).toContain('<FiroSelect');
    expect(deliverySource).toContain('resumeRouteCompletionClock');
    expect(deliverySource).toContain('routeCompletionClockForOpen');
    expect(deliverySource).toContain('alreadyCompleting');
    expect(deliverySource).toContain('useState(() => currentRouteCompletionClock().date)');
    expect(deliverySource).toContain('useState(() => currentRouteCompletionClock().hour)');
    expect(deliverySource).toContain('useState(() => currentRouteCompletionClock().minute)');
  });

  it('does not create fuel data when the explicit answer is NE', async () => {
    expect(buildRouteCompletionFuelRequest({
      choice: 'no', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '99', receiptNumber: 'SHOULD-IGNORE',
    })).toBeNull();
    const save = vi.fn();
    await expect(persistRouteCompletionFuel(null, false, save)).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('builds a TAIP fuel entry from the selected completion timestamp and known odometer', () => {
    expect(buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250.5,
      litersText: '42,75', receiptNumber: '  C-18  ',
    })).toEqual({
      filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250.5, liters: 42.75, receiptNumber: 'C-18',
    });
  });

  it('rejects TAIP fuel when liters are missing or invalid before any save', () => {
    expect(() => buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '', receiptNumber: '',
    })).toThrow('litr');
    expect(() => buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '0', receiptNumber: '',
    })).toThrow('litr');
  });

  it('propagates the selected completion timestamp into fuel filledAt and CompleteRoute actualFinishedAt', () => {
    expect(deliverySource).toContain('filledAt: actualFinishedAt');
    expect(deliverySource).toContain('actualFinishedAt,');
    expect(deliverySource).toContain('routeCompletionTimestamp({');
    expect(deliverySource).toContain('/api/routes/${encodeURIComponent(routeId)}/fuel-entries');
    expect(workdaySource).toContain('actualFinishedAt ?? route.returnArrivedAt ?? now');
    expect(workdaySource).toContain('completed_at = ?');
  });

  it('rejects sub-minimum fuel amounts before rounding and accepts the displayed minimum', () => {
    const input = {
      choice: 'yes' as const, filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '0.001', receiptNumber: '',
    };
    expect(() => buildRouteCompletionFuelRequest(input)).toThrow('litr');
    expect(() => buildRouteCompletionFuelRequest({ ...input, litersText: '0.09' })).toThrow('litr');
    expect(buildRouteCompletionFuelRequest({ ...input, litersText: '0,1' })?.liters).toBe(0.1);
  });

  it('releases the double-submit guard after API failure so a retry can save fuel', async () => {
    const guard = new RouteCompletionSingleFlight();
    const request = buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '40', receiptNumber: '',
    });
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    const submit = () => persistRouteCompletionFuel(request, false, save);
    const failed = guard.run(submit);
    expect(guard.run(submit)).toBe(failed);
    await expect(failed).rejects.toThrow('network');
    await expect(guard.run(submit)).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('keeps historical completed_at semantics when a selected finish time is applied', () => {
    // CompleteRoute writes completed_at from the selected finish clock for the
    // active route only; sibling historical routes are left untouched.
    expect(workdaySource).toContain('WHERE id = ?');
    expect(deliverySource).toContain('new CompleteRoute(db).execute(routeId,');
    expect(deliverySource).toContain('actualFinishedAt,');
  });

  it('opens the local result screen without awaiting server sync after CompleteRoute', () => {
    // Mission critical: a slow/offline trip-sheet push must not block the driver
    // from seeing the completed result already committed to SQLite.
    const finishOnce = deliverySource.slice(
      deliverySource.indexOf('const finishOnce = async'),
      deliverySource.indexOf('const finish = (confirmUnfinished'),
    );
    const completeAt = finishOnce.indexOf('await new CompleteRoute(db).execute');
    const voidPushAt = finishOnce.indexOf('void pushRouteAssignmentProgress(db, routeId)');
    const navigateAt = finishOnce.indexOf("pathname: '/route/[id]/result'");
    expect(completeAt).toBeGreaterThan(-1);
    expect(voidPushAt).toBeGreaterThan(completeAt);
    expect(navigateAt).toBeGreaterThan(voidPushAt);
    expect(finishOnce).not.toContain('await pushRouteAssignmentProgress');
    expect(finishOnce).toContain('void requestSync(\'mutation\')');
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

  it('skips a second fuel write after a successful save on retry', async () => {
    const request = buildRouteCompletionFuelRequest({
      choice: 'yes', filledAt: '2026-09-13T15:42:00.000Z', odometer: 1250,
      litersText: '40', receiptNumber: '',
    });
    const save = vi.fn().mockResolvedValue(undefined);
    await expect(persistRouteCompletionFuel(request, true, save)).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
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

  it('falls back to the completed assignment for the same route after close (retry path)', () => {
    const selected = selectRouteFuelAssignment([
      { id: 'other', routeId: 'route-2', status: 'completed' as const, vehicleId: 'VAN-2' },
      { id: 'closed', routeId: 'route-1', status: 'completed' as const, vehicleId: 'VAN-1' },
    ], 'route-1');
    expect(selected).toMatchObject({ id: 'closed', routeId: 'route-1', vehicleId: 'VAN-1' });
  });

  it('ignores cancelled and pre-start assignments when resolving route fuel', () => {
    expect(selectRouteFuelAssignment([
      { id: 'cancelled', routeId: 'route-1', status: 'cancelled' as const, vehicleId: 'VAN-1' },
      { id: 'assigned', routeId: 'route-1', status: 'assigned' as const, vehicleId: 'VAN-1' },
    ], 'route-1')).toBeUndefined();
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
      fuelEntries: {
        doc: () => ({ create: async (entry: ServerFuelEntry) => { created = entry; } }),
        where: () => ({ get: async () => ({ docs: [] }) }),
      },
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

  it('does not create a second fuel entry when a completion retry resubmits the same fill after a lost response', async () => {
    const assignment: RouteAssignment = {
      id: 'assignment-retry-1234',
      routeId: 'route-retry-1234',
      driverId: 'driver-retry-1234',
      driverName: 'Vairuotojas',
      status: 'in_progress',
      progress: null,
      createdBy: 'admin-retry-1234',
      assignedAt: '2026-09-13T05:00:00.000Z',
      updatedAt: '2026-09-13T15:00:00.000Z',
      vehicle: { id: 'VAN456', registrationNumber: 'VAN456', model: 'Fiat Ducato', maximumPayloadKg: 1500 },
      routeSnapshot: { route: { id: 'route-retry-1234', start_odometer: 1000 }, stops: [], shipmentLines: [] },
    };
    const saved: ServerFuelEntry[] = [];
    const store = new EmployeeAuthStore();
    Object.assign(store as unknown as Record<string, unknown>, {
      assignments: { doc: () => ({ get: async () => ({ data: () => assignment }) }) },
      vehicles: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      vehicleDayReadings: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      fuelEntries: {
        doc: (id: string) => ({
          create: async (entry: ServerFuelEntry) => {
            if (saved.some((item) => item.id === id)) throw Object.assign(new Error('Already exists'), { code: 6 });
            saved.push(entry);
          },
          get: async () => ({ data: () => saved.find((item) => item.id === id) }),
        }),
        where: (field: keyof ServerFuelEntry, _op: '==', value: unknown) => ({
          get: async () => ({
            docs: saved
              .filter((entry) => entry[field] === value)
              .map((entry) => ({ data: () => entry })),
          }),
        }),
      },
    });
    const profile = {
      id: assignment.driverId,
      displayName: assignment.driverName,
      role: 'driver',
      permissions: { canEnterTripReadings: false },
    } as EmployeeProfile;
    const input = { filledAt: '2026-09-13T15:42:00.000Z', odometer: 1075, liters: 42 };

    const [first, concurrent] = await Promise.all([
      store.addFuelEntry(profile, assignment.id, input, 'active_route'),
      store.addFuelEntry(profile, assignment.id, input, 'active_route'),
    ]);
    expect(concurrent).toEqual(first);
    // Client never saw the response (network dropped) and retries the exact
    // same completion submission with identical fields.
    const retry = await store.addFuelEntry(profile, assignment.id, input, 'active_route');
    expect(retry).toEqual(first);
    expect(saved).toHaveLength(1);
    assignment.status = 'completed';
    await expect(store.addFuelEntry(profile, assignment.id, input, 'active_route')).resolves.toEqual(first);
    expect(saved).toHaveLength(1);
    // Independent historical trip-sheet entries must not be silently collapsed.
    await store.addFuelEntry(profile, assignment.id, input);
    await store.addFuelEntry(profile, assignment.id, input);
    expect(saved).toHaveLength(3);
  });

  it('treats a corrected odometer on retry as a distinct completion fill, not a silent reuse', async () => {
    const assignment: RouteAssignment = {
      id: 'assignment-odo-123456',
      routeId: 'route-odo-12345678',
      driverId: 'driver-odo-123456',
      driverName: 'Vairuotojas',
      status: 'in_progress',
      progress: null,
      createdBy: 'admin-odo-123456',
      assignedAt: '2026-09-13T05:00:00.000Z',
      updatedAt: '2026-09-13T15:00:00.000Z',
      vehicle: { id: 'VAN789', registrationNumber: 'VAN789', model: 'Fiat Ducato', maximumPayloadKg: 1500 },
      routeSnapshot: { route: { id: 'route-odo-12345678', start_odometer: 1000 }, stops: [], shipmentLines: [] },
    };
    const saved: ServerFuelEntry[] = [];
    const store = new EmployeeAuthStore();
    Object.assign(store as unknown as Record<string, unknown>, {
      assignments: { doc: () => ({ get: async () => ({ data: () => assignment }) }) },
      vehicles: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      vehicleDayReadings: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      fuelEntries: {
        doc: (id: string) => ({
          create: async (entry: ServerFuelEntry) => {
            if (saved.some((item) => item.id === id)) throw Object.assign(new Error('Already exists'), { code: 6 });
            saved.push(entry);
          },
          get: async () => ({ data: () => saved.find((item) => item.id === id) }),
        }),
        where: () => ({ get: async () => ({ docs: [] }) }),
      },
    });
    const profile = {
      id: assignment.driverId,
      displayName: assignment.driverName,
      role: 'driver',
      permissions: { canEnterTripReadings: false },
    } as EmployeeProfile;
    const base = { filledAt: '2026-09-13T15:42:00.000Z', liters: 42 };
    const first = await store.addFuelEntry(profile, assignment.id, { ...base, odometer: 1075 }, 'active_route');
    const corrected = await store.addFuelEntry(profile, assignment.id, { ...base, odometer: 1100 }, 'active_route');
    expect(corrected.id).not.toBe(first.id);
    expect(corrected.odometer).toBe(1100);
    expect(saved).toHaveLength(2);
    expect(storeSource).toContain('roundedOdometer');
  });

  it('rejects completion fuel amounts below 0.1 L that would previously round toward zero', async () => {
    const assignment: RouteAssignment = {
      id: 'assignment-min-123456',
      routeId: 'route-min-12345678',
      driverId: 'driver-min-123456',
      driverName: 'Vairuotojas',
      status: 'in_progress',
      progress: null,
      createdBy: 'admin-min-123456',
      assignedAt: '2026-09-13T05:00:00.000Z',
      updatedAt: '2026-09-13T15:00:00.000Z',
      vehicle: { id: 'VAN321', registrationNumber: 'VAN321', model: 'Fiat Ducato', maximumPayloadKg: 1500 },
      routeSnapshot: { route: { id: 'route-min-12345678', start_odometer: 1000 }, stops: [], shipmentLines: [] },
    };
    const store = new EmployeeAuthStore();
    Object.assign(store as unknown as Record<string, unknown>, {
      assignments: { doc: () => ({ get: async () => ({ data: () => assignment }) }) },
      vehicles: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      vehicleDayReadings: { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      fuelEntries: { doc: () => ({ create: async () => undefined }), where: () => ({ get: async () => ({ docs: [] }) }) },
    });
    const profile = {
      id: assignment.driverId,
      displayName: assignment.driverName,
      role: 'driver',
      permissions: { canEnterTripReadings: false },
    } as EmployeeProfile;
    await expect(store.addFuelEntry(profile, assignment.id, {
      filledAt: '2026-09-13T15:42:00.000Z', odometer: 1075, liters: 0.09,
    }, 'active_route')).rejects.toMatchObject({ code: 'INVALID_FUEL_AMOUNT' });
    await expect(store.addFuelEntry(profile, assignment.id, {
      filledAt: '2026-09-13T15:42:00.000Z', odometer: 1075, liters: 0.004,
    }, 'active_route')).rejects.toMatchObject({ code: 'INVALID_FUEL_AMOUNT' });
  });

  it('routes active fuel through the existing addFuelEntry path without weakening trip-sheet rules', () => {
    expect(apiSource).toContain('selectRouteFuelAssignment(await store.listAssignments(profile), routeId)');
    expect(apiSource).toContain("}, 'active_route');");
    expect(storeSource).toContain("context: FuelEntryAssignmentContext = 'trip_sheet'");
    expect(storeSource).toContain('canAddFuelEntryToAssignment(assignment.status, context)');
  });
});
