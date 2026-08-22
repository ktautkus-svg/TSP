import type { SQLiteDatabase } from 'expo-sqlite';

import { employeeApi } from '@/infrastructure/auth/employee-session';
import { VehicleFaultRepository } from '@/database/repositories/vehicle-fault-repository';
import type { VehicleFault } from '@/domain/vehicle-and-trip';

export async function reportVehicleFault(
  db: SQLiteDatabase,
  input: { vehicleId: string; registrationNumber: string; comment: string; reportedBy?: string | null },
  online: boolean,
  now = new Date().toISOString(),
): Promise<VehicleFault> {
  const repository = new VehicleFaultRepository(db);
  const fault = await repository.add({
    vehicleId: input.vehicleId,
    comment: input.comment,
    reportedBy: input.reportedBy,
  }, now);
  if (!online) return fault;
  try {
    await employeeApi('/api/operations/vehicle-faults', {
      method: 'POST',
      body: JSON.stringify({
        localId: fault.id,
        vehicleId: input.vehicleId,
        registrationNumber: input.registrationNumber,
        comment: fault.comment,
        reportedAt: fault.reportedAt,
      }),
    });
    await repository.markNotified(fault.id, now);
    return { ...fault, notifiedAt: now };
  } catch {
    return fault;
  }
}
