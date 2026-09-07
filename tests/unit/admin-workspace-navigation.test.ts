import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const home = readFileSync(resolve(root, 'src/app/index.tsx'), 'utf8');
const execute = readFileSync(resolve(root, 'src/app/execute-route.tsx'), 'utf8');
const admin = readFileSync(resolve(root, 'src/app/admin.tsx'), 'utf8');
const quality = readFileSync(resolve(root, 'src/app/quality-control.tsx'), 'utf8');
const settings = readFileSync(resolve(root, 'src/app/settings/index.tsx'), 'utf8');
const routeManagement = readFileSync(resolve(root, 'src/app/route-management.tsx'), 'utf8');
const routes = readFileSync(resolve(root, 'src/app/history.tsx'), 'utf8');
const appLayout = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');
const stackNavigation = readFileSync(resolve(root, 'src/components/stack-navigation.tsx'), 'utf8');
const roleHome = readFileSync(resolve(root, 'src/application/navigation/role-home.ts'), 'utf8');
const dateInput = readFileSync(resolve(root, 'src/components/date-input.tsx'), 'utf8');

describe('administrator workspace navigation', () => {
  it('shows administrator tools instead of automatically continuing a local route', () => {
    expect(home).toContain('testID="admin-home-menu"');
    expect(home).toContain('title="Dispečerio skydelis"');
    expect(home).not.toContain('title="Maršrutai"');
    expect(home).toContain('Kokybės kontrolė');
    expect(home).not.toContain('Vykdyti maršrutą');
    // Kelionės lapai lives only on the dispatcher dashboard now — the admin
    // home menu no longer duplicates it.
    expect(home).not.toContain('Kelionės lapai');
    expect(home).toContain('title="Automobiliai"');
    expect(home).toContain('title="Vairuotojai"');
    expect(home).toContain('title="Finansai"');
    // The admin menu itself only renders when not driving as a chosen driver
    // (see the "VAIRUOTI KAIP" picker test below) — an admin with no acting
    // driver selected still sees an empty operational list.
    expect(home).toMatch(/showDriverDashboard\s*\?\s*await repository\.listOperational\(effectiveDriverId\)\s*:\s*\[\]/);
  });

  it('uses one focused flow for choosing and driving as a driver — from the dispatcher, not the admin home', () => {
    const dispatcher = readFileSync(resolve(root, 'src/app/dispatcher.tsx'), 'utf8');
    expect(home).not.toContain('testID="acting-driver-picker"');
    // "Vykdyti vairuotojo maršrutą" lives only on the dispatcher now.
    expect(home).not.toContain("router.push('/execute-route' as Href)");
    expect(dispatcher).toContain("open('/execute-route' as Href)");
    expect(execute).toContain('await setActingDriver({ id: driver.id, displayName: driver.displayName })');
    expect(home).toContain('testID="acting-driver-banner"');
    expect(home).toContain('Vairuojate kaip');
    expect(home).toContain('void setActingDriver(null)');
  });

  it('keeps only a user-accounts shortcut in settings; drivers and vehicles live on the home menu', () => {
    expect(settings).toContain('testID="admin-management-shortcuts"');
    expect(settings).toContain("params: { section: 'employees', returnTo: 'settings' }");
    expect(settings).toContain('testID="open-employee-management"');
    expect(settings).toContain('<Text style={styles.title}>Vartotojai</Text>');
    // Vehicles are not duplicated in settings.
    expect(settings).not.toContain('testID="open-vehicle-management"');
    expect(settings).not.toContain("params: { section: 'fleet', returnTo: 'settings' }");
    expect(admin).toContain("requestedSection === 'employees' || requestedSection === 'fleet'");
    expect(appLayout).toContain('headerLeft: () => <StackBackButton />');
    // The home menu still carries drivers + vehicles.
    expect(home).toContain('title="Automobiliai"');
    expect(home).toContain('title="Vairuotojai"');
  });

  it('edits the route date inline in the assign step and drops the @username handle', () => {
    // Date is editable in the same step (no separate screen / disabled field).
    expect(routeManagement).toContain('testID="assign-date-inline"');
    expect(routeManagement).toContain('const [assignDate, setAssignDate] = useState');
    expect(routeManagement).toContain('assignDate && assignDate !== selectedRoute.date');
    expect(routeManagement).toContain('formatDate(assignDate || selectedRoute.date)');
    // Driver picker shows the display name only — never "@username".
    expect(routeManagement).not.toContain('@${selectedDriver.username}');
    expect(routeManagement).not.toContain('@{driver.username}');
  });

  it('keeps a visible deterministic exit inside both route workspaces', () => {
    expect(routeManagement).toContain('Redaguoti vairuotojus →');
    expect(routeManagement).toContain('Redaguoti automobilius →');
    expect(stackNavigation).not.toContain('router.canGoBack()');
    expect(stackNavigation).not.toContain('router.back()');
    expect(stackNavigation).toContain('router.replace(navigation.backTarget)');
    expect(stackNavigation).toContain('router.replace(navigation.homeTarget)');
    expect(stackNavigation).toContain('roleHomePath(profile.role)');
    expect(roleHome).toContain("if (role === 'dispatcher') return '/dispatcher'");
    expect(roleHome).toContain("if (role === 'driver') return '/'");
    expect(routes).not.toContain('routes-back-home');
  });

  it('lets an administrator choose a driver assignment before executing it', () => {
    expect(execute).toContain("employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments')");
    expect(execute).toContain('setSelectedDriverId');
    expect(execute).toContain('importAssignmentSnapshot(db, selectedAssignment, selectedAssignment.driverId)');
    expect(execute).toContain('prepareAssignmentSnapshotImport(db, selectedAssignment, assignments)');
    expect(execute).toContain('Vykdyti pasirinktą maršrutą');
  });

  it('marks the device as driving as the selected driver so the route stays operable, not just viewable', () => {
    // Importing the assignment alone left every driver-only action on the
    // route (starting loading, etc.) unreachable, since those were gated to
    // a real driver-role login only — this is what "neleidžia važiuoti"
    // (won't let me drive) turned out to be.
    expect(execute).toContain('await setActingDriver({ id: driver.id, displayName: driver.displayName })');
    expect(home).toContain('drivingAsProxy'); // sanity: same acting-driver concept used on the home screen
  });

  it('keeps all administration groups collapsed until their heading is pressed', () => {
    expect(admin).toContain('const [expandedSection, setExpandedSection] = useState<string | null>(null)');
    expect(admin).toContain('function CollapsibleHeader');
    expect(admin).toContain("expandedSection === 'employees'");
    expect(admin).toContain("expandedSection === 'route-assignment'");
    expect(admin).toContain("expandedSection === 'fleet'");
  });

  it('shows planned or actual start and the complete ordered stop list in quality control', () => {
    expect(quality).toContain("route.startedAt ? 'REALUS STARTAS' : 'PLANUOTAS STARTAS'");
    expect(quality).toContain('VISAS MARŠRUTO EILIŠKUMAS');
    expect(quality).toContain('route.stops.map');
    expect(quality).toContain('function RouteSequenceStop');
  });

  it('keeps the administrator home groups in the requested responsive grids', () => {
    expect(home).toContain('<GroupedMenuSection columns label="MARŠRUTIZAVIMAS"');
    expect(home).toContain('<GroupedMenuSection columns label="STEBĖJIMAS IR APSKAITA"');
    expect(home).toContain('<GroupedMenuSection columns label="SISTEMA"');
    expect(home.indexOf('title="Kokybės kontrolė"')).toBeLessThan(home.indexOf('label="STEBĖJIMAS IR APSKAITA"'));
  });

  it('keeps the quality-control period input on the native calendar even with an external keyboard', () => {
    expect(quality).toContain('<PeriodCalendarPicker');
    expect(dateInput).toContain("node.type = 'date'");
    expect(dateInput).toContain('node?.showPicker?.()');
  });
});
