import { devWarn } from '@/ui/dev-log';

type LocationPermission = { status: string };

type LocationModule = {
  Accuracy: { Balanced: number; High: number };
  getForegroundPermissionsAsync: () => Promise<LocationPermission>;
  requestForegroundPermissionsAsync: () => Promise<LocationPermission>;
  getLastKnownPositionAsync: () => Promise<{ timestamp: number; coords: { latitude: number; longitude: number; accuracy?: number | null; heading?: number | null } } | null>;
  getCurrentPositionAsync: (options: { accuracy: number }) => Promise<{ timestamp: number; coords: { latitude: number; longitude: number; accuracy?: number | null; heading?: number | null } }>;
  watchPositionAsync: (
    options: { accuracy: number; distanceInterval: number; timeInterval: number },
    callback: (location: { timestamp: number; coords: { latitude: number; longitude: number; accuracy?: number | null; heading?: number | null } }) => void,
  ) => Promise<{ remove: () => void }>;
};

export type DeviceLocationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

const DECISION_KEY = 'firo.location-permission.v1';
const INSTRUCTION_KEY = 'firo.location-permission.instruction-shown';

let requestLock: Promise<DeviceLocationPermission> | null = null;
let instructionShown = false;
let memoryDecision: 'granted' | 'denied' | 'dismissed' | null = null;

export const LOCATION_SETTINGS_INSTRUCTION = 'Vietos leidimas išjungtas. Kad FIRO įsimintų kiemo koordinatę, adreso juostoje atverkite svetainės nustatymus (spyna) ir įjunkite Vietą. Šis priminimas nebekartojamas prie kiekvieno sustojimo.';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function resetLocationPermissionFlow(): void {
  requestLock = null;
  instructionShown = false;
  memoryDecision = null;
  storage()?.removeItem(DECISION_KEY);
  storage()?.removeItem(INSTRUCTION_KEY);
}

export function clearLocationPermissionLock(): void {
  requestLock = null;
}

export function storedLocationDecision(): 'granted' | 'denied' | 'dismissed' | null {
  if (memoryDecision) return memoryDecision;
  const value = storage()?.getItem(DECISION_KEY);
  return value === 'granted' || value === 'denied' || value === 'dismissed' ? value : null;
}

function rememberDecision(decision: 'granted' | 'denied' | 'dismissed'): void {
  memoryDecision = decision;
  storage()?.setItem(DECISION_KEY, decision);
}

export function locationInstructionAlreadyShown(): boolean {
  return instructionShown || storage()?.getItem(INSTRUCTION_KEY) === '1';
}

export function markLocationInstructionShown(): void {
  instructionShown = true;
  storage()?.setItem(INSTRUCTION_KEY, '1');
}

function mapStatus(status: string | null | undefined): DeviceLocationPermission {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  if (status === 'prompt' || status === 'undetermined') return 'prompt';
  return 'unavailable';
}

async function browserPermission(): Promise<DeviceLocationPermission | null> {
  const permissions = typeof navigator === 'undefined' ? null : navigator.permissions;
  if (!permissions?.query) return null;
  try {
    const result = await permissions.query({ name: 'geolocation' });
    return mapStatus(result.state);
  } catch {
    return null;
  }
}

async function loadLocationModule(): Promise<LocationModule | null> {
  try {
    const loaded = await import('expo-location');
    return loaded as unknown as LocationModule;
  } catch (reason) {
    devWarn('DEVICE_GPS_MODULE_UNAVAILABLE', reason);
    return null;
  }
}

/** Real browser or device state. A stored FIRO choice never overrides a granted system permission. */
export async function readLocationPermissionStatus(): Promise<DeviceLocationPermission> {
  const browser = await browserPermission();
  const location = await loadLocationModule();
  let device: DeviceLocationPermission | null = null;
  if (location) {
    try {
      device = mapStatus((await location.getForegroundPermissionsAsync()).status);
    } catch (reason) {
      devWarn('DEVICE_GPS_PERMISSION_READ_FAILED', reason);
    }
  }
  const real = browser === 'granted' || device === 'granted'
    ? 'granted'
    : browser === 'denied' || device === 'denied'
      ? 'denied'
      : browser === 'prompt' || device === 'prompt'
        ? 'prompt'
        : browser ?? device ?? 'unavailable';
  if (real === 'granted') rememberDecision('granted');
  if (real === 'denied') rememberDecision('denied');
  return real;
}

/**
 * FIRO explanation is not a second permission prompt. It is shown once, and
 * only when the real permission is still undecided.
 */
export function shouldShowFiroLocationExplanation(
  status: DeviceLocationPermission,
  decision = storedLocationDecision(),
): boolean {
  if (status === 'granted' || status === 'denied' || status === 'unavailable') return false;
  return decision !== 'granted' && decision !== 'denied' && decision !== 'dismissed';
}

export function shouldShowLocationSettingsInstruction(status: DeviceLocationPermission): boolean {
  if (status !== 'denied' && storedLocationDecision() !== 'denied' && storedLocationDecision() !== 'dismissed') return false;
  if (status === 'granted') return false;
  return !locationInstructionAlreadyShown();
}

export function dismissFiroLocationExplanation(): void {
  rememberDecision('dismissed');
  markLocationInstructionShown();
}

/**
 * System permission dialog only. Caller must invoke this from a user action
 * while the real status is still prompt. The lock is cleared after success,
 * failure, and when the screen unmounts.
 */
export async function requestSystemLocationPermission(): Promise<DeviceLocationPermission> {
  if (requestLock) return requestLock;
  const pending = requestSystemLocationPermissionUnlocked().finally(() => {
    if (requestLock === pending) requestLock = null;
  });
  requestLock = pending;
  return pending;
}

async function requestSystemLocationPermissionUnlocked(): Promise<DeviceLocationPermission> {
  const current = await readLocationPermissionStatus();
  if (current === 'granted') return 'granted';
  if (current === 'denied') {
    markLocationInstructionShown();
    return 'denied';
  }
  const location = await loadLocationModule();
  if (!location) {
    rememberDecision('dismissed');
    return 'unavailable';
  }
  try {
    const requested = await location.requestForegroundPermissionsAsync();
    const status = mapStatus(requested.status);
    if (status === 'granted') {
      rememberDecision('granted');
      return 'granted';
    }
    rememberDecision('denied');
    markLocationInstructionShown();
    return status === 'prompt' ? 'denied' : status;
  } catch (reason) {
    devWarn('DEVICE_GPS_PERMISSION_REQUEST_FAILED', reason);
    rememberDecision('dismissed');
    return 'unavailable';
  }
}

