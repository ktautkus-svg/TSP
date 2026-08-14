import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adminSource = readFileSync('src/app/admin.tsx', 'utf8');
const apiSource = readFileSync('server/employee-api.ts', 'utf8');
const storeSource = readFileSync('server/employee-auth-store.ts', 'utf8');
const deliverySource = readFileSync('src/app/route/[id]/delivery.tsx', 'utf8');
const routesSource = readFileSync('src/app/history.tsx', 'utf8');

describe('responsive administration workspace', () => {
  it('lets an administrator edit employee identity, role and optional PIN', () => {
    expect(adminSource).toContain('testID="employee-edit-form"');
    expect(adminSource).toContain('displayName: editEmployeeName');
    expect(adminSource).toContain('role: editEmployeeRole');
    expect(adminSource).toContain('patch.pin = editEmployeePin');
    expect(adminSource).toContain('email: editEmployeeEmail');
    expect(adminSource).toContain('phone: editEmployeePhone');
    expect(apiSource).toContain("email: optionalString(body, 'email')");
    expect(storeSource).toContain('function validateEmail');
    expect(storeSource).toContain('function validatePhone');
  });

  it('keeps long management areas collapsed and only expands driver permissions while editing', () => {
    expect(adminSource).toContain('const [expandedSection, setExpandedSection] = useState<string | null>(null)');
    expect(adminSource).toContain("selectedEmployee && editEmployeeRole === 'driver'");
    expect(adminSource).not.toContain("employee.role === 'driver' ? <View style={styles.permissions}");
  });

  it('edits fleet vehicle identity and capacity through the server API', () => {
    expect(adminSource).toContain('testID="vehicle-edit-form"');
    expect(apiSource).toContain('store.updateVehicle');
    expect(storeSource).toContain('async updateVehicle');
    expect(storeSource).toContain('transaction.create(nextRef, updated)');
    expect(storeSource).toContain('transaction.delete(currentRef)');
  });

  it('uses dedicated desktop, tablet and mobile layout thresholds', () => {
    expect(adminSource).toContain('width >= 1100');
    expect(adminSource).toContain('width >= 720');
    expect(adminSource).toContain('workspaceDesktop');
    expect(deliverySource).toContain('viewportWidth >= 720');
    expect(deliverySource).toContain('dashboardWide');
    expect(routesSource).toContain('width >= 1100');
    expect(routesSource).toContain('routeGridWide');
  });
});
