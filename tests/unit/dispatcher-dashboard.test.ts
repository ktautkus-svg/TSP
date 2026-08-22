import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DRIVER_PERMISSION_KEYS,
  canEnterTripReadings,
  normalizeDriverPermissions,
} from '../../src/application/auth/employee-permissions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dispatcherHomeSource = readFileSync(resolve(root, 'src/app/dispatcher.tsx'), 'utf8');
const dispatcherSource = readFileSync(resolve(root, 'src/app/route-management.tsx'), 'utf8');
const adminSource = readFileSync(resolve(root, 'src/app/admin.tsx'), 'utf8');
const homeSource = readFileSync(resolve(root, 'src/app/index.tsx'), 'utf8');
const loadingSource = readFileSync(resolve(root, 'src/app/route/[id]/loading.tsx'), 'utf8');
const deliverySource = readFileSync(resolve(root, 'src/app/route/[id]/delivery.tsx'), 'utf8');
const layoutSource = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');

describe('dispatcher desktop workspace', () => {
  it('requires choosing a route before showing the assignment workflow', () => {
    expect(dispatcherSource).toContain('testID="route-first-selection"');
    expect(dispatcherSource).toContain('testID="active-assignment-management"');
    expect(dispatcherSource).toContain('Pašalinti priskyrimą');
    expect(dispatcherSource).toContain("mode: 'management'");
    expect(dispatcherSource).toContain('testID="route-assignment-form"');
    expect(dispatcherSource).toContain('Pasirinkite maršrutą');
    expect(dispatcherSource).toContain('Keisti eiliškumą');
    expect(dispatcherSource).toContain('Peržiūrėti');
    expect(dispatcherSource).toContain('1. Vairuotojas');
    expect(dispatcherSource).toContain('2. Automobilis');
    expect(dispatcherSource).toContain('SelectionDropdown');
    expect(dispatcherSource).toContain("const [openPicker, setOpenPicker] = useState<'route' | 'driver' | 'vehicle' | null>(null)");
    expect(dispatcherSource).toContain('Priskirti maršrutą');
    expect(dispatcherSource).toContain('describeVehicleLoad');
    expect(dispatcherSource).toContain('testID="vehicle-load-percent"');
    expect(dispatcherSource).toContain('Apkrova');
    expect(dispatcherSource).toContain('Niekas neparenkama automatiškai');
    expect(dispatcherSource).not.toContain('availableDrivers[0]');
    expect(dispatcherSource).not.toContain('availableVehicles[0]');
    expect(dispatcherSource).not.toContain("assignableRoutes[0]?.id");
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
    expect(dispatcherSource).toContain("WHERE status <> 'cancelled'");
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

  it('edits an assigned route date in a focused dialog before the route starts', () => {
    expect(dispatcherSource).toContain('testID="assignment-date-editor"');
    expect(dispatcherSource).toContain("method: 'PATCH'");
    expect(dispatcherSource).toContain('Išsaugoti datą');
  });

  it('lets an administrator close a hanging assignment without deleting it', () => {
    expect(dispatcherSource).toContain('completeAssignedRoute');
    expect(dispatcherSource).toContain('AdminCompleteRoute');
    expect(dispatcherSource).toContain('testID={`complete-assignment-${assignment.id}`}');
    expect(dispatcherSource).toContain('Užbaigti šį maršrutą?');
    expect(dispatcherSource).toContain('activeAssignmentCard');
    expect(dispatcherSource).toContain('routeCompleteAction');
    expect(dispatcherSource).toContain('routeEditAction');
    expect(adminSource).toContain('completeAssignedRoute');
    expect(adminSource).toContain('completeLocalRoute');
  });

  it('opens planned-route reordering on the alternatives screen so the map stays visible', () => {
    expect(dispatcherSource).toContain('ReopenRouteForPlanning');
    expect(dispatcherSource).toContain("pathname: '/route/[id]/alternatives'");
    expect(dispatcherSource).toContain("edit: 'order'");
  });

  it('lets the dispatcher safely remove duplicate or unnecessary planned routes in place', () => {
    expect(dispatcherSource).toContain('TrashIcon');
    expect(dispatcherSource).toContain('routeDeleteAction');
    expect(dispatcherSource).toContain("await new CancelDraftRoute(db).execute(route.id)");
    expect(dispatcherSource).toContain('await markRouteDeletedForCloud(db, route.id)');
    expect(dispatcherSource).toContain("['loading', 'loaded', 'in_progress'].includes(route.status)");
    expect(dispatcherSource).toContain('Vykdomo maršruto ištrinti negalima');
    expect(dispatcherSource).toContain('Prisijungus ištrynimas bus sinchronizuotas');
  });

  it('shows the Excel-derived preliminary route price before assignment', () => {
    expect(dispatcherSource).toContain("estimatePreliminaryRoutePrice");
    expect(dispatcherSource).toContain('testID="preliminary-route-price"');
    expect(dispatcherSource).toContain('PRELIMINARI MARŠRUTO KAINA');
    expect(dispatcherSource).toContain('Excel automobilio tarifai');
    expect(dispatcherSource).toContain('Įvertinta pagal automobilio dydį');
    expect(dispatcherHomeSource).toContain('Finansiniai duomenys');
    expect(dispatcherSource).toContain("'/api/admin/route-price-settings'");
  });

  it('routes prepared by dispatchers to assignment while keeping loading as a driver action', () => {
    expect(loadingSource).toContain('testID="assign-planned-route"');
    expect(loadingSource).toContain("pathname: '/route-management', params: { routeId }");
    expect(loadingSource).toContain('router.replace({ pathname: \'/route-management\'');
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
    expect(DRIVER_PERMISSION_KEYS).toHaveLength(7);
    expect(Object.values(permissions)).toEqual([false, false, false, false, false, false, false]);
  });

  it('preserves explicitly enabled permissions while filling missing values', () => {
    const permissions = normalizeDriverPermissions({ canReorderAssignedRoute: true });
    expect(permissions.canReorderAssignedRoute).toBe(true);
    expect(permissions.canCancelRoute).toBe(false);
    expect(permissions.canEnterTripReadings).toBe(false);
  });

  it('lets admins, dispatchers and granted users enter trip-sheet odometer and fuel', () => {
    expect(canEnterTripReadings({ role: 'admin' })).toBe(true);
    expect(canEnterTripReadings({ role: 'dispatcher' })).toBe(true);
    expect(canEnterTripReadings({ role: 'driver' })).toBe(false);
    expect(canEnterTripReadings({ role: 'driver', permissions: { canEnterTripReadings: true } })).toBe(true);
    expect(canEnterTripReadings({ role: 'quality' })).toBe(false);
    expect(canEnterTripReadings({ role: 'quality', permissions: { canEnterTripReadings: true } })).toBe(true);
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

  it('starts from a task menu instead of an assignment form', () => {
    expect(dispatcherHomeSource).toContain('testID="dispatcher-home-menu"');
    expect(dispatcherHomeSource).toContain('testID="dispatcher-primary-actions"');
    expect(dispatcherHomeSource).toContain('Kurti maršrutą');
    expect(dispatcherHomeSource).toContain('Redaguoti ir priskirti');
    expect(dispatcherHomeSource).toContain('title="Automobiliai"');
    expect(dispatcherHomeSource).toContain('title="Vairuotojai"');
    expect(dispatcherHomeSource).toContain('Finansiniai duomenys');
    expect(dispatcherHomeSource).toContain('Kelionės lapai');
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

  it('lets administrators complete, cancel or permanently delete a blocking route', () => {
    expect(adminSource).toContain('testID="route-management"');
    expect(adminSource).toContain('cancelRoute(route)');
    expect(adminSource).toContain('deleteRoute(route)');
    expect(adminSource).toContain('completeLocalRoute(route)');
    expect(adminSource).toContain("route.status === 'planned'");
  });
});

