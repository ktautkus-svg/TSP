import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  planningScreenAllowsStatus,
  resolveRoute,
  resolveRouteDestination,
} from '../../src/application/routes/route-navigation';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('central route navigation recovery', () => {
  it.each([
    ['draft', 'review', '/route/[id]/review'],
    ['loading', 'loading', '/route/[id]/loading'],
    ['loaded', 'loading', '/route/[id]/loading'],
    ['in_progress', 'delivery', '/route/[id]/delivery'],
    ['completed', 'history-detail', '/history/[id]'],
    ['cancelled', 'history', '/history'],
  ] as const)('routes %s to its valid destination', (status, screen, pathname) => {
    expect(resolveRouteDestination(status, { routeId: 'route-1' })).toMatchObject({
      screen,
      pathname,
    });
  });

  it('routes a planned route according to whether a candidate is already selected', () => {
    expect(resolveRouteDestination('planned', {
      routeId: 'route-1',
      hasSelectedCandidate: false,
    }).screen).toBe('alternatives');
    expect(resolveRouteDestination('planned', {
      routeId: 'route-1',
      hasSelectedCandidate: true,
    }).screen).toBe('loading');
  });

  it('restores an interrupted completion into the same delivery route', () => {
    expect(resolveRouteDestination('in_progress', {
      routeId: 'route-1',
      completionStartedAt: '2026-08-03T14:00:00.000Z',
    })).toEqual({
      screen: 'delivery',
      pathname: '/route/[id]/delivery',
      params: { id: 'route-1', resumeCompletion: '1' },
      resumeCompletion: true,
    });
  });

  it('never permits review or alternatives to edit a non-draft route', () => {
    expect(planningScreenAllowsStatus('review', 'draft')).toBe(true);
    expect(planningScreenAllowsStatus('alternatives', 'draft')).toBe(true);
    for (const status of ['planned', 'loading', 'loaded', 'in_progress', 'completed', 'cancelled'] as const) {
      expect(planningScreenAllowsStatus('review', status)).toBe(false);
      expect(planningScreenAllowsStatus('alternatives', status)).toBe(false);
    }
  });

  it('returns to Dashboard when a stale screen no longer has a route', () => {
    expect(resolveRoute(null)).toMatchObject({ screen: 'dashboard', pathname: '/' });
  });
});

describe('route screen regression guards', () => {
  it('intercepts Back on delivery and does not pop into planning history', () => {
    const source = readFileSync(resolve(projectRoot, 'src/app/route/[id]/delivery.tsx'), 'utf8');
    expect(source).toContain('gestureEnabled: false');
    expect(source).toContain('headerBackVisible: false');
    expect(source).toContain('if (showFinish) return leaveFinish()');
    expect(source).toContain("router.replace('/' as Href)");
    expect(source).toContain('BackHandler.addEventListener');
  });

  it('persists the completion draft and exposes a resume CTA', () => {
    const source = readFileSync(resolve(projectRoot, 'src/app/route/[id]/delivery.tsx'), 'utf8');
    expect(source).toContain('SaveCompletionOdometerDraft');
    expect(source).toContain('BeginRouteCompletion');
    expect(source).toContain('Tęsti užbaigimą');
    expect(source).toContain('completionEndOdometerDraft');
  });

  it('guards stale planning screens and does not launch unhandled field promises', () => {
    const review = readFileSync(resolve(projectRoot, 'src/app/route/[id]/review.tsx'), 'utf8');
    const alternatives = readFileSync(resolve(projectRoot, 'src/app/route/[id]/alternatives.tsx'), 'utf8');
    expect(review).toContain('redirectStalePlanningScreen');
    expect(review).toContain('useFocusEffect');
    expect(review).toContain("persisted.route.status !== 'draft'");
    expect(review).not.toMatch(/on(?:EndEditing|Blur)=\{\(\) => props\.onEdit/);
    expect(review).toMatch(/onBlur=\{\(\) => \{ void props\.onEdit/g);
    expect(alternatives).toContain('recoveryDestination');
    expect(alternatives).toContain('ALTERNATIVES_FOCUS_GUARD_FAILED');
    expect(alternatives).toContain('resolveRoute(current)');
  });
});
