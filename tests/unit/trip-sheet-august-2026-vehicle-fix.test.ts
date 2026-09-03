import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES,
  ERIKAS_ASKELOVICIUS_DISPLAY_NAME,
  ERIKAS_ASKELOVICIUS_DRIVER_ID,
  ERIKAS_PLACEHOLDER_DISPLAY_NAME,
  KAROLIS_TAUTKUS_DRIVER_ID,
  TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID,
  canUpdateAssignmentScheduleDate,
  shouldRenameErikasPlaceholder,
  vehicleDayReadingDocId,
} from '../../src/domain/trip-sheet-august-2026-vehicle-fix';
import { FUEL_AUGUST_2026_MIGRATION_ID } from '../../src/domain/excel-fuel-log';

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

    const vehicleFixBlock = storeSource.slice(
      storeSource.indexOf('async applyTripSheetAugust2026VehicleFix'),
      storeSource.indexOf('async seedNll182OpeningFuel'),
    );
    expect(vehicleFixBlock).toContain('await this.updateTripSheet');
    expect(vehicleFixBlock).toContain('skipped_missing');
    expect(vehicleFixBlock).not.toMatch(/\bstops\s*:/);
    expect(vehicleFixBlock).toContain('canUpdateAssignmentScheduleDate');
    expect(vehicleFixBlock).toContain('shouldRenameErikasPlaceholder');
    expect(vehicleFixBlock).not.toContain('FUEL_AUGUST_2026_MIGRATION_ID');
  });
});
