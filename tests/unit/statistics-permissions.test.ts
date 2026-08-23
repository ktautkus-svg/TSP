import { describe, expect, it } from 'vitest';

import { canViewOrgStatistics } from '../../src/application/auth/employee-permissions';

describe('canViewOrgStatistics', () => {
  it('admin always sees every driver and vehicle', () => {
    expect(canViewOrgStatistics({ role: 'admin' })).toBe(true);
    expect(canViewOrgStatistics({ role: 'admin', permissions: {} })).toBe(true);
  });

  it('dispatcher needs the permission explicitly granted', () => {
    expect(canViewOrgStatistics({ role: 'dispatcher' })).toBe(false);
    expect(canViewOrgStatistics({ role: 'dispatcher', permissions: { canViewAllStatistics: false } })).toBe(false);
    expect(canViewOrgStatistics({ role: 'dispatcher', permissions: { canViewAllStatistics: true } })).toBe(true);
  });

  it('a driver can never see org-wide statistics, whatever the permission bits say', () => {
    expect(canViewOrgStatistics({ role: 'driver' })).toBe(false);
    // Even if a stray/forged permission object claimed it — a driver's own
    // routes and earnings must stay private from other drivers by role alone.
    expect(canViewOrgStatistics({ role: 'driver', permissions: { canViewAllStatistics: true } as never })).toBe(false);
  });

  it('quality role has no org-wide statistics access either, matching the server not exposing it', () => {
    expect(canViewOrgStatistics({ role: 'quality', permissions: { canViewAllStatistics: true } as never })).toBe(false);
  });
});
