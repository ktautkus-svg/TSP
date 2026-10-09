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
 * A still-valid session inside the last week slides forward for every role,
 * so returning to the app does not ask for a PIN. An expired session is
 * renewed only for a driver who still has a route in progress.
 */
export function decideSessionRenewal(input: {
  role: EmployeeRole;
  expiresAtMs: number;
  nowMs: number;
  hasActiveRoute: boolean;
}): SessionRenewal {
  const remaining = input.expiresAtMs - input.nowMs;
  if (remaining <= 0) {
    return input.role === 'driver' && input.hasActiveRoute
      ? { action: 'renew', expiresAt: new Date(input.nowMs + DRIVER_SESSION_MS).toISOString() }
      : { action: 'expire' };
  }
  if (remaining < DRIVER_SESSION_SLIDE_THRESHOLD_MS) {
    return { action: 'renew', expiresAt: new Date(input.nowMs + sessionLifetimeMs(input.role)).toISOString() };
  }
  return { action: 'keep' };
}

export function sessionLifetimeMs(role: EmployeeRole): number {
  return role === 'driver' ? DRIVER_SESSION_MS : STANDARD_SESSION_MS;
}

export function sessionMaxAgeSeconds(role: EmployeeRole): number {
  return Math.floor(sessionLifetimeMs(role) / 1000);
}
