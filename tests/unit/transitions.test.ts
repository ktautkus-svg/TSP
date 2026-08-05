import { describe, expect, it } from 'vitest';

import {
  assertDeliveryTransition,
  assertRouteTransition,
  canTransitionDelivery,
  canTransitionLoading,
  canTransitionRoute,
} from '../../src/domain/transitions';

describe('route transitions', () => {
  it('allows the normal route lifecycle', () => {
    expect(canTransitionRoute('draft', 'planned')).toBe(true);
    expect(canTransitionRoute('planned', 'loading')).toBe(true);
    expect(canTransitionRoute('loading', 'loaded')).toBe(true);
    expect(canTransitionRoute('loaded', 'in_progress')).toBe(true);
    expect(canTransitionRoute('in_progress', 'completed')).toBe(true);
  });

  it('blocks skipping lifecycle states', () => {
    expect(canTransitionRoute('draft', 'in_progress')).toBe(false);
    expect(() => assertRouteTransition('completed', 'in_progress')).toThrow();
  });

  it('does not silently skip or reverse required workday states', () => {
    expect(canTransitionRoute('loading', 'planned')).toBe(false);
    expect(canTransitionRoute('loaded', 'loading')).toBe(false);
    expect(canTransitionRoute('draft', 'cancelled')).toBe(true);
    expect(canTransitionRoute('loading', 'cancelled')).toBe(true);
  });
});

describe('stop transitions', () => {
  it('supports loading undo', () => {
    expect(canTransitionLoading('pending', 'loaded')).toBe(true);
    expect(canTransitionLoading('loaded', 'pending')).toBe(true);
  });

  it('keeps failed stops retryable', () => {
    expect(canTransitionDelivery('pending', 'failed')).toBe(true);
    expect(canTransitionDelivery('failed', 'delivered')).toBe(true);
    expect(canTransitionDelivery('failed', 'failed')).toBe(true);
  });

  it('does not allow nonsensical delivery transitions', () => {
    expect(() => assertDeliveryTransition('pending', 'pending')).toThrow();
    expect(canTransitionDelivery('delivered', 'failed')).toBe(false);
  });
});
