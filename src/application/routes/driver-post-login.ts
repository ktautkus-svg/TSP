export type PostLoginRoute = {
  id: string;
  status: string;
  date: string;
};

export type DriverPostLoginDecision<T extends PostLoginRoute> =
  | { kind: 'wait' }
  | { kind: 'unavailable' }
  | { kind: 'empty' }
  | { kind: 'choose'; routes: T[] }
  | { kind: 'continue'; route: T };

const STARTED = new Set(['in_progress', 'loading', 'loaded']);

/**
 * Empty "no routes" is only valid after a successful sync that returned none.
 * A started route opens execution; several waiting routes open a picker.
 */
export function resolveDriverPostLogin<T extends PostLoginRoute>(input: {
  syncState: 'pending' | 'ready' | 'failed';
  routes: readonly T[];
}): DriverPostLoginDecision<T> {
  if (input.syncState === 'pending') return { kind: 'wait' };
  if (input.syncState === 'failed') return { kind: 'unavailable' };
  const open = input.routes.filter((route) => route.status !== 'completed' && route.status !== 'cancelled');
  if (open.length === 0) return { kind: 'empty' };
  const started = open.find((route) => STARTED.has(route.status));
  if (started) return { kind: 'continue', route: started };
  if (open.length > 1) return { kind: 'choose', routes: open };
  return { kind: 'continue', route: open[0]! };
}
