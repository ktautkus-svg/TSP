import * as Crypto from 'expo-crypto';

export async function randomSalt(): Promise<string> {
  return bytesToHex(await Crypto.getRandomBytesAsync(16));
}

export async function derivePinHash(username: string, pin: string, salt: string, iterations = 120_000): Promise<string> {
  let value = `${salt}:${username}:${pin}`;
  for (let index = 0; index < Math.max(4_096, Math.floor(iterations / 24)); index += 1) {
    value = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  }
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
