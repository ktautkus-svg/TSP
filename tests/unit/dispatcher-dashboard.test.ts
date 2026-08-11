import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DRIVER_PERMISSION_KEYS,
  normalizeDriverPermissions,
} from '../../src/application/auth/employee-permissions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dispatcherSource = readFileSync(resolve(root, 'src/app/dispatcher.tsx'), 'utf8');
const adminSource = readFileSync(resolve(root, 'src/app/admin.tsx'), 'utf8');
const homeSource = readFileSync(resolve(root, 'src/app/index.tsx'), 'utf8');
const loadingSource = readFileSync(resolve(root, 'src/app/route/[id]/loading.tsx'), 'utf8');
const deliverySource = readFileSync(resolve(root, 'src/app/route/[id]/delivery.tsx'), 'utf8');
const layoutSource = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');

describe('dispatcher desktop workspace', () => {
  it('contains the route, driver and confirmation workflow', () => {
    expect(dispatcherSource).toContain('1. Maršrutas');
    expect(dispatcherSource).toContain('2. Vairuotojas');
    expect(dispatcherSource).toContain('3. Priskirti maršrutą');
    expect(dispatcherSource).toContain('3. Priskirti vairuotoją');
    expect(dispatcherSource).toContain('Priskirti vairuotoją');
    expect(dispatcherSource).toContain("width >= 980");
  });

  it('uses the shared assignment API and clearly reports the assigned driver', () => {
    expect(dispatcherSource).toContain("employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments')");
    expect(dispatcherSource).toContain('assignRouteToDriver(db, selectedRoute.id, selectedDriver.id)');
    expect(dispatcherSource).toContain('Vairuotojas jį gaus prisijungęs');
  });

  it('sends dispatchers to their workspace and keeps route creation hidden from drivers by default', () => {
    expect(homeSource).toContain("profile.role === 'dispatcher'");
    expect(homeSource).toContain("profile.role !== 'driver'");
    expect(homeSource).toContain('Maršrutas dar nepriskirtas');
  });
});

describe('driver permissions', () => {
  it('defaults every optional planning permission to disabled', () => {
    const permissions = normalizeDriverPermissions();
    expect(DRIVER_PERMISSION_KEYS).toHaveLength(5);
    expect(Object.values(permissions)).toEqual([false, false, false, false, false]);
  });

  it('preserves explicitly enabled permissions while filling missing values', () => {
    const permissions = normalizeDriverPermissions({ canReorderAssignedRoute: true });
    expect(permissions.canReorderAssignedRoute).toBe(true);
    expect(permissions.canCancelRoute).toBe(false);
  });

  it('syncs the dispatcher own routes through the shared coordinator, never by calling the engine directly', () => {
    // Dispatchers create routes here ("+ Planuoti maršrutą"), so they own local
    // routes and the home screen redirects them away before its own sync runs.
    // The refresh must go through the coordinator: a direct syncRoutesWithCloud
    // call would run a second pass alongside a lifecycle one and would never
    // reach the shared status indicator.
    expect(dispatcherSource).toContain("import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context'");
    expect(dispatcherSource).toContain("await requestSync('dispatcher-refresh')");
    expect(dispatcherSource).not.toContain('syncRoutesWithCloud(');
    expect(homeSource).toContain("if (profile.role === 'dispatcher')");
  });

  it('keeps the dispatcher screen inside the app-wide sync provider', () => {
    // The provider is what covers dispatcher startup, foreground and network
    // triggers without any screen-specific wiring.
    expect(layoutSource).toContain('<RouteCloudSyncProvider>');
    expect(layoutSource).toContain('<Stack.Screen name="dispatcher"');
  });

  it('renders administrator permission switches and enforces the route actions in driver screens', () => {
    expect(adminSource).toContain('DRIVER_PERMISSION_KEYS.map');
    expect(adminSource).toContain('Vairuotojo leidimai');
    expect(loadingSource).toContain('profile.permissions?.canReorderAssignedRoute');
    expect(loadingSource).toContain('profile.permissions?.canCancelRoute');
    expect(deliverySource).toContain('profile.permissions?.canAddStops');
    expect(deliverySource).toContain('profile.permissions?.canRecalculateRoute');
  });
});

