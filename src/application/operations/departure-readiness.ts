import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_VERSION } from '@/database/migrations';
import { VehicleDepartureOverrideRepository } from '@/database/repositories/vehicle-departure-override-repository';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import { VehicleFaultRepository } from '@/database/repositories/vehicle-fault-repository';
import {
  departureBlockerFingerprint,
  evaluateDepartureReadiness,
  expiredDeadlineSummary,
  firstBlockerMessage,
  type DepartureReadiness,
} from '@/domain/departure-readiness';
import type { DeliveryStop } from '@/domain/route';
import { employeeApi, type ServerDepartureOverride } from '@/infrastructure/auth/employee-session';

export { firstBlockerMessage };

const emptyReadiness = (): DepartureReadiness => ({
  blockers: [],
  warnings: [],
  canDepart: true,
  canBeginLoading: true,
  overrideStatus: 'none',
});

export async function schemaSupportsDepartureGates(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return (row?.user_version ?? 0) >= 23 && SCHEMA_VERSION >= 23;
}

export async function schemaSupportsDepartureOverrides(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return (row?.user_version ?? 0) >= 24 && SCHEMA_VERSION >= 24;
}

export async function loadDepartureReadiness(
  db: SQLiteDatabase,
  _stops: readonly DeliveryStop[] = [],
  now?: string,
): Promise<DepartureReadiness> {
  if (!await schemaSupportsDepartureGates(db)) {
    return emptyReadiness();
  }
  const vehicle = await new TripSheetRepository(db).getVehicle();
  const faults = vehicle ? await new VehicleFaultRepository(db).listOpen(vehicle.id) : [];
  const evaluated = evaluateDepartureReadiness({
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
  if (!vehicle || !await schemaSupportsDepartureOverrides(db)) return evaluated;
  const override = await new VehicleDepartureOverrideRepository(db).getLatest(vehicle.id);
  if (!override) return evaluated;
  return evaluateDepartureReadiness({
    vehicle: {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      technicalInspectionDueOn: vehicle.technicalInspectionDueOn,
      roadTaxDueOn: vehicle.roadTaxDueOn,
      nextServiceDueOn: vehicle.nextServiceDueOn,
    },
    faults,
    now,
    override: { status: override.status, fingerprint: override.fingerprint },
  });
}

async function currentExpiredGate(db: SQLiteDatabase, now?: string) {
  const vehicle = await new TripSheetRepository(db).getVehicle();
  if (!vehicle) throw new Error('Pirmiausia išsaugokite automobilį.');
  const faults = await new VehicleFaultRepository(db).listOpen(vehicle.id);
  const readiness = evaluateDepartureReadiness({
    vehicle: {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      technicalInspectionDueOn: vehicle.technicalInspectionDueOn,
      roadTaxDueOn: vehicle.roadTaxDueOn,
      nextServiceDueOn: vehicle.nextServiceDueOn,
    },
    faults,
    now,
  });
  const fingerprint = departureBlockerFingerprint(readiness.blockers);
  if (!fingerprint) {
    throw new Error('Nėra pasibaigusio termino, kuriam reikėtų administratoriaus patvirtinimo.');
  }
  return {
    vehicle,
    fingerprint,
    summary: expiredDeadlineSummary(readiness.blockers),
  };
}

export async function requestExpiredDepartureOverride(
  db: SQLiteDatabase,
  input: { requestedBy: string; online: boolean },
  now = new Date().toISOString(),
) {
  if (!await schemaSupportsDepartureOverrides(db)) {
    throw new Error('Ši programos versija dar nepalaiko išvykimo patvirtinimų.');
  }
  const gate = await currentExpiredGate(db, now);
  const override = await new VehicleDepartureOverrideRepository(db).request({
    vehicleId: gate.vehicle.id,
    fingerprint: gate.fingerprint,
    summary: gate.summary,
    requestedBy: input.requestedBy,
  }, now);
  if (input.online) {
    try {
      await employeeApi('/api/operations/departure-overrides', {
        method: 'POST',
        body: JSON.stringify({
          localId: override.id,
          vehicleId: gate.vehicle.id,
          registrationNumber: gate.vehicle.registrationNumber,
          fingerprint: override.fingerprint,
          summary: override.summary,
          requestedAt: override.requestedAt,
        }),
      });
    } catch {
      // Local pending row is enough to show "waiting" on this device.
    }
  }
  return override;
}

export async function approveExpiredDepartureOverride(
  db: SQLiteDatabase,
  input: { approvedBy: string; note?: string | null; online: boolean },
  now = new Date().toISOString(),
) {
  if (!await schemaSupportsDepartureOverrides(db)) {
    throw new Error('Ši programos versija dar nepalaiko išvykimo patvirtinimų.');
  }
  const gate = await currentExpiredGate(db, now);
  const override = await new VehicleDepartureOverrideRepository(db).approve({
    vehicleId: gate.vehicle.id,
    fingerprint: gate.fingerprint,
    summary: gate.summary,
    approvedBy: input.approvedBy,
    note: input.note,
  }, now);
  if (input.online) {
    try {
      await employeeApi('/api/admin/departure-overrides', {
        method: 'POST',
        body: JSON.stringify({
          localId: override.id,
          vehicleId: gate.vehicle.id,
          registrationNumber: gate.vehicle.registrationNumber,
          fingerprint: override.fingerprint,
          summary: override.summary,
          note: override.note,
        }),
      });
    } catch {
      // Local approval still lets this device load and drive.
    }
  }
  return override;
}

export async function pullDepartureOverride(db: SQLiteDatabase): Promise<void> {
  if (!await schemaSupportsDepartureOverrides(db)) return;
  const vehicle = await new TripSheetRepository(db).getVehicle();
  if (!vehicle) return;
  const query = new URLSearchParams({
    vehicleId: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
  });
  const response = await employeeApi<{ override: ServerDepartureOverride | null }>(
    `/api/operations/departure-overrides?${query.toString()}`,
  );
  if (!response.override) return;
  await new VehicleDepartureOverrideRepository(db).upsertFromServer({
    id: response.override.localId || response.override.id,
    vehicleId: vehicle.id,
    fingerprint: response.override.fingerprint,
    summary: response.override.summary,
    status: response.override.status,
    requestedBy: response.override.requestedBy,
    requestedAt: response.override.requestedAt,
    approvedBy: response.override.approvedBy,
    approvedAt: response.override.approvedAt,
    note: response.override.note,
    createdAt: response.override.requestedAt,
    updatedAt: response.override.approvedAt ?? response.override.requestedAt,
  });
}

export async function refreshDepartureReadiness(
  db: SQLiteDatabase,
  stops: readonly DeliveryStop[] = [],
  options?: { now?: string; online?: boolean },
): Promise<DepartureReadiness> {
  if (options?.online) {
    await pullDepartureOverride(db).catch(() => undefined);
  }
  return loadDepartureReadiness(db, stops, options?.now);
}
