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
  it('uses a compact dropdown assignment workflow', () => {
    expect(dispatcherSource).toContain('testID="compact-assignment-form"');
    expect(dispatcherSource).toContain('1. Maršrutas');
    expect(dispatcherSource).toContain('2. Vairuotojas');
    expect(dispatcherSource).toContain('3. Automobilis');
    expect(dispatcherSource).toContain('SelectionDropdown');
    expect(dispatcherSource).toContain("const [openPicker, setOpenPicker] = useState<'route' | 'driver' | 'vehicle' | null>(null)");
    expect(dispatcherSource).toContain('Priskirti maršrutą');
    expect(dispatcherSource).toContain("width >= 980");
    expect(dispatcherSource).toContain('style={styles.scroll}');
    expect(dispatcherSource).toContain('showsVerticalScrollIndicator');
  });

  it('shows the newly planned local route before waiting for server directories', () => {
    expect(dispatcherSource.indexOf('await loadLocalRoutes();')).toBeLessThan(
      dispatcherSource.indexOf("await requestSync('dispatcher-refresh')"),
    );
    expect(dispatcherSource).toContain('Promise.allSettled');
  });

  it('keeps driver-owned route copies out of the dispatcher cleanup list', () => {
    expect(dispatcherSource).toContain("WHERE status IN ('draft', 'planned')");
    expect(dispatcherSource).toContain("AND (owner_employee_id IS NULL OR owner_employee_id = ?)");
    expect(dispatcherSource).toContain('profile.id,');
  });

  it('uses the shared assignment API and clearly reports the assigned driver', () => {
    expect(dispatcherSource).toContain("employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments')");
    expect(dispatcherSource).toContain('assignRouteToDriver(db, selectedRoute.id, selectedDriver.id, selectedVehicle.id)');
    expect(dispatcherSource).toContain('testID="route-assignment-success"');
    expect(dispatcherSource).toContain('Maršrutas priskirtas');
    expect(dispatcherSource).toContain('Laukia vairuotojo');
    expect(dispatcherSource).toContain('Gautas įrenginyje');
  });

  it('lets the dispatcher safely remove duplicate or unnecessary planned routes in place', () => {
    expect(dispatcherSource).toContain('TrashIcon');
    expect(dispatcherSource).toContain("const [manageRoutes, setManageRoutes] = useState(false)");
    expect(dispatcherSource).toContain('title="Tvarkyti maršrutus"');
    expect(dispatcherSource).toContain('Ištrinkite nereikalingus ar pasikartojančius maršrutus');
    expect(dispatcherSource).toContain("await new CancelDraftRoute(db).execute(route.id)");
    expect(dispatcherSource).toContain('await markRouteDeletedForCloud(db, route.id)');
    expect(dispatcherSource).toContain("['loading', 'loaded', 'in_progress'].includes(route.status)");
    expect(dispatcherSource).toContain('Vykdomo maršruto ištrinti negalima');
    expect(dispatcherSource).toContain('Prisijungus ištrynimas bus sinchronizuotas');
  });

  it('shows the Excel-derived preliminary route price before and after assignment', () => {
    expect(dispatcherSource).toContain("estimatePreliminaryRoutePrice");
    expect(dispatcherSource).toContain('testID="preliminary-route-price"');
    expect(dispatcherSource).toContain('PRELIMINARI MARŠRUTO KAINA');
    expect(dispatcherSource).toContain('Preliminari kaina ·');
    expect(dispatcherSource).toContain('Excel automobilio tarifai');
    expect(dispatcherSource).toContain('Įvertinta pagal automobilio dydį');
    expect(dispatcherSource).toContain('Kainos parametrai');
    expect(dispatcherSource).toContain("'/api/admin/route-price-settings'");
  });

  it('routes prepared by dispatchers to assignment while keeping loading as a driver action', () => {
    expect(loadingSource).toContain('testID="assign-planned-route"');
    expect(loadingSource).toContain("pathname: '/dispatcher', params: { routeId }");
    expect(loadingSource).toContain('router.replace({ pathname: \'/dispatcher\'');
    expect(loadingSource).toContain('onPress={openDispatcherAssignment}');
    expect(loadingSource).toContain("profile.role === 'driver'");
    expect(loadingSource).toContain('testID="begin-loading"');
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
    expect(DRIVER_PERMISSION_KEYS).toHaveLength(6);
    expect(Object.values(permissions)).toEqual([false, false, false, false, false, false]);
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

  it('explains how to recover when another web tab holds the SQLite database', () => {
    expect(layoutSource).toContain('NoModificationAllowedError');
    expect(layoutSource).toContain('Uždarykite kitą TSP kortelę');
    expect(layoutSource).toContain('setDbError(localDatabaseError(error))');
  });

  it('renders administrator permission switches and enforces the route actions in driver screens', () => {
    expect(adminSource).toContain('DRIVER_PERMISSION_KEYS.map');
    expect(adminSource).toContain('Vairuotojo leidimai');
    expect(loadingSource).toContain('profile.permissions?.canReorderAssignedRoute');
    expect(loadingSource).toContain('profile.permissions?.canCancelRoute');
    expect(deliverySource).toContain('profile.permissions?.canAddStops');
    expect(deliverySource).toContain('profile.permissions?.canRecalculateRoute');
  });

  it('lets administrators cancel or permanently delete a blocking route', () => {
    expect(adminSource).toContain('testID="route-management"');
    expect(adminSource).toContain('cancelRoute(route)');
    expect(adminSource).toContain('deleteRoute(route)');
    expect(adminSource).toContain("route.status === 'planned'");
  });
});

