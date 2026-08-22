import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_VERSION } from '@/database/migrations';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import { VehicleFaultRepository } from '@/database/repositories/vehicle-fault-repository';
import {
  evaluateDepartureReadiness,
  firstBlockerMessage,
  type DepartureReadiness,
} from '@/domain/departure-readiness';
import type { DeliveryStop } from '@/domain/route';

export { firstBlockerMessage };

export async function schemaSupportsDepartureGates(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return (row?.user_version ?? 0) >= 23 && SCHEMA_VERSION >= 23;
}

export async function loadDepartureReadiness(
  db: SQLiteDatabase,
  _stops: readonly DeliveryStop[] = [],
  now?: string,
): Promise<DepartureReadiness> {
  if (!await schemaSupportsDepartureGates(db)) {
    return { blockers: [], warnings: [], canDepart: true, canBeginLoading: true };
  }
  const vehicle = await new TripSheetRepository(db).getVehicle();
  const faults = vehicle ? await new VehicleFaultRepository(db).listOpen(vehicle.id) : [];
  return evaluateDepartureReadiness({
    vehicle: vehicle ? {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      technicalInspectionDueOn: vehicle.technicalInspectionDueOn,
      roadTaxDueOn: vehicle.roadTaxDueOn,
      nextServiceDueOn: vehicle.nextServiceDueOn,
    } : null,
    faults,
    now,
  });
}
