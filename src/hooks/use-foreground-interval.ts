import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

/**
 * `setInterval` that only runs while the app is actually in front of the driver.
 *
 * Background polling costs battery, mobile data and SQLite writes for data
 * nobody is looking at, so the timer is stopped whenever the app is backgrounded
 * (or the PWA tab is hidden) and restarted on resume — with one immediate run so
 * the screen is never stale after coming back.
 *
 * The callback is held in a ref, so a caller that recreates it every render does
 * not tear down and restart the timer.
 */
export function useForegroundInterval(callback: () => void, intervalMs: number): void {
  const latest = useRef(callback);

  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const isVisible = () => {
      if (AppState.currentState !== 'active') return false;
      if (Platform.OS === 'web' && typeof document !== 'undefined') return !document.hidden;
      return true;
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const sync = (runNow: boolean) => {
      if (!isVisible()) {
        stop();
        return;
      }
      if (runNow) latest.current();
      if (timer === null) timer = setInterval(() => latest.current(), intervalMs);
    };

    sync(false);

    const appStateSubscription = AppState.addEventListener('change', () => sync(true));
    const onVisibilityChange = () => sync(true);
    const documentTarget =
      Platform.OS === 'web' && typeof document !== 'undefined' ? document : null;
    documentTarget?.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      appStateSubscription.remove();
      documentTarget?.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
