import { File } from 'expo-file-system';

/** Naršyklėje (web/PWA) nuotraukos adresas yra blob:, data: arba http(s): – expo-file-system `File` ten neveikia. */
export function isWebUri(uri: string): boolean {
  return /^(blob:|data:|https?:)/i.test(uri);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Perskaito failą kaip base64. Telefono programoje naudoja expo-file-system, o naršyklėje (PWA)
 * – fetch, nes web `File` klasė meta „this.validatePath is not a function“.
 */
export async function readUriAsBase64(uri: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (isWebUri(uri)) {
    const response = await fetcher(uri);
    if (!response.ok) throw new Error(`Nepavyko nuskaityti failo (HTTP ${response.status}).`);
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  }
  return new File(uri).base64();
}
