export type FuelEntryAssignmentStatus = 'assigned' | 'downloaded' | 'in_progress' | 'completed' | 'cancelled';
export type FuelEntryAssignmentContext = 'trip_sheet' | 'active_route';

/**
 * Trip-sheet editing remains historical/completed-only. The route endpoint may
 * record a real fill while the route is still active, plus retry after close.
 */
export function canAddFuelEntryToAssignment(
  status: FuelEntryAssignmentStatus,
  context: FuelEntryAssignmentContext,
): boolean {
  return status === 'completed' || (context === 'active_route' && status === 'in_progress');
}

export function selectRouteFuelAssignment<T extends { routeId: string; status: FuelEntryAssignmentStatus }>(
  assignments: readonly T[],
  routeId: string,
): T | undefined {
  const matching = assignments.filter((assignment) =>
    assignment.routeId === routeId && canAddFuelEntryToAssignment(assignment.status, 'active_route'));
  return matching.find((assignment) => assignment.status === 'in_progress')
    ?? matching.find((assignment) => assignment.status === 'completed');
}
