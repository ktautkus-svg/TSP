import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { syncRoutesWithCloud } from '@/application/sync/route-cloud-sync';
import {
  RouteCloudSyncCoordinator,
  type RouteCloudSyncState,
  type RouteCloudSyncTrigger,
} from '@/application/sync/route-cloud-sync-coordinator';
import { registerRouteCloudSyncLifecycle } from '@/application/sync/route-cloud-sync-lifecycle';

type RouteCloudSyncContextValue = RouteCloudSyncState & {
  requestSync: (reason: RouteCloudSyncTrigger) => Promise<void>;
};

const initialState: RouteCloudSyncState = {
  status: browserIsOffline() ? 'offline' : 'syncing',
  lastSyncedAt: null,
  error: null,
  revision: 0,
};

const RouteCloudSyncContext = createContext<RouteCloudSyncContextValue | null>(null);

export function RouteCloudSyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [state, setState] = useState<RouteCloudSyncState>(initialState);
  const coordinator = useMemo(() => new RouteCloudSyncCoordinator({
    sync: () => syncRoutesWithCloud(db),
    initialOnline: !browserIsOffline(),
    onStateChange: setState,
  }), [db]);

  const requestSync = useCallback((reason: RouteCloudSyncTrigger) => {
    if (reason === 'manual-retry' && !browserIsOffline()) coordinator.setOnline(true);
    return coordinator.trigger(reason);
  }, [coordinator]);

  useEffect(() => {
    const cleanup = registerRouteCloudSyncLifecycle({
      onForeground: () => { void requestSync('foreground'); },
      onWindowFocus: () => { void requestSync('window-focus'); },
      onOnline: () => {
        coordinator.setOnline(true);
        void requestSync('network-restored');
      },
      onOffline: () => coordinator.setOnline(false),
    }, {
      currentAppState: AppState.currentState,
      subscribeAppState: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
      windowTarget: Platform.OS === 'web' && typeof window !== 'undefined' ? window : undefined,
      documentTarget: Platform.OS === 'web' && typeof document !== 'undefined' ? document : undefined,
    });
    void requestSync('startup');
    return () => {
      cleanup();
      coordinator.stop();
    };
  }, [coordinator, requestSync]);

  const value = useMemo<RouteCloudSyncContextValue>(
    () => ({ ...state, requestSync }),
    [requestSync, state],
  );

  return <RouteCloudSyncContext.Provider value={value}>{children}</RouteCloudSyncContext.Provider>;
}

export function useRouteCloudSync(): RouteCloudSyncContextValue {
  const value = useContext(RouteCloudSyncContext);
  if (!value) throw new Error('Cloud Sync būsena nepasiekiama.');
  return value;
}

function browserIsOffline(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false;
}
