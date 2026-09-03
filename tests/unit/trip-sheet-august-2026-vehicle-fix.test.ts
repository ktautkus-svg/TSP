import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES,
  ERIKAS_ASKELOVICIUS_DISPLAY_NAME,
  ERIKAS_ASKELOVICIUS_DRIVER_ID,
  ERIKAS_PLACEHOLDER_DISPLAY_NAME,
  KAROLIS_TAUTKUS_DRIVER_ID,
  NLL182_AUGUST_2026_FACT_KM,
  NLL182_AUGUST_2026_ODOMETER_CORRECTIONS,
  TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID,
  canUpdateAssignmentScheduleDate,
  nll182AugustDayDistanceKm,
  nll182FactDriverIdForDate,
  shouldRenameErikasPlaceholder,
  vehicleDayReadingDocId,
} from '../../src/domain/trip-sheet-august-2026-vehicle-fix';
import { FUEL_AUGUST_2026_MIGRATION_ID } from '../../src/domain/excel-fuel-log';
import { NLL182_ODOMETER_LOG } from '../../src/domain/nll182-odometer-log';

const FIRESTORE_ID = /^[a-zA-Z0-9_-]{8,80}$/;
const storeSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
const apiSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
const productionServer = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');

describe('August 2026 trip-sheet vehicle/driver correction catalog', () => {
  it('targets the photo-log assignment ids without colliding with the fuel flag', () => {
    expect(TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID).toBe('trip-sheet-august-2026-vehicle-fix-v1');
    expect(TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID).not.toBe(FUEL_AUGUST_2026_MIGRATION_ID);
    expect(AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES).toHaveLength(12);
    const ids = AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES.map((fix) => fix.assignmentId);
    expect(new Set(ids).size).toBe(12);
    for (const id of ids) expect(id).toMatch(FIRESTORE_ID);
    expect(KAROLIS_TAUTKUS_DRIVER_ID).toMatch(FIRESTORE_ID);
    expect(ERIKAS_ASKELOVICIUS_DRIVER_ID).toMatch(FIRESTORE_ID);
  });

  it('maps each live completed sheet to the fact vehicle and driver', () => {
    const byId = Object.fromEntries(
      AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES.map((fix) => [fix.assignmentId, fix]),
    );
    expect(byId['13e4dc49-23fd-475b-9439-de3a4102607d']).toMatchObject({
      factDate: '2026-08-14', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['9a8f2a87-e209-4a9a-938d-c1abfc074724']).toMatchObject({
      factDate: '2026-08-18', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['1ed83dca-de72-413f-8d70-dc2845ee76df']).toMatchObject({
      factDate: '2026-08-19', registrationNumber: 'NLL182', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['e02d4f4f-eab4-44cf-b0ee-9daefab4aa82']).toMatchObject({
      factDate: '2026-08-21', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['918333a8-4ef5-4882-a2ec-4bedcb8d5701']).toMatchObject({
      factDate: '2026-08-24', registrationNumber: 'NLL182', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['b2b7a6d6-fbdd-436b-9d77-dcbd4fd820f3']).toMatchObject({
      factDate: '2026-08-26', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['4139929b-01aa-476d-b1f8-3796ab8b25dd']).toMatchObject({
      factDate: '2026-08-27', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['98733734-16d1-483c-9f20-1f7e65352d5c']).toMatchObject({
      factDate: '2026-08-27', registrationNumber: 'NLL182', driverId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    });
    expect(byId['e6f915ef-fb5e-4487-a455-5016921ce41f']).toMatchObject({
      factDate: '2026-08-26',
      registrationNumber: 'NLL182',
      driverId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
      scheduleDate: '2026-08-26',
    });
    expect(byId['84fafac0-6ba9-4755-ae45-1f5f0318a7e0']).toMatchObject({
      factDate: '2026-08-28', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['a6f3ea27-0e1b-474f-ba45-f77266ea1ce4']).toMatchObject({
      factDate: '2026-08-31', registrationNumber: 'MET630', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['962eccfc-8e73-4f2b-8a12-a5cd8daaaa12']).toMatchObject({
      factDate: '2026-08-17', registrationNumber: 'NLL182', driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    });
    expect(byId['9a8f2a87-e209-4a9a-938d-c1abfc074724']?.factRouteNumbers).toContain('R50');
  });

  it('renames only the Vairas 3 placeholder and leaves completed dates locked', () => {
    expect(shouldRenameErikasPlaceholder('Vairas 3')).toBe(true);
    expect(shouldRenameErikasPlaceholder('  Vairas  3 ')).toBe(true);
    expect(shouldRenameErikasPlaceholder(ERIKAS_ASKELOVICIUS_DISPLAY_NAME)).toBe(false);
    expect(shouldRenameErikasPlaceholder('Karolis Tautkus')).toBe(false);
    expect(ERIKAS_PLACEHOLDER_DISPLAY_NAME).toBe('Vairas 3');
    expect(canUpdateAssignmentScheduleDate('assigned')).toBe(true);
    expect(canUpdateAssignmentScheduleDate('downloaded')).toBe(true);
    expect(canUpdateAssignmentScheduleDate('completed')).toBe(false);
    expect(canUpdateAssignmentScheduleDate('in_progress')).toBe(false);
    expect(vehicleDayReadingDocId('MET630', '2026-08-14')).toBe('MET630:2026-08-14');
  });

  it('upserts the NLL182 Aug 13–31 odometer chain as absolute start/end, not summed sheets', () => {
    expect(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS).toHaveLength(19);
    expect(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS[0]).toEqual({
      date: '2026-08-13', startOdometer: 276439, endOdometer: 277012,
    });
    expect(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS.at(-1)).toEqual({
      date: '2026-08-31', startOdometer: 283151, endOdometer: 283165,
    });
    expect(nll182AugustDayDistanceKm(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS.at(-1)!)).toBe(NLL182_AUGUST_2026_FACT_KM['2026-08-31']);
    expect(nll182AugustDayDistanceKm(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS.find((day) => day.date === '2026-08-27')!))
      .toBe(NLL182_AUGUST_2026_FACT_KM['2026-08-27']);
    for (let index = 1; index < NLL182_AUGUST_2026_ODOMETER_CORRECTIONS.length; index += 1) {
      expect(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS[index]!.startOdometer)
        .toBe(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS[index - 1]!.endOdometer);
    }
    const listedKm: Record<string, number> = {
      '2026-08-13': 573, '2026-08-14': 502, '2026-08-15': 0, '2026-08-16': 653,
      '2026-08-17': 437, '2026-08-18': 362, '2026-08-19': 382, '2026-08-20': 526,
      '2026-08-21': 409, '2026-08-22': 0, '2026-08-23': 665, '2026-08-24': 363,
      '2026-08-25': 370, '2026-08-26': 829, '2026-08-27': 404, '2026-08-28': 227,
      '2026-08-29': 0, '2026-08-30': 10, '2026-08-31': 14,
    };
    for (const day of NLL182_AUGUST_2026_ODOMETER_CORRECTIONS) {
      expect(nll182AugustDayDistanceKm(day)).toBe(listedKm[day.date]);
    }
    for (const gps of NLL182_ODOMETER_LOG.filter((day) => day.date >= '2026-08-13')) {
      expect(NLL182_AUGUST_2026_ODOMETER_CORRECTIONS.find((day) => day.date === gps.date)).toEqual(gps);
    }
    expect(nll182FactDriverIdForDate('2026-08-27')).toBe(ERIKAS_ASKELOVICIUS_DRIVER_ID);
    expect(nll182FactDriverIdForDate('2026-08-31')).toBeUndefined();
    expect(nll182FactDriverIdForDate('2026-08-19')).toBe(KAROLIS_TAUTKUS_DRIVER_ID);
  });

  it('applies through updateTripSheet on Cloud Run boot without reseeding fuel or rewriting stops', () => {
    expect(storeSource).toContain('async applyTripSheetAugust2026VehicleFix');
    expect(storeSource).toContain('TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID');
    expect(storeSource).toContain("from '../src/domain/trip-sheet-august-2026-vehicle-fix.js'");
    expect(storeSource).toContain('Never rewrites stop delivered_at');
    expect(apiSource).toContain('await ensureTripSheetAugust2026VehicleFixMigrated()');
    expect(apiSource).toContain('export function ensureTripSheetAugust2026VehicleFixMigrated');
    expect(productionServer).toContain('await ensureTripSheetAugust2026VehicleFixMigrated()');
    expect(apiSource).toContain("vehicleId: body.vehicleId === undefined ? undefined : stringField(body, 'vehicleId')");

    const listTripSheetsBlock = storeSource.slice(
      storeSource.indexOf('async listTripSheets'),
      storeSource.indexOf('async upsertVehicleDayReading'),
    );
    expect(listTripSheetsBlock).not.toContain('applyTripSheetAugust2026VehicleFix');
    expect(listTripSheetsBlock).not.toContain('applyFuelAugust2026V2Migration');
    expect(listTripSheetsBlock).not.toContain('applyFuelAugust2026V4Migration');
    expect(listTripSheetsBlock).not.toContain('applyFuelAugust2026V5Migration');
    expect(listTripSheetsBlock).not.toContain('applyAugust2026ExcelBackfill');

    const vehicleFixBlock = storeSource.slice(
      storeSource.indexOf('async applyTripSheetAugust2026VehicleFix'),
      storeSource.indexOf('async applyAugust2026ExcelBackfill'),
    );
    expect(vehicleFixBlock).toContain('await this.updateTripSheet');
    expect(vehicleFixBlock).toContain('upsertVehicleDayReading');
    expect(vehicleFixBlock).toContain('NLL182_AUGUST_2026_ODOMETER_CORRECTIONS');
    expect(vehicleFixBlock).toContain('skipped_missing');
    expect(vehicleFixBlock).not.toMatch(/\bstops\s*:/);
    expect(vehicleFixBlock).toContain('canUpdateAssignmentScheduleDate');
    expect(vehicleFixBlock).toContain('shouldRenameErikasPlaceholder');
    expect(vehicleFixBlock).not.toContain('FUEL_AUGUST_2026_MIGRATION_ID');
  });
});
