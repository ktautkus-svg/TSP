import { parseVehicleDayAssignmentId } from '@/domain/nll182-odometer-log';

export type FuelOnlySheet = {
  assignmentId: string;
  routeId?: string | null;
  routeNumbers: readonly string[];
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
  totalStops: number;
  totalWeightKg: number;
  startAddress?: string | null;
};

function moved(sheet: FuelOnlySheet): boolean {
  const actual = sheet.actualDistanceKm ?? 0;
  const planned = sheet.plannedDistanceKm ?? 0;
  if (actual > 0 || planned > 0) return true;
  if (
    sheet.startOdometer != null
    && sheet.endOdometer != null
    && Number.isFinite(sheet.startOdometer)
    && Number.isFinite(sheet.endOdometer)
    && sheet.endOdometer !== sheet.startOdometer
  ) return true;
  return false;
}

/**
 * A calendar day that exists only because fuel was poured. A real route
 * (even at zero weight) and a service drive with real kilometres are not this.
 */
export function isFuelOnlyWorkSheet(sheet: FuelOnlySheet): boolean {
  const vehicleDay = parseVehicleDayAssignmentId(sheet.assignmentId) !== null
    || (sheet.routeId ? parseVehicleDayAssignmentId(sheet.routeId) !== null : false);
  const labeledFuel = sheet.startAddress === 'Kuro pylimas';
  if (!vehicleDay && !labeledFuel) return false;
  if (sheet.routeNumbers.some((code) => code.trim().length > 0)) return false;
  if (sheet.totalStops > 0 || sheet.totalWeightKg > 0) return false;
  if (moved(sheet)) return false;
  return true;
}
