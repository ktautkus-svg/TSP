import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveRouteDestination } from '@/application/routes/route-navigation';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, '../../', path), 'utf8');

/**
 * Cancelling a route flips it to 'cancelled', which resolveRoute maps to
 * /history. Every screen that cancels a route therefore has to suppress its own
 * status guard while navigating away, otherwise the guard races the intended
 * navigation and intermittently lands the driver in history instead.
 */
describe('self-cancel redirect guard', () => {
  it('still routes a genuinely cancelled route to history', () => {
    expect(resolveRouteDestination('cancelled', { routeId: 'r1' }).pathname).toBe('/history');
  });

  for (const screen of [
    'src/app/route/[id]/alternatives.tsx',
    'src/app/route/[id]/loading.tsx',
    'src/app/route/[id]/delivery.tsx',
  ]) {
    it(`guards ${screen} against redirecting after its own cancel`, () => {
      const code = source(screen);
      expect(code).toContain('CancelDraftRoute');
      expect(code).toContain('selfCancelled.current = true');
      // The flag must be cleared again when the cancel fails, so a failed
      // cancel does not permanently freeze the screen's status guard.
      expect(code).toContain('selfCancelled.current = false');
      expect(code).toContain('selfCancelled.current)');
    });
  }
});
