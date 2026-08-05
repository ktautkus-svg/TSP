const DATABASE_NAME = 'pristatymai-pwa-settings';
const STORE_NAME = 'settings';
const DEVICE_SECRET_KEY = 'device_connection_key';

function cleanSecret(val: string | null | undefined): string | null {
  if (!val) return null;
  const cleaned = val.trim().replace(/^["']|["']$/g, '').trim();
  return cleaned ? cleaned : null;
}

const defaultEnvSecret = typeof process !== 'undefined'
  ? cleanSecret(
      process.env.EXPO_PUBLIC_GATEWAY_DEVICE_SECRET ||
      process.env.VITE_GATEWAY_DEVICE_SECRET ||
      process.env.GATEWAY_DEVICE_SECRET
    )
  : null;

let memorySecret: string | null = defaultEnvSecret;

export async function getGatewayDeviceSecret(): Promise<string | null> {
  if (typeof indexedDB === 'undefined') return cleanSecret(memorySecret) ?? defaultEnvSecret;
  return withStore('readonly', (store) => requestValue<string | undefined>(store.get(DEVICE_SECRET_KEY)))
    .then((value) => cleanSecret(value) ?? cleanSecret(memorySecret) ?? defaultEnvSecret)
    .catch(() => cleanSecret(memorySecret) ?? defaultEnvSecret);
}

export async function saveGatewayDeviceSecret(secret: string): Promise<void> {
  const normalized = cleanSecret(secret) ?? '';
  if (normalized.length < 32) throw new Error('Įrenginio raktas per trumpas.');
  memorySecret = normalized;
  if (typeof indexedDB === 'undefined') return;
  await withStore('readwrite', (store) => requestValue(store.put(normalized, DEVICE_SECRET_KEY)));
}

export async function clearGatewayDeviceSecret(): Promise<void> {
  memorySecret = null;
  if (typeof indexedDB === 'undefined') return;
  await withStore('readwrite', (store) => requestValue(store.delete(DEVICE_SECRET_KEY)));
}

export async function createGatewayAuthorizationHeaders(rawBody: string): Promise<Record<string, string>> {
  const secret = await getGatewayDeviceSecret();
  if (!secret) return {};
  if (!globalThis.crypto?.subtle) throw new Error('Ši naršyklė nepalaiko saugaus Gateway parašo.');
  const timestamp = String(Date.now());
  const nonce = globalThis.crypto.randomUUID?.() ?? randomNonce();
  const bodyHash = await digestHex(rawBody);
  const canonical = `${timestamp}.${nonce}.${bodyHash}`;
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
  return {
    'x-routing-timestamp': timestamp,
    'x-routing-nonce': nonce,
    'x-routing-signature': bytesToHex(new Uint8Array(signature)),
  };
}

export async function verifyGatewayConnection(fetcher: typeof fetch = globalThis.fetch): Promise<boolean> {
  const rawBody = '{}';
  const headers = await createGatewayAuthorizationHeaders(rawBody);
  try {
    const response = await fetcher('/api/device/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: rawBody,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function digestHex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Nepavyko atidaryti vietinės nustatymų saugyklos.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
  } finally {
    database.close();
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Vietinės saugyklos operacija nepavyko.'));
  });
}
