/** Feature-detected vibration. iOS Safari/PWA does not implement this; never throw. */
export function pulseHaptic(kind: 'press' | 'commit' = 'press'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(kind === 'commit' ? [10] : [6]);
  } catch {
    // Unsupported or blocked. Visual feedback is the source of truth.
  }
}
