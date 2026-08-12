import { describe, expect, it } from 'vitest';

import { groupRouteNumbers, routeNumberLabel } from '@/ui/route-numbers';

describe('route number labels', () => {
  it('collects all unique R numbers assigned to a route', () => {
    expect(groupRouteNumbers([
      { route_id: 'route-1', order_number: '11' },
      { route_id: 'route-1', order_number: 'R15' },
      { route_id: 'route-1', order_number: '11' },
      { route_id: 'route-2', order_number: null },
    ])).toEqual({ 'route-1': 'R11 · R15' });
  });

  it('uses a stable fallback when imported route numbers are unavailable', () => {
    expect(routeNumberLabel('route-204', {})).toBe('R204');
    expect(routeNumberLabel('route-alpha', {})).toBe('Maršrutas ALPHA');
  });
});
