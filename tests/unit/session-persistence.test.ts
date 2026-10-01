import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PIN_GRACE_PERIOD_MS, shouldRestoreSessionWithoutPin } from '../../src/application/auth/session-persistence';
import {
  decideSessionRenewal,
  DRIVER_SESSION_MS,
  sessionLifetimeMs,
  sessionMaxAgeSeconds,
  STANDARD_SESSION_MS,
} from '../../src/domain/session-lifetime';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gate = readFileSync(resolve(root, 'src/components/local-access-gate.tsx'), 'utf8');
const store = readFileSync(resolve(root, 'server/employee-auth-store.ts'), 'utf8');

const now = Date.parse('2026-09-29T12:00:00.000Z');

describe('driver session persistence', () => {
  it('keeps a driver unlocked without a fresh PIN and still limits other roles to four hours', () => {
    expect(shouldRestoreSessionWithoutPin({
      role: 'driver',
      lastUnlockedAt: null,
      nowMs: now,
    })).toBe(true);
    expect(shouldRestoreSessionWithoutPin({
      role: 'driver',
      lastUnlockedAt: new Date(now - 30 * 86_400_000).toISOString(),
      nowMs: now,
    })).toBe(true);
    expect(shouldRestoreSessionWithoutPin({
      role: 'admin',
      lastUnlockedAt: new Date(now - PIN_GRACE_PERIOD_MS + 1_000).toISOString(),
      nowMs: now,
    })).toBe(true);
    expect(shouldRestoreSessionWithoutPin({
      role: 'admin',
      lastUnlockedAt: new Date(now - PIN_GRACE_PERIOD_MS - 1_000).toISOString(),
      nowMs: now,
    })).toBe(false);
    expect(shouldRestoreSessionWithoutPin({
      role: 'dispatcher',
      lastUnlockedAt: null,
      nowMs: now,
    })).toBe(false);
    expect(shouldRestoreSessionWithoutPin({
      role: 'quality',
      lastUnlockedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      nowMs: now,
    })).toBe(false);
    expect(gate).toContain('shouldRestoreSessionWithoutPin');
    expect(gate).toContain('PIN_GRACE_PERIOD_MS');
  });

  it('renews an expired driver session only while a route is in progress', () => {
    const expired = now - 1_000;
    expect(decideSessionRenewal({ role: 'driver', expiresAtMs: expired, nowMs: now, hasActiveRoute: true }).action).toBe('renew');
    expect(decideSessionRenewal({ role: 'driver', expiresAtMs: expired, nowMs: now, hasActiveRoute: false }).action).toBe('expire');
    expect(decideSessionRenewal({ role: 'admin', expiresAtMs: expired, nowMs: now, hasActiveRoute: true }).action).toBe('expire');
    expect(decideSessionRenewal({ role: 'dispatcher', expiresAtMs: now + 86_400_000, nowMs: now, hasActiveRoute: false }).action).toBe('keep');
  });

  it('slides a driver session inside the last week and leaves a fresh admin session unchanged', () => {
    const sliding = decideSessionRenewal({
      role: 'driver',
      expiresAtMs: now + 2 * 86_400_000,
      nowMs: now,
      hasActiveRoute: false,
    });
    expect(sliding.action).toBe('renew');
    expect(decideSessionRenewal({
      role: 'driver',
      expiresAtMs: now + 20 * 86_400_000,
      nowMs: now,
      hasActiveRoute: false,
    }).action).toBe('keep');
    expect(sessionLifetimeMs('driver')).toBe(DRIVER_SESSION_MS);
    expect(sessionLifetimeMs('admin')).toBe(STANDARD_SESSION_MS);
    expect(sessionMaxAgeSeconds('driver')).toBe(365 * 86_400);
    expect(sessionMaxAgeSeconds('dispatcher')).toBe(30 * 86_400);
    expect(store).toContain('decideSessionRenewal');
    expect(store).toContain('isPublicDemoPin');
  });
});
