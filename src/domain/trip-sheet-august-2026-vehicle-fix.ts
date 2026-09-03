import { odometerDistanceKm, type VehicleDayOdometer } from './nll182-odometer-log';

/**
 * Authoritative August 2026 completed-assignment vehicle/driver corrections
 * from the photo day log. One-shot production migration applies these via
 * updateTripSheet so stop punctuality (delivered_at / windows) is never rewritten.
 *
 * NLL182 vehicle-day odometer (Aug 13–31) is upserted through the same store
 * path as POST /api/trip-sheets/day-readings. Absolute start/end win for the
 * fuel/odometer ledger — not the sum of route sheets.
 *
 * Out of scope (no assignment stops exist in-app to attach):
 * - Early August days with only vehicle-day odometer and no route assignment
 *   (cannot recreate Rxx from codes alone)
 * - Missing Aleksandras R32-only days / LRI741 / DUONA / M03;R02
 */

export const TRIP_SHEET_AUGUST_2026_VEHICLE_FIX_ID = 'trip-sheet-august-2026-vehicle-fix-v1';

export const KAROLIS_TAUTKUS_DRIVER_ID = 'a7bce619-ad14-4dda-9780-f130a79ab998';
export const ERIKAS_ASKELOVICIUS_DRIVER_ID = '5d86fd05-ba4e-4612-a1c4-2ae6be90fd61';
export const ERIKAS_ASKELOVICIUS_DISPLAY_NAME = 'Erikas Aškelovičius';
export const ERIKAS_PLACEHOLDER_DISPLAY_NAME = 'Vairas 3';

export type August2026TripSheetVehicleFix = {
  assignmentId: string;
  /** Calendar day the photo log attributes this work to. */
  factDate: string;
  registrationNumber: 'MET630' | 'NLL182';
  driverId: string;
  /**
   * When set, try existing updateAssignmentSchedule. Completed routes reject
   * that API — leave the stored date and only correct vehicle/driver.
   */
  scheduleDate?: string;
  /** Informational — never invent missing routeNumbers on existing stops. */
  factRouteNumbers: readonly string[];
};

export const AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES: readonly August2026TripSheetVehicleFix[] = [
  {
    assignmentId: '13e4dc49-23fd-475b-9439-de3a4102607d',
    factDate: '2026-08-14',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R15', 'R10', 'R44', 'R45'],
  },
  {
    assignmentId: '9a8f2a87-e209-4a9a-938d-c1abfc074724',
    factDate: '2026-08-18',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R16', 'R17', 'R40', 'R41', 'R42', 'R50', 'R65'],
  },
  {
    assignmentId: '1ed83dca-de72-413f-8d70-dc2845ee76df',
    factDate: '2026-08-19',
    registrationNumber: 'NLL182',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R54', 'R11'],
  },
  {
    assignmentId: 'e02d4f4f-eab4-44cf-b0ee-9daefab4aa82',
    factDate: '2026-08-21',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R15', 'R19', 'R46'],
  },
  {
    assignmentId: '918333a8-4ef5-4882-a2ec-4bedcb8d5701',
    factDate: '2026-08-24',
    registrationNumber: 'NLL182',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R54'],
  },
  {
    assignmentId: 'b2b7a6d6-fbdd-436b-9d77-dcbd4fd820f3',
    factDate: '2026-08-26',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R15', 'R19'],
  },
  {
    assignmentId: '4139929b-01aa-476d-b1f8-3796ab8b25dd',
    factDate: '2026-08-27',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R15', 'R44', 'R45', 'R31', 'R53'],
  },
  {
    assignmentId: '98733734-16d1-483c-9f20-1f7e65352d5c',
    factDate: '2026-08-27',
    registrationNumber: 'NLL182',
    driverId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    factRouteNumbers: ['R07', 'R22', 'R09'],
  },
  {
    assignmentId: 'e6f915ef-fb5e-4487-a455-5016921ce41f',
    factDate: '2026-08-26',
    registrationNumber: 'NLL182',
    driverId: ERIKAS_ASKELOVICIUS_DRIVER_ID,
    scheduleDate: '2026-08-26',
    factRouteNumbers: ['R88', 'R86'],
  },
  {
    assignmentId: '84fafac0-6ba9-4755-ae45-1f5f0318a7e0',
    factDate: '2026-08-28',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R15', 'R19'],
  },
  {
    assignmentId: 'a6f3ea27-0e1b-474f-ba45-f77266ea1ce4',
    factDate: '2026-08-31',
    registrationNumber: 'MET630',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R54', 'R11'],
  },
  {
    assignmentId: '962eccfc-8e73-4f2b-8a12-a5cd8daaaa12',
    factDate: '2026-08-17',
    registrationNumber: 'NLL182',
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    factRouteNumbers: ['R11', 'R15', 'R19', 'R54'],
  },
];

