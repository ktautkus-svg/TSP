import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  canViewOrgStatistics,
  canViewStatisticsEarnings,
  localStatisticsOwnerId,
} from '../../src/application/auth/employee-permissions';

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
    expect(canViewOrgStatistics({ role: 'driver', permissions: { canViewAllStatistics: true } as never })).toBe(false);
  });

  it('quality sees organisation routes — they already monitor every live route', () => {
    expect(canViewOrgStatistics({ role: 'quality' })).toBe(true);
    expect(canViewOrgStatistics({ role: 'quality', permissions: {} })).toBe(true);
  });
});

describe('statistics owner and earnings gates', () => {
  it('quality local SQLite is scoped to their own id so a shared tablet cannot leak other drivers', () => {
    expect(localStatisticsOwnerId({ role: 'quality', id: 'quality-1' })).toBe('quality-1');
    expect(localStatisticsOwnerId({ role: 'driver', id: 'driver-1' })).toBe('driver-1');
    expect(localStatisticsOwnerId({ role: 'admin', id: 'admin-1' })).toBeNull();
    expect(localStatisticsOwnerId({ role: 'dispatcher', id: 'disp-1' })).toBeNull();
  });

  it('earnings stay off for drivers until canViewCompensation is granted, and quality never sees pay', () => {
    expect(canViewStatisticsEarnings({ role: 'driver' })).toBe(false);
    expect(canViewStatisticsEarnings({ role: 'driver', permissions: { canViewCompensation: true } })).toBe(true);
    expect(canViewStatisticsEarnings({ role: 'admin' })).toBe(true);
    expect(canViewStatisticsEarnings({ role: 'dispatcher' })).toBe(true);
    expect(canViewStatisticsEarnings({ role: 'quality' })).toBe(false);
  });
});

describe('statistics screen copy', () => {
  it('does not present a silent 0 € when trip sheets were not loaded', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app/statistics.tsx'), 'utf8');
    expect(source).not.toContain('tripSheets.length === 0 ? true');
    expect(source).toContain('statistics-earnings-offline');
    expect(source).toContain('Atlygio duomenys neprieinami neprisijungus');
    expect(source).toContain('Matyti atlygio skaičiavimą');
    expect(source).toContain('visibleTabs');
  });
});
