import { describe, expect, it } from 'vitest';

import {
  resolveSwipeEnd,
  resistedOffset,
  swipeAxisLock,
  swipeThreshold,
} from '../../src/components/swipe-gesture';

describe('swipe commit on release and cancel', () => {
  it('keeps a clear threshold on 320px and 390px phones', () => {
    expect(swipeThreshold(320)).toBeGreaterThanOrEqual(88);
    expect(swipeThreshold(320)).toBeLessThanOrEqual(132);
    expect(swipeThreshold(390)).toBeGreaterThanOrEqual(88);
    expect(swipeThreshold(390)).toBeLessThanOrEqual(132);
    expect(swipeThreshold(1200)).toBe(132);
  });

  it('does not commit a release below the threshold', () => {
    const width = 390;
    const below = swipeThreshold(width) - 1;
    expect(resolveSwipeEnd({
      trackedDx: below,
      width,
      canSwipeRight: true,
      canSwipeLeft: true,
      reason: 'up',
    })).toEqual({ type: 'cancel' });
    expect(resolveSwipeEnd({
      trackedDx: -below,
      width,
      canSwipeRight: true,
      canSwipeLeft: true,
      reason: 'cancel',
    })).toEqual({ type: 'cancel' });
  });

  it('commits a right swipe past the threshold on pointerup', () => {
    const width = 390;
    const decision = resolveSwipeEnd({
      trackedDx: swipeThreshold(width) + 12,
      width,
      canSwipeRight: true,
      canSwipeLeft: true,
      reason: 'up',
    });
    expect(decision).toEqual({ type: 'commit', direction: 1 });
  });

  it('commits when iOS cancels the pointer after the threshold instead of springing back', () => {
    const width = 320;
    const decision = resolveSwipeEnd({
      trackedDx: swipeThreshold(width) + 4,
      width,
      canSwipeRight: true,
      canSwipeLeft: false,
      reason: 'cancel',
    });
    expect(decision).toEqual({ type: 'commit', direction: 1 });
    expect(resolveSwipeEnd({
      trackedDx: -(swipeThreshold(width) + 4),
      width,
      canSwipeRight: false,
      canSwipeLeft: true,
      reason: 'terminate',
    })).toEqual({ type: 'commit', direction: -1 });
  });

  it('does not commit a cancelled gesture that never crossed the threshold', () => {
    expect(resolveSwipeEnd({
      trackedDx: 40,
      width: 390,
      canSwipeRight: true,
      canSwipeLeft: true,
      reason: 'terminate',
    })).toEqual({ type: 'cancel' });
  });

  it('lets vertical movement scroll and locks horizontal drags', () => {
    expect(swipeAxisLock(4, 2)).toBe('pending');
    expect(swipeAxisLock(2, 30)).toBe('vertical');
    expect(swipeAxisLock(24, 6)).toBe('horizontal');
  });

  it('follows the finger with resistance only after a long drag', () => {
    expect(resistedOffset(50, 390)).toBe(50);
    expect(resistedOffset(300, 390)).toBeCloseTo(216);
  });
});