export function shouldRenameErikasPlaceholder(displayName: string | null | undefined): boolean {
  return (displayName ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('lt')
    === ERIKAS_PLACEHOLDER_DISPLAY_NAME.toLocaleLowerCase('lt');
}

/** Mirrors updateAssignmentSchedule: started/completed/cancelled dates are locked. */
export function canUpdateAssignmentScheduleDate(status: string): boolean {
  return !['in_progress', 'completed', 'cancelled'].includes(status);
}

export function vehicleDayReadingDocId(vehicleId: string, date: string): string {
  return `${vehicleId}:${date}`;
}

/**
 * NLL182 GPS/fact odometer for 2026-08-13 … 2026-08-31.
 * Chain is contiguous; km is always end − start, never summed across sheets.
 */
export const NLL182_AUGUST_2026_ODOMETER_CORRECTIONS: readonly VehicleDayOdometer[] = [
  { date: '2026-08-13', startOdometer: 276439, endOdometer: 277012 },
  { date: '2026-08-14', startOdometer: 277012, endOdometer: 277514 },
  { date: '2026-08-15', startOdometer: 277514, endOdometer: 277514 },
  { date: '2026-08-16', startOdometer: 277514, endOdometer: 278167 },
  { date: '2026-08-17', startOdometer: 278167, endOdometer: 278604 },
  { date: '2026-08-18', startOdometer: 278604, endOdometer: 278966 },
  { date: '2026-08-19', startOdometer: 278966, endOdometer: 279348 },
  { date: '2026-08-20', startOdometer: 279348, endOdometer: 279874 },
  { date: '2026-08-21', startOdometer: 279874, endOdometer: 280283 },
  { date: '2026-08-22', startOdometer: 280283, endOdometer: 280283 },
  { date: '2026-08-23', startOdometer: 280283, endOdometer: 280948 },
  { date: '2026-08-24', startOdometer: 280948, endOdometer: 281311 },
  { date: '2026-08-25', startOdometer: 281311, endOdometer: 281681 },
  { date: '2026-08-26', startOdometer: 281681, endOdometer: 282510 },
  { date: '2026-08-27', startOdometer: 282510, endOdometer: 282914 },
  { date: '2026-08-28', startOdometer: 282914, endOdometer: 283141 },
  { date: '2026-08-29', startOdometer: 283141, endOdometer: 283141 },
  { date: '2026-08-30', startOdometer: 283141, endOdometer: 283151 },
  { date: '2026-08-31', startOdometer: 283151, endOdometer: 283165 },
];

export const NLL182_AUGUST_2026_FACT_KM = {
  '2026-08-27': 404,
  '2026-08-31': 14,
} as const;

export function nll182FactDriverIdForDate(date: string): string | undefined {
  return AUGUST_2026_TRIP_SHEET_VEHICLE_FIXES.find(
    (fix) => fix.registrationNumber === 'NLL182' && fix.factDate === date,
  )?.driverId;
}

export function nll182AugustDayDistanceKm(day: Pick<VehicleDayOdometer, 'startOdometer' | 'endOdometer'>): number {
  return odometerDistanceKm(day.startOdometer, day.endOdometer);
}
