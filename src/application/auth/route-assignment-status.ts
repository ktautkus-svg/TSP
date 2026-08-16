import type { ServerRouteAssignment } from '@/infrastructure/auth/employee-session';

const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

export function effectiveAssignmentStatus(assignment: ServerRouteAssignment): string {
  const routeStatus = String(assignment.routeSnapshot.route.status ?? '');
  return TERMINAL_STATUSES.has(routeStatus) ? routeStatus : assignment.status;
}

export function isActiveAssignment(assignment: ServerRouteAssignment): boolean {
  return !TERMINAL_STATUSES.has(effectiveAssignmentStatus(assignment));
}
