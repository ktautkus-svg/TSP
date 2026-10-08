import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(import.meta.dirname, `../../${path}`), 'utf8');

describe('driver operational fixes', () => {
  it('refreshes cloud state while another device stays open in the foreground', () => {
    const context = source('src/application/sync/route-cloud-sync-context.tsx');
    const coordinator = source('src/application/sync/route-cloud-sync-coordinator.ts');
    expect(context).toContain('const LIVE_SYNC_INTERVAL_MS = 10_000');
    expect(context).toContain("requestSync('periodic')");
    expect(coordinator).toContain("| 'periodic'");
  });

  it('keeps TA data and readiness tied to the selected/assigned vehicle', () => {
    const vehicle = source('src/app/vehicle.tsx');
    const loading = source('src/app/route/[id]/loading.tsx');
    const readiness = source('src/application/operations/departure-readiness.ts');
    expect(vehicle).toContain('await applyVehicle(selectedVehicleId)');
    expect(loading).toContain('vehicleId: persisted.route.vehicleId');
    expect(readiness).toContain('repository.getVehicleById(vehicleId)');
  });

  it('allows wage-only one-stop records without routing an empty snapshot through cloud sync', () => {
    const api = source('server/employee-api.ts');
    expect(api).toContain('if (assignment.routeSnapshot.stops.length > 0)');
    expect(api).toContain('await routeSyncStore.seedAssignment(assignment.driverId, assignment.routeSnapshot)');
  });

  it('offers a short remaining-route action and prefers live GPS as its origin', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    const recalculation = source('src/application/routes/route-recalculation.ts');
    expect(delivery).toContain('Perskaičiuoti nuo dabartinio');
    expect(delivery).toContain('recalculate-remaining-route');
    expect(delivery).toContain('gpsFix ? { latitude: gpsFix.latitude, longitude: gpsFix.longitude } : null');
    expect(recalculation).toContain('const origin = liveOrigin ??');
  });
});
