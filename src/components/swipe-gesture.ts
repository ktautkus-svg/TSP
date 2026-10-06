/**
 * Swipe commit decisions shared by the card and regression tests.
 *
 * iPhone Safari often ends a horizontal card drag with pointercancel /
 * touchcancel (body touch-action: pan-y, scroll parent takeover) instead of
 * pointerup. Treating cancel as "spring back" drops a gesture that already
 * crossed the commit threshold. Distance is tracked by the card itself —
 * responder release payloads on web frequently report dx = 0.
 */

export const SWIPE_MIN_THRESHOLD = 88;
export const SWIPE_MAX_THRESHOLD = 132;
export const SWIPE_LOCK_SLOP = 8;
export const SWIPE_AXIS_RATIO = 1.2;

export type SwipeDirection = -1 | 1;
export type SwipeEndReason = 'up' | 'cancel' | 'terminate';

export function swipeThreshold(width: number): number {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320;
  return Math.min(SWIPE_MAX_THRESHOLD, Math.max(SWIPE_MIN_THRESHOLD, safeWidth * 0.3));
}

export function swipeAxisLock(dx: number, dy: number): 'horizontal' | 'vertical' | 'pending' {
  if (Math.abs(dx) < SWIPE_LOCK_SLOP && Math.abs(dy) < SWIPE_LOCK_SLOP) return 'pending';
  if (Math.abs(dx) > SWIPE_LOCK_SLOP && Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO) return 'horizontal';
  if (Math.abs(dy) > SWIPE_LOCK_SLOP && Math.abs(dy) > Math.abs(dx)) return 'vertical';
  return 'pending';
}

export function resistedOffset(dx: number, width: number): number {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320;
  const resistance = Math.abs(dx) > safeWidth * 0.75 ? 0.72 : 1;
  return dx * resistance;
}

/**
 * Commit when the tracked finger distance crossed the threshold, including
 * when the browser cancels the pointer. Below threshold always cancels.
 */
export function resolveSwipeEnd(input: {
  trackedDx: number;
  width: number;
  canSwipeRight: boolean;
  canSwipeLeft: boolean;
  reason: SwipeEndReason;
}): { type: 'commit'; direction: SwipeDirection } | { type: 'cancel' } {
  const limit = swipeThreshold(input.width);
  if (input.trackedDx >= limit && input.canSwipeRight) return { type: 'commit', direction: 1 };
  if (input.trackedDx <= -limit && input.canSwipeLeft) return { type: 'commit', direction: -1 };
  void input.reason;
  return { type: 'cancel' };
}
