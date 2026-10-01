import {
  DRIVER_PERMISSION_KEYS,
  MANAGEMENT_PERMISSION_KEYS,
  type EmployeePermissions,
} from '@/application/auth/employee-permissions';
import {
  DEMO_DISPLAY_NAME,
  DEMO_DRIVER_ID,
  DEMO_USERNAME,
} from '@/domain/demo-driver';
import { DRIVER_SESSION_MS } from '@/domain/session-lifetime';
import type { EmployeeSession } from '@/infrastructure/auth/employee-session';

function deniedPermissions(): EmployeePermissions {
  return Object.fromEntries(
    [...DRIVER_PERMISSION_KEYS, ...MANAGEMENT_PERMISSION_KEYS].map((key) => [key, false]),
  ) as EmployeePermissions;
}

/** A driver-only session that never carries a server token or a real employee id. */
export function createDemoEmployeeSession(nowMs = Date.now()): EmployeeSession {
  return {
    demo: true,
    expiresAt: new Date(nowMs + DRIVER_SESSION_MS).toISOString(),
    profile: {
      id: DEMO_DRIVER_ID,
      username: DEMO_USERNAME,
      displayName: DEMO_DISPLAY_NAME,
      role: 'driver',
      disabled: false,
      permissions: deniedPermissions(),
      email: null,
      phone: null,
      compensation: null,
    },
  };
}
