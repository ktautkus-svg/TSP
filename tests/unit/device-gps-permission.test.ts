import { describe, expect, it, vi } from 'vitest';

import { deviceGpsPermissionDenied, resetDeviceGpsPermissionPrompt } from '../../src/application/location/device-gps';

describe('device GPS permission', () => {
  it('does not ask again after the permission was denied', async () => {
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
    await gps.readRecentDeviceGpsFix();
    expect(gps.deviceGpsPermissionDenied()).toBe(true);
    await gps.readRecentDeviceGpsFix();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports the denied latch from the module under test', () => {
    resetDeviceGpsPermissionPrompt();
    expect(deviceGpsPermissionDenied()).toBe(false);
  });
});
