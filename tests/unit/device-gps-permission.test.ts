import { describe, expect, it, vi } from 'vitest';

import { deviceGpsPermissionDenied, resetDeviceGpsPermissionPrompt } from '../../src/application/location/device-gps';

describe('device GPS permission', () => {
  it('does not ask the system dialog from a GPS read, even when permission is undecided', async () => {
    resetDeviceGpsPermissionPrompt();
    const request = vi.fn(async () => ({ status: 'denied' }));
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
    expect(gps.deviceGpsPermissionDenied()).toBe(false);
  });

  it('asks once from the explicit permission action and then remembers a denial', async () => {
    const request = vi.fn(async () => ({ status: 'denied' }));
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
    await expect(gps.requestDeviceLocationPermission()).resolves.toBe('denied');
    await expect(gps.requestDeviceLocationPermission()).resolves.toBe('denied');
    expect(request).toHaveBeenCalledTimes(1);
    expect(gps.deviceGpsPermissionDenied()).toBe(true);
  });

  it('reports the denied latch from the module under test', () => {
    resetDeviceGpsPermissionPrompt();
    expect(deviceGpsPermissionDenied()).toBe(false);
  });
});
