import { describe, expect, it } from 'vitest';
import { fuelAnchorFor, normalizeFuelReport, type FuelReport } from '../../server/employee-auth-store';

function report(overrides: Partial<FuelReport>): FuelReport {
  return normalizeFuelReport({
    id: overrides.id ?? 'r1',
    driverId: 'driver-1',
    driverName: 'Vairuotojas',
    vehicleId: 'MET630',
    registrationNumber: 'MET630',
    assignmentRevision: 0,
    previousLiters: null,
    reportedLiters: 100,
    status: 'approved',
    reportedAt: '2026-01-01T08:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    effectiveAt: '2026-01-01',
    kind: 'driver_report',
    note: null,
    ...overrides,
  } as FuelReport);
}

describe('kuro likučio atrama', () => {
  it('ima naujausią patvirtintą likutį iki laikotarpio pradžios', () => {
    const reports = [
      report({ id: 'a', effectiveAt: '2025-12-01', reportedLiters: 40 }),
      report({ id: 'b', effectiveAt: '2026-01-01', reportedLiters: 110 }),
      report({ id: 'c', effectiveAt: '2026-02-01', reportedLiters: 75 }),
    ];
    expect(fuelAnchorFor(reports, 'MET630', '2026-01-15')).toEqual({ liters: 110, effectiveAt: '2026-01-01' });
  });

  it('nepaima vėlesnių už laikotarpį korekcijų', () => {
    const reports = [report({ id: 'b', effectiveAt: '2026-03-01', reportedLiters: 110 })];
    expect(fuelAnchorFor(reports, 'MET630', '2026-01-15')).toBeNull();
  });

  it('nepaima nepatvirtintų ir atmestų', () => {
    const reports = [
      report({ id: 'p', effectiveAt: '2026-01-01', reportedLiters: 90, status: 'pending' }),
      report({ id: 'r', effectiveAt: '2026-01-02', reportedLiters: 80, status: 'rejected' }),
    ];
    expect(fuelAnchorFor(reports, 'MET630', '2026-01-15')).toBeNull();
  });

  it('neima kito automobilio likučio', () => {
    const reports = [report({ id: 'x', vehicleId: 'NLL182', reportedLiters: 55 })];
    expect(fuelAnchorFor(reports, 'MET630', '2026-01-15')).toBeNull();
  });

  it('seniems įrašams be datos ima įvedimo laiką', () => {
    const legacy = normalizeFuelReport({
      ...report({}),
      effectiveAt: undefined,
      kind: undefined,
    } as unknown as FuelReport);
    expect(legacy.effectiveAt).toBe('2026-01-01');
    expect(legacy.kind).toBe('driver_report');
  });
});
