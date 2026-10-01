export type FuelEntryAssignmentStatus = 'assigned' | 'downloaded' | 'in_progress' | 'completed' | 'cancelled';
export type FuelEntryAssignmentContext = 'trip_sheet' | 'active_route';

/**
 * Trip-sheet editing remains historical/completed-only. The route endpoint may
 * record a real fill while the route is still active, before progress has been
 * published, and again as a retry after the route is closed.
 */
export function canAddFuelEntryToAssignment(
  status: FuelEntryAssignmentStatus,
  context: FuelEntryAssignmentContext,
): boolean {
  if (status === 'cancelled') return false;
  if (context === 'trip_sheet') return status === 'completed';
  return status === 'in_progress' || status === 'completed' || status === 'downloaded' || status === 'assigned';
}

export function selectRouteFuelAssignment<T extends { routeId: string; status: FuelEntryAssignmentStatus }>(
  assignments: readonly T[],
  routeId: string,
): T | undefined {
  const matching = assignments.filter((assignment) =>
    assignment.routeId === routeId && canAddFuelEntryToAssignment(assignment.status, 'active_route'));
  return matching.find((assignment) => assignment.status === 'in_progress')
    ?? matching.find((assignment) => assignment.status === 'downloaded')
    ?? matching.find((assignment) => assignment.status === 'assigned')
    ?? matching.find((assignment) => assignment.status === 'completed');
}
