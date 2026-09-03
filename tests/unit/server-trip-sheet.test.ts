import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { attachDailyCompensation, applyDayReading, applyTripSheetCorrectionToDayReading, applyTripSheetDriverCorrectionToDayReading, applyTripSheetVehicleDriverCorrection, buildFuelDayTripSheet, buildServerTripSheet, buildVehicleDayTripSheet, listedTripSheetDriver, odometerReadingCoveredBySheet, tripSheetFuelNorm, tripSheetWorkDate, type RouteAssignment, type VehicleDayReading } from '../../server/employee-auth-store';
import { DEFAULT_ROUTE_PRICE_SETTINGS } from '../../src/application/routes/route-price';

const storeSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
const vehicleSource = readFileSync(resolve(import.meta.dirname, '../../src/app/vehicle.tsx'), 'utf8');

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

  it('uses the actual Lithuanian workday instead of a stale planned route date', () => {
    const assignment = {
      id: 'assignment-workday', routeId: 'route-workday', driverId: 'driver-1', driverName: 'Vairas',
      status: 'completed', progress: null, createdBy: 'admin', assignedAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-21T18:00:00.000Z', vehicle: null,
      routeSnapshot: {
        route: {
          id: 'route-workday', date: '2026-08-24', status: 'completed',
          // 21:30 UTC is already the next calendar day in Lithuania (+03).
          started_at: '2026-08-20T21:30:00.000Z', completed_at: '2026-08-21T12:00:00.000Z',
        },
        stops: [], shipmentLines: [],
      },
    } satisfies RouteAssignment;
    expect(tripSheetWorkDate(assignment)).toBe('2026-08-21');
    expect(buildServerTripSheet(assignment, null).date).toBe('2026-08-21');
  });

  it('keeps the planned day while a route has not started', () => {
    const assignment = {
      id: 'assignment-planned', routeId: 'route-planned', driverId: 'driver-1', driverName: 'Vairas',
      status: 'assigned', progress: null, createdBy: 'admin', assignedAt: '2026-08-20T08:00:00.000Z',
      updatedAt: '2026-08-20T08:00:00.000Z', vehicle: null,
      routeSnapshot: { route: { id: 'route-planned', date: '2026-08-24', status: 'planned' }, stops: [], shipmentLines: [] },
    } satisfies RouteAssignment;
    expect(tripSheetWorkDate(assignment)).toBe('2026-08-24');
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

  it('overlays GPS day readings onto a completed assignment and synthesizes days without a route', () => {
    const assignment: RouteAssignment = {
      id: 'assignment-nll', routeId: 'route-nll', driverId: 'driver-jevgenij', driverName: 'Jevgenij Finevičius',
      status: 'completed', progress: null, createdBy: 'admin', assignedAt: '2026-08-07T05:00:00.000Z',
      updatedAt: '2026-08-07T18:00:00.000Z',
      vehicle: { id: 'nll182', registrationNumber: 'NLL182', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: { id: 'route-nll', date: '2026-08-07', status: 'completed', actual_distance_km: 12, start_odometer: 1, end_odometer: 13 },
        stops: [],
        shipmentLines: [],
      },
    };
    const reading: VehicleDayReading = {
      id: 'nll182:2026-08-07', vehicleId: 'nll182', registrationNumber: 'NLL182', date: '2026-08-07',
      startOdometer: 274885, endOdometer: 275524, distanceKm: 639, driverId: 'driver-jevgenij',
      driverName: 'Jevgenij Finevičius', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
      createdBy: 'gps-import',
    };
    const sheet = applyDayReading(buildServerTripSheet(assignment, assignment.vehicle), [reading]);
    expect(sheet).toMatchObject({ startOdometer: 274885, endOdometer: 275524, actualDistanceKm: 639 });
    expect(buildVehicleDayTripSheet({ ...reading, date: '2026-08-01', startOdometer: 274885, endOdometer: 274885, distanceKm: 0 }, assignment.vehicle)).toMatchObject({
      assignmentId: 'vehicle-day-nll182-2026-08-01',
      date: '2026-08-01',
      startOdometer: 274885,
      endOdometer: 274885,
      actualDistanceKm: 0,
      fuelEntries: [],
    });
  });

  it('does not hide a different vehicle’s day reading inside another van’s odometer span', () => {
    const route = {
      ...buildVehicleDayTripSheet({
        id: 'met:2026-08-31', vehicleId: 'MET630', registrationNumber: 'MET630', date: '2026-08-31',
        startOdometer: 283151, endOdometer: 283451, distanceKm: 300, driverId: 'driver-1', driverName: 'Karolis',
        createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z', createdBy: 'admin',
      }, { id: 'MET630', registrationNumber: 'MET630', model: 'Renault', maximumPayloadKg: 1200 }),
      driverId: 'driver-1',
    };
    const nll182Day: VehicleDayReading = {
      id: 'NLL182:2026-08-31', vehicleId: 'NLL182', registrationNumber: 'NLL182', date: '2026-08-31',
      startOdometer: 283151, endOdometer: 283165, distanceKm: 14, driverId: 'driver-1', driverName: 'Karolis',
      createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z', createdBy: 'import',
    };
    expect(odometerReadingCoveredBySheet(nll182Day, [route])).toBe(false);
    expect(odometerReadingCoveredBySheet(nll182Day, [{ ...route, vehicle: { id: 'NLL182', registrationNumber: 'NLL182', model: 'Renault', maximumPayloadKg: 1200 } }])).toBe(true);
    expect(odometerReadingCoveredBySheet({ ...nll182Day, driverId: 'driver-2' }, [route])).toBe(false);
    const [paidDay] = attachDailyCompensation([{ ...route, totalWeightKg: 2654.636, totalStops: 11 }]);
    expect(paidDay.compensation).toMatchObject({ distanceKm: 300, totalNetEur: 61.08 });
  });

  it('synthesizes a fuel-only day without inventing GPS kilometres', () => {
    expect(buildFuelDayTripSheet({
      vehicleId: 'MET630',
      date: '2026-08-04',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      driverId: null,
      driverName: null,
    })).toMatchObject({
      assignmentId: 'vehicle-day-MET630-2026-08-04',
      date: '2026-08-04',
      startOdometer: null,
      endOdometer: null,
      actualDistanceKm: null,
      startAddress: 'Kuro pylimas',
      driverName: 'Nepriskirtas',
      fuelEntries: [],
    });
  });

  it('keeps a covering day reading in sync when the assignment trip sheet is corrected', () => {
    // applyDayReading always lets a day reading's driver/odometer win over
    // the assignment's — so editing the driver via updateTripSheet (the
    // "pencil" edit on an assignment-backed row) used to look like it did
    // nothing: the next read re-applied the reading's stale driver on top.
    expect(storeSource).toContain('const readingDocument = await this.vehicleDayReadings.doc(readingId).get()');
    expect(storeSource).toContain('applyTripSheetCorrectionToDayReading');
    expect(storeSource).toContain('vehicleDayReadingDocId(sheetVehicle.id, date)');
  });

  it('changes the assignment vehicle snapshot without rewriting stop punctuality', () => {
    const stops = [
      {
        order_number: 'RS608084',
        delivery_status: 'delivered',
        delivered_at: '2026-08-14T08:12:00.000Z',
        delivery_time_from: '08:00',
        delivery_time_to: '10:00',
        weight_kg: 200,
      },
      {
        order_number: 'RS608513',
        delivery_status: 'delivered',
        delivered_at: '2026-08-14T11:40:00.000Z',
        delivery_time_from: '10:00',
        delivery_time_to: '11:00',
        weight_kg: 150,
      },
    ];
    const shipmentLines = [
      { route_code: 'R11', order_number: 'RS608084' },
      { route_code: 'R15', order_number: 'RS608513' },
    ];
    const assignment: RouteAssignment = {
      id: '13e4dc49-23fd-475b-9439-de3a4102607d',
      routeId: 'route-14',
      driverId: 'driver-wrong',
      driverName: 'Vairas 1',
      status: 'completed',
      progress: null,
      createdBy: 'admin',
      assignedAt: '2026-08-14T05:00:00.000Z',
      updatedAt: '2026-08-14T16:00:00.000Z',
      vehicle: { id: 'NLL182', registrationNumber: 'NLL182', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-14',
          date: '2026-08-14',
          status: 'completed',
          start_odometer: 277012,
          end_odometer: 277514,
          actual_distance_km: 502,
          started_at: '2026-08-14T05:30:00.000Z',
          completed_at: '2026-08-14T15:00:00.000Z',
        },
        stops,
        shipmentLines,
      },
    };

    const updated = applyTripSheetVehicleDriverCorrection(assignment, {
      startOdometer: 277012,
      endOdometer: 277514,
      driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      updatedAt: '2026-09-03T08:00:00.000Z',
    });

    expect(updated.vehicle).toMatchObject({ id: 'MET630', registrationNumber: 'MET630' });
    expect(updated.driverId).toBe('a7bce619-ad14-4dda-9780-f130a79ab998');
    expect(updated.driverName).toBe('Karolis Tautkus');
    expect(updated.routeSnapshot.stops).toBe(stops);
    expect(updated.routeSnapshot.shipmentLines).toBe(shipmentLines);
    expect(updated.routeSnapshot.stops).toEqual([
      {
        order_number: 'RS608084',
        delivery_status: 'delivered',
        delivered_at: '2026-08-14T08:12:00.000Z',
        delivery_time_from: '08:00',
        delivery_time_to: '10:00',
        weight_kg: 200,
      },
      {
        order_number: 'RS608513',
        delivery_status: 'delivered',
        delivered_at: '2026-08-14T11:40:00.000Z',
        delivery_time_from: '10:00',
        delivery_time_to: '11:00',
        weight_kg: 150,
      },
    ]);
    expect(buildServerTripSheet(updated, updated.vehicle).routeNumbers).toEqual(['R11', 'R15']);

    const previousVehicleReading: VehicleDayReading = {
      id: 'NLL182:2026-08-14',
      vehicleId: 'NLL182',
      registrationNumber: 'NLL182',
      date: '2026-08-14',
      startOdometer: 1,
      endOdometer: 2,
      distanceKm: 1,
      driverId: 'driver-wrong',
      driverName: 'Vairas 1',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      createdBy: 'gps-import',
    };
    const newVehicleReading: VehicleDayReading = {
      id: 'MET630:2026-08-14',
      vehicleId: 'MET630',
      registrationNumber: 'MET630',
      date: '2026-08-14',
      startOdometer: 10,
      endOdometer: 20,
      distanceKm: 10,
      driverId: 'stale-driver',
      driverName: 'Stale',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      createdBy: 'gps-import',
    };
    const synced = applyTripSheetCorrectionToDayReading(newVehicleReading, {
      startOdometer: 277012,
      endOdometer: 277514,
      driverId: updated.driverId,
      driverName: updated.driverName,
      updatedAt: updated.updatedAt,
    });
    expect(synced).toMatchObject({
      vehicleId: 'MET630',
      driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus',
      startOdometer: 277012,
      endOdometer: 277514,
      distanceKm: 502,
    });
    expect(previousVehicleReading.driverId).toBe('driver-wrong');
    expect(previousVehicleReading.vehicleId).toBe('NLL182');
  });

  it('lets the NLL182 day reading win over a 300 km route sheet and ignores it on MET630', () => {
    const nll182: VehicleDayReading = {
      id: 'NLL182:2026-08-31', vehicleId: 'NLL182', registrationNumber: 'NLL182', date: '2026-08-31',
      startOdometer: 283151, endOdometer: 283165, distanceKm: 14, driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
      createdBy: 'gps-import',
    };
    const nllAssignment: RouteAssignment = {
      id: 'a6f3ea27-0e1b-474f-ba45-f77266ea1ce4', routeId: 'route-31', driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus', status: 'completed', progress: null, createdBy: 'admin',
      assignedAt: '2026-08-31T05:00:00.000Z', updatedAt: '2026-08-31T16:00:00.000Z',
      vehicle: { id: 'NLL182', registrationNumber: 'NLL182', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-31', date: '2026-08-31', status: 'completed',
          start_odometer: 283151, end_odometer: 283451, actual_distance_km: 300,
          started_at: '2026-08-31T05:30:00.000Z', completed_at: '2026-08-31T15:00:00.000Z',
        },
        stops: [], shipmentLines: [],
      },
    };
    const overlaid = applyDayReading(buildServerTripSheet(nllAssignment, nllAssignment.vehicle), [nll182]);
    expect(overlaid).toMatchObject({ startOdometer: 283151, endOdometer: 283165, actualDistanceKm: 14 });

    const metAssignment: RouteAssignment = {
      ...nllAssignment,
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
    };
    const metSheet = applyDayReading(buildServerTripSheet(metAssignment, metAssignment.vehicle), [nll182]);
    expect(metSheet).toMatchObject({ startOdometer: 283151, endOdometer: 283451, actualDistanceKm: 300 });
    expect(odometerReadingCoveredBySheet(nll182, [metSheet])).toBe(false);
  });

  it('does not overlay MET630 extraDistanceKm onto Karolis’s 300 km wage sheet', () => {
    const metAssignment: RouteAssignment = {
      id: 'a6f3ea27-0e1b-474f-ba45-f77266ea1ce4', routeId: 'route-31', driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus', status: 'completed', progress: null, createdBy: 'admin',
      assignedAt: '2026-08-31T05:00:00.000Z', updatedAt: '2026-08-31T16:00:00.000Z',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-31', date: '2026-08-31', status: 'completed',
          start_odometer: 283151, end_odometer: 283451, actual_distance_km: 300,
          started_at: '2026-08-31T05:30:00.000Z', completed_at: '2026-08-31T15:00:00.000Z',
        },
        stops: [], shipmentLines: [{ route_code: 'R54' }, { route_code: 'R11' }],
      },
    };
    const fullDayReading: VehicleDayReading = {
      id: 'MET630:2026-08-31', vehicleId: 'MET630', registrationNumber: 'MET630', date: '2026-08-31',
      startOdometer: 283151, endOdometer: 284066.5, distanceKm: 915.5, extraDistanceKm: 615.5,
      driverId: 'other-unassigned', driverName: 'Nepriskirtas',
      createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z', createdBy: 'fuel-august-2026-v4',
    };
    const sheet = applyDayReading(buildServerTripSheet(metAssignment, metAssignment.vehicle), [fullDayReading]);
    expect(sheet).toMatchObject({
      assignmentId: 'a6f3ea27-0e1b-474f-ba45-f77266ea1ce4',
      startOdometer: 283151,
      endOdometer: 283451,
      actualDistanceKm: 300,
      extraDistanceKm: 615.5,
      driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus',
    });
    const [paid] = attachDailyCompensation([{ ...sheet, totalWeightKg: 0, totalStops: 0 }]);
    expect(paid.compensation).toMatchObject({ distanceKm: 300 });
    expect(buildVehicleDayTripSheet({
      ...fullDayReading,
      startOdometer: 283151,
      endOdometer: 283451,
      distanceKm: 300,
    }, metAssignment.vehicle)).toMatchObject({
      actualDistanceKm: 300,
      extraDistanceKm: 615.5,
    });
  });

  it('overlays the vehicle-day driver onto GET /api/trip-sheets and driver-only PATCH keeps odometer', () => {
    const assignment: RouteAssignment = {
      id: 'eafe0680-649b-44d6-87ee-3cca734ae9ce',
      routeId: 'route-aug2026-aleks-0819-xlsx',
      driverId: '3ad054df-6d40-4279-9037-6b0e5c7abb9f',
      driverName: 'Aleksandras Arsenij',
      status: 'completed',
      progress: null,
      createdBy: 'august-2026-excel-backfill-v3',
      assignedAt: '2026-08-19T03:00:00.000Z',
      updatedAt: '2026-08-19T13:30:00.000Z',
      vehicle: { id: 'MET630', registrationNumber: 'MET630', model: 'Renault Master', maximumPayloadKg: 1500 },
      routeSnapshot: {
        route: {
          id: 'route-aug2026-aleks-0819-xlsx',
          date: '2026-08-19',
          status: 'completed',
          start_odometer: 279000,
          end_odometer: 279400,
          actual_distance_km: 400,
          started_at: '2026-08-19T03:00:00.000Z',
          completed_at: '2026-08-19T13:30:00.000Z',
        },
        stops: [{ order_number: 'S1', delivery_status: 'delivered', delivered_at: '2026-08-19T08:12:00.000Z' }],
        shipmentLines: [{ route_code: 'R14' }],
      },
    };
    const reading: VehicleDayReading = {
      id: 'MET630:2026-08-19',
      vehicleId: 'MET630',
      registrationNumber: 'MET630',
      date: '2026-08-19',
      startOdometer: 278900,
      endOdometer: 279348,
      distanceKm: 448,
      driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
      createdBy: 'gps-import',
    };
    expect(listedTripSheetDriver(assignment, [reading])).toEqual({
      driverId: 'a7bce619-ad14-4dda-9780-f130a79ab998',
      driverName: 'Karolis Tautkus',
    });
    const synced = applyTripSheetDriverCorrectionToDayReading(reading, {
      driverId: '3ad054df-6d40-4279-9037-6b0e5c7abb9f',
      driverName: 'Aleksandras Arsenij',
      updatedAt: '2026-09-03T07:15:00.000Z',
    });
    expect(synced).toMatchObject({
      startOdometer: 278900,
      endOdometer: 279348,
      distanceKm: 448,
      driverId: '3ad054df-6d40-4279-9037-6b0e5c7abb9f',
      driverName: 'Aleksandras Arsenij',
    });
    expect(listedTripSheetDriver(assignment, [synced])).toEqual({
      driverId: '3ad054df-6d40-4279-9037-6b0e5c7abb9f',
      driverName: 'Aleksandras Arsenij',
    });

    const updateBlock = storeSource.slice(
      storeSource.indexOf('async updateTripSheet'),
      storeSource.indexOf('async updateFuelEntry'),
    );
    expect(updateBlock).toContain('odometerTouched');
    expect(updateBlock).toContain('applyTripSheetDriverCorrectionToDayReading');
  });

  it('wires updateTripSheet to the stop-preserving helper and the new vehicle id', () => {
    const updateBlock = storeSource.slice(
      storeSource.indexOf('async updateTripSheet'),
      storeSource.indexOf('async updateFuelEntry'),
    );
    expect(updateBlock).toContain('vehicleId?: string');
    expect(updateBlock).toContain('validateVehicleId(input.vehicleId)');
    expect(updateBlock).toContain('applyTripSheetVehicleDriverCorrection');
    expect(updateBlock).not.toContain('stopPunctuality');
    expect(updateBlock).not.toMatch(/\bstops\s*:/);
    expect(updateBlock).not.toMatch(/delivery_status\s*:/);
    expect(updateBlock).toContain('other vehicles\' readings for that day are left in place');
  });

  it('leaves a zero-kilometre bulk-imported day without a driver instead of the vehicle default', () => {
    expect(vehicleSource).toContain("const driverId = row.start === row.end ? null : undefined;");
  });
});
