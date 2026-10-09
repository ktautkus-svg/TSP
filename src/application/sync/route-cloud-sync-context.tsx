import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { syncLearnedCoordinates } from '@/application/location/learned-coordinate-sync';
import { syncRoutesWithCloud } from '@/application/sync/route-cloud-sync';
import {
  RouteCloudSyncCoordinator,
  type RouteCloudSyncState,
  type RouteCloudSyncTrigger,
} from '@/application/sync/route-cloud-sync-coordinator';
import { registerRouteCloudSyncLifecycle } from '@/application/sync/route-cloud-sync-lifecycle';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { useForegroundInterval } from '@/hooks/use-foreground-interval';

const LIVE_SYNC_INTERVAL_MS = 10_000;

type RouteCloudSyncContextValue = RouteCloudSyncState & {
  requestSync: (reason: RouteCloudSyncTrigger) => Promise<void>;
};

const initialState: RouteCloudSyncState = {
  status: browserIsOffline() ? 'offline' : 'syncing',
  lastSyncedAt: null,
  error: null,
  attention: null,
  revision: 0,
};

const RouteCloudSyncContext = createContext<RouteCloudSyncContextValue | null>(null);

export function RouteCloudSyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { profile, demo } = useLocalAccess();
  const [state, setState] = useState<RouteCloudSyncState>(initialState);
  const coordinator = useMemo(() => new RouteCloudSyncCoordinator({
    sync: async () => {
      const result = await syncRoutesWithCloud(db);
      await syncLearnedCoordinates(db).catch(() => undefined);
      return result;
    },
    initialOnline: !browserIsOffline(),
    onStateChange: setState,
  }), [db]);

  const requestSync = useCallback((reason: RouteCloudSyncTrigger) => {
    if (reason === 'manual-retry' && !browserIsOffline()) coordinator.setOnline(true);
    return coordinator.trigger(reason);
  }, [coordinator]);

  // A second device can stay open on the dashboard for an entire workday.
  // Focus/startup events alone leave that screen stale after another device
  // delivers a stop, so poll only while the app is actually visible.
  useForegroundInterval(useCallback(() => {
    if (profile.role !== 'quality' && !demo) void requestSync('periodic');
  }, [demo, profile.role, requestSync]), LIVE_SYNC_INTERVAL_MS);

  useEffect(() => {
    // Quality control reads its own server projection and must never run the
    // driver's two-way SQLite sync. Apart from wasting requests, that sync is
    // intentionally forbidden for this read-only role and used to surface a
    // misleading red "Klaida" badge in the header.
    if (profile.role === 'quality' || demo) {
      setState({ status: 'synced', lastSyncedAt: new Date().toISOString(), error: null, attention: null, revision: 0 });
      return () => coordinator.stop();
    }
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
  }, [coordinator, demo, profile.role, requestSync]);

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
