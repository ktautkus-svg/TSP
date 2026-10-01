import type { EmployeeRole } from '@/infrastructure/auth/employee-session';

/**
 * How long an administrator, dispatcher or quality session may stay unlocked
 * after the last successful PIN. Drivers are not limited by this window.
 */
export const PIN_GRACE_PERIOD_MS = 4 * 60 * 60 * 1000;

/**
 * A driver stays signed in on this device until they log out, switch account,
 * or the app data is cleared. Other roles still need the PIN after the grace
 * window, including an administrator who is only acting as a driver.
 */
export function shouldRestoreSessionWithoutPin(input: {
  role: EmployeeRole | undefined;
  demo?: boolean;
  lastUnlockedAt: string | null;
  nowMs: number;
  graceMs?: number;
}): boolean {
  if (!input.role) return false;
  if (input.demo || input.role === 'driver') return true;
  if (!input.lastUnlockedAt) return false;
  const unlockedAt = Date.parse(input.lastUnlockedAt);
  if (!Number.isFinite(unlockedAt)) return false;
  return input.nowMs - unlockedAt < (input.graceMs ?? PIN_GRACE_PERIOD_MS);
}
