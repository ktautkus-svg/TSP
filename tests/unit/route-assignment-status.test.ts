import { describe, expect, it } from 'vitest';

import { effectiveAssignmentStatus, isActiveAssignment } from '../../src/application/auth/route-assignment-status';
import type { ServerRouteAssignment } from '../../src/infrastructure/auth/employee-session';

function assignment(status: string, routeStatus: string): ServerRouteAssignment {
  return {
    id: 'assignment-1',
    status,
    routeSnapshot: {
      route: { status: routeStatus },
      stops: [],
    },
  } as unknown as ServerRouteAssignment;
}

describe('route assignment status', () => {
  it('hides an assignment as soon as its route snapshot is completed', () => {
    const completed = assignment('in_progress', 'completed');

    expect(effectiveAssignmentStatus(completed)).toBe('completed');
    expect(isActiveAssignment(completed)).toBe(false);
  });

  it('keeps genuinely operational assignments active', () => {
    const active = assignment('downloaded', 'loading');

    expect(effectiveAssignmentStatus(active)).toBe('downloaded');
    expect(isActiveAssignment(active)).toBe(true);
  });
});
