import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type EncryptedSecret = {
  cipherText: string;
  iv: string;
};

/** AES-256-GCM. The auth tag is appended to the ciphertext so a row never holds the token in plaintext. */
export function encryptSecret(plain: string, keyMaterial: string): EncryptedSecret {
  const key = createHash('sha256').update(keyMaterial).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { cipherText: encrypted.toString('base64url'), iv: iv.toString('base64url') };
}

export function decryptSecret(secret: EncryptedSecret, keyMaterial: string): string {
  const key = createHash('sha256').update(keyMaterial).digest();
  const payload = Buffer.from(secret.cipherText, 'base64url');
  if (payload.length < 17) throw new Error('Pašto prieigos įrašas sugadintas.');
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.iv, 'base64url'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
