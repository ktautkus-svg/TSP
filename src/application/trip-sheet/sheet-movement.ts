/**
 * Movement this sheet recorded on its own. Odometer delta wins, then the
 * recorded actual distance, then the planned figure. A zero result is a
 * leftover or a day the vehicle did not move.
 *
 * This file stays free of app path aliases. The production server loads it
 * as plain Node, which cannot resolve `@/`.
 */
export function sheetMovementKm(sheet: {
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
}): number {
  const odometerKm = sheet.startOdometer !== null && sheet.endOdometer !== null && sheet.endOdometer >= sheet.startOdometer
    ? sheet.endOdometer - sheet.startOdometer
    : null;
  return odometerKm ?? sheet.actualDistanceKm ?? sheet.plannedDistanceKm ?? 0;
}
