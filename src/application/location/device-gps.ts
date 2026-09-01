import type { GpsSample } from '@/domain/location-park-memory';
import { PARK_PIN_MAX_AGE_MS } from '@/domain/location-park-memory';
import { devWarn } from '@/ui/dev-log';

type LocationCoords = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
};

type LocationObject = {
  timestamp: number;
  coords: LocationCoords;
};

type LocationPermission = { status: string };

type LocationModule = {
  Accuracy: { Balanced: number; High: number };
  getForegroundPermissionsAsync: () => Promise<LocationPermission>;
  requestForegroundPermissionsAsync: () => Promise<LocationPermission>;
  getLastKnownPositionAsync: () => Promise<LocationObject | null>;
  getCurrentPositionAsync: (options: { accuracy: number }) => Promise<LocationObject>;
  watchPositionAsync: (
    options: { accuracy: number; distanceInterval: number; timeInterval: number },
    callback: (location: LocationObject) => void,
  ) => Promise<{ remove: () => void }>;
};

async function loadLocationModule(): Promise<LocationModule | null> {
  try {
    const loaded = await import('expo-location');
    return loaded as unknown as LocationModule;
  } catch (reason) {
    devWarn('DEVICE_GPS_MODULE_UNAVAILABLE', reason);
    return null;
  }
}

export function toGpsSample(location: LocationObject): GpsSample | null {
  const { latitude, longitude } = location.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracyM: Number.isFinite(location.coords.accuracy) ? location.coords.accuracy ?? null : null,
    heading: Number.isFinite(location.coords.heading) && (location.coords.heading ?? -1) >= 0
      ? location.coords.heading ?? null
      : null,
    capturedAtMs: location.timestamp,
  };
}

export function isRecentGpsSample(sample: GpsSample | null | undefined, nowMs = Date.now()): sample is GpsSample {
  return Boolean(sample && nowMs - sample.capturedAtMs <= PARK_PIN_MAX_AGE_MS);
}

/**
 * Best-effort phone GPS. Never reverse-geocodes. Returns null when permission
 * is missing, the fix is old, or the platform cannot provide coordinates.
 */
export async function readRecentDeviceGpsFix(nowMs = Date.now()): Promise<GpsSample | null> {
  const Location = await loadLocationModule();
  if (!Location) return null;
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Location.requestForegroundPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;
    const last = await Location.getLastKnownPositionAsync();
    const lastSample = last ? toGpsSample(last) : null;
    if (isRecentGpsSample(lastSample, nowMs)) return lastSample;
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const sample = toGpsSample(current);
    return isRecentGpsSample(sample, nowMs) ? sample : null;
  } catch (reason) {
    devWarn('DEVICE_GPS_READ_FAILED', reason);
    return null;
  }
}

export async function watchDeviceGps(
  onFix: (sample: GpsSample) => void,
): Promise<() => void> {
  const Location = await loadLocationModule();
  if (!Location) return () => {};
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.status !== 'granted') return () => {};
    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 8, timeInterval: 8_000 },
      (location) => {
        const sample = toGpsSample(location);
        if (sample) onFix(sample);
      },
    );
    return () => {
      try { subscription.remove(); } catch { /* already gone */ }
    };
  } catch (reason) {
    devWarn('DEVICE_GPS_WATCH_FAILED', reason);
    return () => {};
  }
}
