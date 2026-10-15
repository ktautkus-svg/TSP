import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { assignmentHasDeliveryHistory } from '../../src/application/routes/assignment-retention';
import { actualFuelCostEur, consumedLitersForSingleRoute, predictFuelCostEur } from '../../src/application/routes/route-fuel-cost';
import { vehicleDocumentLabel, vehicleDocumentState } from '../../src/domain/vehicle-document-status';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('dispatcher operations controls', () => {
  const assignments = read('src/app/route-management.tsx');
  const api = read('server/employee-api.ts');
  const store = read('server/employee-auth-store.ts');
  const layout = read('src/app/_layout.tsx');
  const overview = read('src/app/route/[id]/overview.tsx');
  const documents = read('src/app/vehicle-documents.tsx');

  it('shows four equal assignment actions and refuses to delete delivery history', () => {
    expect(assignments).toContain('testID={`view-assignment-${assignment.id}`}');
    expect(assignments).toContain('testID={`edit-assignment-${assignment.id}`}');
    expect(assignments).toContain('testID={`delete-assignment-${assignment.id}`}');
    expect(assignments).toContain('testID={`complete-assignment-${assignment.id}`}');
    expect(assignments).toContain('>Peržiūrėti<');
    expect(assignments).toContain('>Redaguoti<');
    expect(assignments).toContain('>Ištrinti<');
    expect(assignments).toContain('>Užbaigti<');
    expect(assignments).toContain('assignmentHasDeliveryHistory');
    expect(assignments).toContain("mode: 'management'");
    expect(store).toContain('ASSIGNMENT_HAS_HISTORY');
    expect(assignmentHasDeliveryHistory('completed', [])).toBe(true);
    expect(assignmentHasDeliveryHistory('assigned', [{ delivery_status: 'pending' }])).toBe(false);
  });

  it('keeps fuel price edits behind financial permission and separate from the estimate', () => {
    expect(overview).toContain("'/api/admin/route-price-settings'");
    expect(overview).toContain("method: 'PATCH'");
    expect(overview).toContain('canManageFinancials');
    expect(overview).toContain('consumedLitersForSingleRoute');
    expect(predictFuelCostEur({ distanceKm: 100, litersPer100Km: 13.2, pricePerLiter: 1.5, consumedLiters: null })).toBe(19.8);
    expect(actualFuelCostEur({ distanceKm: null, litersPer100Km: null, pricePerLiter: 1.5, consumedLiters: 20 })).toBe(30);
    expect(consumedLitersForSingleRoute({ litersPer100Km: 10, odometerKm: 50, routeCountOnVehicleDay: 2 })).toBeNull();
  });

  it('lets quality read vehicle documents and blocks drivers from that screen', () => {
    expect(api).toContain("profile.role === 'quality'");
    expect(api).toContain('technicalInspectionDueOn: optionalIsoDateField');
    expect(layout).toContain("pathname === '/vehicle-documents'");
    expect(documents).toContain('Civilinis draudimas');
    expect(documents).toContain('canManageVehicles');
    expect(documents).not.toContain("method: 'PATCH'");
    expect(vehicleDocumentLabel(vehicleDocumentState('2026-11-01', '2026-10-01'))).toBe('Galioja');
    expect(vehicleDocumentLabel(vehicleDocumentState(null, '2026-10-01'))).toBe('Nenurodyta');
  });
});
