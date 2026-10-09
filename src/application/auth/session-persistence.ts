import type { EmployeeRole } from '@/infrastructure/auth/employee-session';

/**
 * A signed-in session stays unlocked until logout, account disable, or a
 * session that cannot be restored. PIN is not asked again after a few hours
 * or when the app returns from the background.
 */
export const PIN_GRACE_PERIOD_MS = 365 * 86_400_000;

export function shouldRestoreSessionWithoutPin(input: {
  role: EmployeeRole | undefined;
  demo?: boolean;
  disabled?: boolean;
  lastUnlockedAt: string | null;
  nowMs: number;
  graceMs?: number;
}): boolean {
  if (!input.role || input.disabled) return false;
  if (input.demo || input.role === 'driver' || input.role === 'admin' || input.role === 'dispatcher' || input.role === 'quality') {
    return true;
  }
  return false;
}