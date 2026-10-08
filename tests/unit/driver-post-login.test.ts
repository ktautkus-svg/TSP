import { describe, expect, it } from 'vitest';

import { resolveDriverPostLogin } from '../../src/application/routes/driver-post-login';

const assigned = { id: 'route-1', status: 'planned', date: '2026-10-08' };

describe('driver post-login destination', () => {
  it('does not show an empty list before sync, and opens the continue screen when the server has a route', () => {
    expect(resolveDriverPostLogin({ syncState: 'pending', routes: [] }).kind).toBe('wait');
    expect(resolveDriverPostLogin({ syncState: 'failed', routes: [] }).kind).toBe('unavailable');
    expect(resolveDriverPostLogin({ syncState: 'ready', routes: [assigned] })).toEqual({ kind: 'continue', route: assigned });
    expect(resolveDriverPostLogin({ syncState: 'ready', routes: [] })).toEqual({ kind: 'empty' });
  });

  it('returns a started route to execution and offers a choice when several are waiting', () => {
    const started = { id: 'route-2', status: 'in_progress', date: '2026-10-08' };
    const other = { id: 'route-3', status: 'planned', date: '2026-10-09' };
    expect(resolveDriverPostLogin({ syncState: 'ready', routes: [assigned, started] }).kind).toBe('continue');
    expect(resolveDriverPostLogin({ syncState: 'ready', routes: [assigned, other] }).kind).toBe('choose');
  });
});
