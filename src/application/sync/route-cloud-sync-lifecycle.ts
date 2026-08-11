import type { AppStateStatus } from 'react-native';

type EventTargetLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type RouteCloudSyncLifecycleEnvironment = {
  currentAppState: AppStateStatus;
  subscribeAppState: (listener: (state: AppStateStatus) => void) => () => void;
  windowTarget?: EventTargetLike;
  documentTarget?: EventTargetLike & { visibilityState?: string };
};

type LifecycleCallbacks = {
  onForeground: () => void;
  onWindowFocus: () => void;
  onOnline: () => void;
  onOffline: () => void;
};

/** Registers lifecycle/network events only. There is deliberately no timer. */
export function registerRouteCloudSyncLifecycle(
  callbacks: LifecycleCallbacks,
  environment: RouteCloudSyncLifecycleEnvironment,
): () => void {
  let previousState = environment.currentAppState;
  const unsubscribeAppState = environment.subscribeAppState((nextState) => {
    if (nextState === 'active' && previousState !== 'active') callbacks.onForeground();
    previousState = nextState;
  });

  const focusListener = () => callbacks.onWindowFocus();
  const onlineListener = () => callbacks.onOnline();
  const offlineListener = () => callbacks.onOffline();
  const visibilityListener = () => {
    if (environment.documentTarget?.visibilityState === 'visible') callbacks.onForeground();
  };

  environment.windowTarget?.addEventListener('focus', focusListener);
  environment.windowTarget?.addEventListener('online', onlineListener);
  environment.windowTarget?.addEventListener('offline', offlineListener);
  environment.documentTarget?.addEventListener('visibilitychange', visibilityListener);

  return () => {
    unsubscribeAppState();
    environment.windowTarget?.removeEventListener('focus', focusListener);
    environment.windowTarget?.removeEventListener('online', onlineListener);
    environment.windowTarget?.removeEventListener('offline', offlineListener);
    environment.documentTarget?.removeEventListener('visibilitychange', visibilityListener);
  };
}
