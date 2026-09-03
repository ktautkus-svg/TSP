/**
 * Authoritative August 2026 completed-assignment vehicle/driver corrections
 * from the photo day log. One-shot production migration applies these via
 * updateTripSheet so stop punctuality (delivered_at / windows) is never rewritten.
 *
 * Out of scope (no assignment stops exist in-app to attach):
 * - Early August vehicle-day odometer sheets without a route assignment
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
