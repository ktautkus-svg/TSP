export const PWA_SERVICE_WORKER_VERSION_KEY = 'pwa_service_worker_version';

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigatorWithStandalone.standalone === true;
}

export function serviceWorkerVersion(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(PWA_SERVICE_WORKER_VERSION_KEY);
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
