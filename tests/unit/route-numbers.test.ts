import { describe, expect, it } from 'vitest';

import { groupRouteCodes, routeCodeLabel } from '@/ui/route-numbers';

describe('route number labels', () => {
  it('collects all unique R numbers assigned to a route', () => {
    expect(groupRouteCodes([
      { route_id: 'route-1', route_code: 'r11' },
      { route_id: 'route-1', route_code: 'R15' },
      { route_id: 'route-1', route_code: 'R15' },
      { route_id: 'route-1', route_code: 'RS608084' },
      { route_id: 'route-2', route_code: null },
    ])).toEqual({ 'route-1': 'R11 · R15' });
  });

  it('never invents a district code from an internal route id', () => {
    expect(routeCodeLabel('route-204', {})).toBe('Maršrutas');
    expect(routeCodeLabel('route-alpha', {})).toBe('Maršrutas');
  });
});
