export async function randomSalt(): Promise<string> {
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Saugi atsitiktinių duomenų funkcija nepasiekiama.');
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function derivePinHash(username: string, pin: string, salt: string, iterations = 120_000): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === 'undefined') throw new Error('Saugi PIN išvedimo funkcija nepasiekiama.');
  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(`${username}:${pin}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
