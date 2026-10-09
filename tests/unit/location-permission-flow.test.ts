import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearLocationPermissionLock,
  dismissFiroLocationExplanation,
  readLocationPermissionStatus,
  requestSystemLocationPermission,
  resetLocationPermissionFlow,
  shouldShowFiroLocationExplanation,
  shouldShowLocationSettingsInstruction,
} from '../../src/application/location/location-permission';

describe('location permission flow', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    resetLocationPermissionFlow();
    vi.doUnmock('expo-location');
    vi.resetModules();
  });

  it('does not show the FIRO explanation when the browser permission is already granted or denied', () => {
    expect(shouldShowFiroLocationExplanation('granted')).toBe(false);
    expect(shouldShowFiroLocationExplanation('denied')).toBe(false);
    expect(shouldShowFiroLocationExplanation('prompt')).toBe(true);
    dismissFiroLocationExplanation();
    expect(shouldShowFiroLocationExplanation('prompt')).toBe(false);
    expect(shouldShowLocationSettingsInstruction('denied')).toBe(false);
  });

  it('asks the system only after a user action and clears the lock after success, error, and cancel', async () => {
    resetLocationPermissionFlow();
    const request = vi.fn(async () => ({ status: 'granted' }));
    vi.resetModules();
    vi.doMock('expo-location', () => ({
      Accuracy: { Balanced: 3, High: 4 },
      getForegroundPermissionsAsync: async () => ({ status: 'undetermined' }),
      requestForegroundPermissionsAsync: request,
    }));
    const flow = await import('../../src/application/location/location-permission');
    flow.resetLocationPermissionFlow();
    expect(await flow.readLocationPermissionStatus()).toBe('prompt');
    expect(request).not.toHaveBeenCalled();
    await flow.requestSystemLocationPermission();
    expect(request).toHaveBeenCalledTimes(1);
    flow.clearLocationPermissionLock();
    expect(flow.shouldShowFiroLocationExplanation('granted')).toBe(false);

    request.mockRejectedValueOnce(new Error('closed'));
    flow.resetLocationPermissionFlow();
    await expect(flow.requestSystemLocationPermission()).resolves.toBe('unavailable');
    flow.clearLocationPermissionLock();
    const second = flow.requestSystemLocationPermission();
    flow.clearLocationPermissionLock();
    await second;
    expect(request.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not repeat the system dialog after a denial', async () => {
    const request = vi.fn(async () => ({ status: 'denied' }));
    vi.resetModules();
    vi.doMock('expo-location', () => ({
      Accuracy: { Balanced: 3, High: 4 },
      getForegroundPermissionsAsync: async () => ({ status: 'undetermined' }),
      requestForegroundPermissionsAsync: request,
    }));
    const flow = await import('../../src/application/location/location-permission');
    flow.resetLocationPermissionFlow();
    await flow.requestSystemLocationPermission();
    vi.doMock('expo-location', () => ({
      Accuracy: { Balanced: 3, High: 4 },
      getForegroundPermissionsAsync: async () => ({ status: 'denied' }),
      requestForegroundPermissionsAsync: request,
    }));
    const denied = await import('../../src/application/location/location-permission');
    await denied.requestSystemLocationPermission();
    expect(request).toHaveBeenCalledTimes(1);
    expect(denied.shouldShowFiroLocationExplanation('denied')).toBe(false);
    expect(denied.LOCATION_SETTINGS_INSTRUCTION).toContain('svetainės nustatymus');
  });
});

describe('device GPS read does not raise the system dialog', () => {
  it('returns null until the driver allows location', async () => {
    const request = vi.fn(async () => ({ status: 'granted' }));
    vi.resetModules();
    vi.doMock('expo-location', () => ({
      Accuracy: { Balanced: 3, High: 4 },
      getForegroundPermissionsAsync: async () => ({ status: 'undetermined' }),
      requestForegroundPermissionsAsync: request,
      getLastKnownPositionAsync: async () => null,
      getCurrentPositionAsync: async () => { throw new Error('should not read'); },
    }));
    const gps = await import('../../src/application/location/device-gps');
    gps.resetDeviceGpsPermissionPrompt();
    await expect(gps.readRecentDeviceGpsFix()).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(clearLocationPermissionLock).toBeTypeOf('function');
    expect(readLocationPermissionStatus).toBeTypeOf('function');
    expect(requestSystemLocationPermission).toBeTypeOf('function');
  });
});
