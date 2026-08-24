import type { EmployeeRole } from '@/infrastructure/auth/employee-session';

export type RoleHomePath = '/' | '/dispatcher' | '/history' | '/quality-control';

export function roleHomePath(role: EmployeeRole | string): RoleHomePath {
  if (role === 'driver') return '/';
  if (role === 'dispatcher') return '/dispatcher';
  if (role === 'quality') return '/quality-control';
  return '/';
}
