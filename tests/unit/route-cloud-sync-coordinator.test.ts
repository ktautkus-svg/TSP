import { describe, expect, it, vi } from 'vitest';

import { RouteCloudSyncCoordinator } from '../../src/application/sync/route-cloud-sync-coordinator';
import {
  registerRouteCloudSyncLifecycle,
  type RouteCloudSyncLifecycleEnvironment,
} from '../../src/application/sync/route-cloud-sync-lifecycle';

describe('route cloud sync coordinator', () => {
  it('coalesces repeated triggers into one in-flight sync pass', async () => {
    let finishSync: () => void = () => undefined;
    const sync = vi.fn(() => new Promise<void>((resolve) => { finishSync = resolve; }));
    const coordinator = new RouteCloudSyncCoordinator({ sync });

    const first = coordinator.trigger('mutation');
    const second = coordinator.trigger('foreground');
    const third = coordinator.trigger('window-focus');
    await Promise.resolve();

    expect(sync).toHaveBeenCalledTimes(1);
    finishSync();
    await Promise.all([first, second, third]);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(coordinator.getState().status).toBe('synced');
  });

  it('keeps failures inside sync state instead of rejecting the driver workflow', async () => {
    const coordinator = new RouteCloudSyncCoordinator({
      sync: async () => { throw new Error('Server unavailable'); },
    });

    await expect(coordinator.trigger('mutation')).resolves.toBeUndefined();
    expect(coordinator.getState()).toMatchObject({ status: 'error', error: 'Server unavailable' });
  });

  it('stays offline without a request and retries when connectivity returns', async () => {
    const sync = vi.fn(async () => undefined);
    const coordinator = new RouteCloudSyncCoordinator({ sync, initialOnline: false });

    await coordinator.trigger('mutation');
    expect(sync).not.toHaveBeenCalled();
    expect(coordinator.getState().status).toBe('offline');

    coordinator.setOnline(true);
    await coordinator.trigger('network-restored');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(coordinator.getState().status).toBe('synced');
  });
});

describe('route cloud sync lifecycle triggers', () => {
  it('triggers on app foreground, visible focus, and network restoration', () => {
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeEventTarget() as FakeEventTarget & { visibilityState: string };
    documentTarget.visibilityState = 'hidden';
    let appStateListener: (state: 'active' | 'background') => void = () => undefined;
    const environment: RouteCloudSyncLifecycleEnvironment = {
      currentAppState: 'active',
      subscribeAppState: (listener) => {
        appStateListener = listener as (state: 'active' | 'background') => void;
        return () => { appStateListener = () => undefined; };
      },
      windowTarget,
      documentTarget,
    };
    const foreground = vi.fn();
    const focus = vi.fn();
    const online = vi.fn();
    const offline = vi.fn();

    const cleanup = registerRouteCloudSyncLifecycle({
      onForeground: foreground,
      onWindowFocus: focus,
      onOnline: online,
      onOffline: offline,
    }, environment);

    appStateListener('background');
    appStateListener('active');
    windowTarget.emit('focus');
    documentTarget.visibilityState = 'visible';
    documentTarget.emit('visibilitychange');
    windowTarget.emit('offline');
    windowTarget.emit('online');

    expect(foreground).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(offline).toHaveBeenCalledTimes(1);
    expect(online).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}
