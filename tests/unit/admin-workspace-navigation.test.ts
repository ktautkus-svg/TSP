import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const home = readFileSync(resolve(root, 'src/app/index.tsx'), 'utf8');
const execute = readFileSync(resolve(root, 'src/app/execute-route.tsx'), 'utf8');
const admin = readFileSync(resolve(root, 'src/app/admin.tsx'), 'utf8');
const quality = readFileSync(resolve(root, 'src/app/quality-control.tsx'), 'utf8');

describe('administrator workspace navigation', () => {
  it('shows administrator tools instead of automatically continuing a local route', () => {
    expect(home).toContain('testID="admin-home-menu"');
    expect(home).toContain('Kokybės kontrolė');
    expect(home).toContain('Vykdyti maršrutą');
    expect(home).toContain("profile.role === 'admin'\n          ? []");
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
