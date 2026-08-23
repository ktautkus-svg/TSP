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

describe('administrator workspace navigation', () => {
  it('shows administrator tools instead of automatically continuing a local route', () => {
    expect(home).toContain('testID="admin-home-menu"');
    expect(home).toContain('title="Dispečerio skydelis"');
    expect(home).not.toContain('title="Maršrutai"');
    expect(home).toContain('Kokybės kontrolė');
    expect(home).toContain('Vykdyti maršrutą');
    expect(home).toContain('Kelionės lapai');
    expect(home).toContain('<MenuArtwork kind="trip-sheet" />');
    expect(home).toContain('title="Automobiliai"');
    expect(home).toContain('title="Vairuotojai"');
    expect(home).toContain('title="Finansai"');
    expect(home).toMatch(/profile\.role === ['"]admin['"]\s*\?\s*\[\]/);
  });

  it('opens focused employee and vehicle editors from visible settings shortcuts', () => {
    expect(settings).toContain('testID="admin-management-shortcuts"');
    expect(settings).toContain("params: { section: 'employees', returnTo: 'settings' }");
    expect(settings).toContain("params: { section: 'fleet', returnTo: 'settings' }");
    expect(settings).toContain('testID="open-employee-management"');
    expect(settings).toContain('testID="open-vehicle-management"');
    expect(admin).toContain("requestedSection === 'employees' || requestedSection === 'fleet'");
    expect(admin).toContain("if (focus) setExpandedSection(focus)");
    expect(appLayout).toContain('headerLeft: () => <StackBackButton />');
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
    expect(roleHome).toContain("if (role === 'driver') return '/history'");
    expect(routes).not.toContain('routes-back-home');
  });

  it('lets an administrator choose a driver assignment before executing it', () => {
    expect(execute).toContain("employeeApi<{ assignments: ServerRouteAssignment[] }>('/api/admin/assignments')");
    expect(execute).toContain('setSelectedDriverId');
    expect(execute).toContain('importAssignmentSnapshot(db, selectedAssignment, selectedAssignment.driverId)');
    expect(execute).toContain('Vykdyti pasirinktą maršrutą');
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
});
