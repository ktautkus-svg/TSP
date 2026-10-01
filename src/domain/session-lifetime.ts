import type { EmployeeRole } from '@/infrastructure/auth/employee-session';

/** Drivers keep a device session for a working year. Other roles stay on 30 days. */
export const DRIVER_SESSION_MS = 365 * 86_400_000;
export const STANDARD_SESSION_MS = 30 * 86_400_000;
/** Renew a still-valid driver session once less than a week remains. */
export const DRIVER_SESSION_SLIDE_THRESHOLD_MS = 7 * 86_400_000;

export type SessionRenewal =
  | { action: 'keep' }
  | { action: 'renew'; expiresAt: string }
  | { action: 'expire' };

/**
 * Non-drivers expire exactly when their session says so.
 * A driver with a route still in progress is renewed even after that moment.
 * A driver session that is still valid but inside the last week slides forward.
 */
export function decideSessionRenewal(input: {
  role: EmployeeRole;
  expiresAtMs: number;
  nowMs: number;
  hasActiveRoute: boolean;
}): SessionRenewal {
  const remaining = input.expiresAtMs - input.nowMs;
  if (input.role !== 'driver') {
    return remaining <= 0 ? { action: 'expire' } : { action: 'keep' };
  }
  if (remaining <= 0) {
    return input.hasActiveRoute
      ? { action: 'renew', expiresAt: new Date(input.nowMs + DRIVER_SESSION_MS).toISOString() }
      : { action: 'expire' };
  }
  if (remaining < DRIVER_SESSION_SLIDE_THRESHOLD_MS) {
    return { action: 'renew', expiresAt: new Date(input.nowMs + DRIVER_SESSION_MS).toISOString() };
  }
  return { action: 'keep' };
}

export function sessionLifetimeMs(role: EmployeeRole): number {
  return role === 'driver' ? DRIVER_SESSION_MS : STANDARD_SESSION_MS;
}

export function sessionMaxAgeSeconds(role: EmployeeRole): number {
  return Math.floor(sessionLifetimeMs(role) / 1000);
}
