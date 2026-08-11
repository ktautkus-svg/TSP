import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  RouteCloudSyncCoordinator,
  attentionFrom,
  describeAttention,
} from '../../src/application/sync/route-cloud-sync-coordinator';
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

describe('cloud sync status reflects unresolved work', () => {
  // A pass that finishes is not automatically a pass that resolved everything.
  // These are the exact outcomes the engine can return.
  const cleanPass = { pushed: 2, conflicts: 0, pulled: 1, deferred: 0, deleted: 0, rejected: 0, foreign: 0 };

  async function passWith(outcome: Record<string, number>) {
    const coordinator = new RouteCloudSyncCoordinator({ sync: async () => outcome });
    await coordinator.trigger('mutation');
    return coordinator.getState();
  }

  it('reports a clean pass as fully synced', async () => {
    const state = await passWith(cleanPass);
    expect(state.status).toBe('synced');
    expect(state.attention).toBeNull();
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it('reports routes belonging to another account as needing attention', async () => {
    const state = await passWith({ ...cleanPass, foreign: 3 });
    expect(state.status).toBe('attention');
    expect(state.attention).toMatchObject({ foreign: 3 });
  });

  it('reports records that could not be synchronised as needing attention', async () => {
    const state = await passWith({ ...cleanPass, rejected: 1 });
    expect(state.status).toBe('attention');
    expect(state.attention).toMatchObject({ rejected: 1 });
  });

  it('reports postponed data as needing attention', async () => {
    const state = await passWith({ ...cleanPass, deferred: 1 });
    expect(state.status).toBe('attention');
    expect(state.attention).toMatchObject({ deferred: 1 });
  });

  it('treats a successful deletion as finished work, not as attention', async () => {
    const state = await passWith({ ...cleanPass, deleted: 2 });
    expect(state.status).toBe('synced');
    expect(state.attention).toBeNull();
  });

  it('keeps a hard failure red rather than amber', async () => {
    const coordinator = new RouteCloudSyncCoordinator({
      sync: async () => { throw new Error('Serveris nepasiekiamas'); },
    });
    await coordinator.trigger('mutation');
    expect(coordinator.getState().status).toBe('error');
  });

  it('keeps a connectivity failure offline rather than amber', async () => {
    const coordinator = new RouteCloudSyncCoordinator({
      sync: async () => { throw new TypeError('Network request failed'); },
    });
    await coordinator.trigger('mutation');
    expect(coordinator.getState().status).toBe('offline');
  });

  it('clears a previous attention state once a later pass comes back clean', async () => {
    let outcome: Record<string, number> = { ...cleanPass, deferred: 1 };
    const coordinator = new RouteCloudSyncCoordinator({ sync: async () => outcome });
    await coordinator.trigger('mutation');
    expect(coordinator.getState().status).toBe('attention');

    outcome = cleanPass;
    await coordinator.trigger('foreground');
    expect(coordinator.getState()).toMatchObject({ status: 'synced', attention: null });
  });

  it('ignores an outcome that carries no counts at all', () => {
    expect(attentionFrom(undefined)).toBeNull();
    expect(attentionFrom({})).toBeNull();
    expect(attentionFrom({ foreign: 0, rejected: 0, deferred: 0 })).toBeNull();
  });

  it('explains each reason in plain language, without counts or internal wording', () => {
    const detail = describeAttention({ foreign: 2, rejected: 1, deferred: 1 });
    expect(detail).toContain('sukurtų su kita paskyra');
    expect(detail).toContain('išsiųsti nepavyko');
    expect(detail).toContain('bus pritaikyta vėliau');
    expect(detail).not.toMatch(/foreign|rejected|deferred|tombstone|cursor/i);
  });
});

describe('cloud sync status badge', () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/cloud-sync-status.tsx'),
    'utf8',
  );

  it('shows a distinct Lithuanian label instead of a green synced badge', () => {
    expect(source).toContain("attention: 'Reikia dėmesio'");
    expect(source).not.toMatch(/attention:\s*'Sinchronizuota'/);
  });

  it('styles attention as amber, keeping red for real failures', () => {
    expect(source).toContain('attentionDot: { backgroundColor: colors.warning }');
    expect(source).toContain('errorDot: { backgroundColor: colors.danger }');
  });

  it('offers the explanation on press rather than a pointless retry', () => {
    expect(source).toContain('describeAttention(attention)');
    expect(source).toContain('Alert.alert(labels.attention, detail)');
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
