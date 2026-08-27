import type { SQLiteDatabase } from 'expo-sqlite';

import { derivePinHash, randomSalt } from '@/application/auth/local-access-crypto';

const USERNAME_KEY = 'local_access_username';
const SALT_KEY = 'local_access_pin_salt';
const HASH_KEY = 'local_access_pin_hash';
const UPDATED_KEY = 'local_access_updated_at';
const UNLOCKED_AT_KEY = 'local_access_unlocked_at';
const ACTING_DRIVER_ID_KEY = 'admin_acting_driver_id';
const ACTING_DRIVER_NAME_KEY = 'admin_acting_driver_name';
export const LOCAL_ACCESS_PREFERENCE_PREFIX = 'local_access_';

export type LocalAccessConfiguration = {
  configured: boolean;
  username: string | null;
  updatedAt: string | null;
};

/** A driver an admin/dispatcher has chosen to operate this device as, on this device only. */
export type ActingDriver = { id: string; displayName: string };

export class LocalAccessService {
  constructor(private readonly db: SQLiteDatabase) {}

  async getConfiguration(): Promise<LocalAccessConfiguration> {
    const rows = await this.db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_preferences WHERE key IN (?, ?, ?)',
      USERNAME_KEY,
      HASH_KEY,
      UPDATED_KEY,
    );
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      configured: Boolean(values.get(USERNAME_KEY) && values.get(HASH_KEY)),
      username: values.get(USERNAME_KEY) ?? null,
      updatedAt: values.get(UPDATED_KEY) ?? null,
    };
  }

  async configure(username: string, pin: string): Promise<void> {
    const normalizedUsername = validateUsername(username);
    validateNewPin(pin);
    const existing = await this.getConfiguration();
    if (existing.configured) throw new Error('Prisijungimas jau sukurtas. PIN keiskite administratoriaus panelėje.');
    const salt = await randomSalt();
    const hash = await derivePinHash(normalizedUsername, pin, salt);
    await this.persist(normalizedUsername, salt, hash);
  }

  async syncServerCredentials(username: string, pin: string): Promise<void> {
    const normalizedUsername = validateUsername(username);
    validatePin(pin);
    const salt = await randomSalt();
    const hash = await derivePinHash(normalizedUsername, pin, salt);
    await this.persist(normalizedUsername, salt, hash);
  }

  async verify(username: string, pin: string): Promise<boolean> {
    const normalizedUsername = username.trim().toLocaleLowerCase('lt-LT');
    const rows = await this.db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_preferences WHERE key IN (?, ?, ?)',
      USERNAME_KEY,
      SALT_KEY,
      HASH_KEY,
    );
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const storedUsername = values.get(USERNAME_KEY);
    const salt = values.get(SALT_KEY);
    const expected = values.get(HASH_KEY);
    if (!storedUsername || !salt || !expected || normalizedUsername !== storedUsername) return false;
    const actual = await derivePinHash(storedUsername, pin, salt);
    return constantTimeEqual(actual, expected);
  }

  /** Marks the app unlocked right now, starting the PIN grace period. */
  async markUnlocked(): Promise<void> {
    const now = new Date().toISOString();
    await this.db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      UNLOCKED_AT_KEY,
      now,
      now,
    );
  }

  async getLastUnlockedAt(): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', UNLOCKED_AT_KEY);
    return row?.value ?? null;
  }

  /** The driver this device's admin/dispatcher session is currently operating as, if any. */
  async getActingDriver(): Promise<ActingDriver | null> {
    const rows = await this.db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM app_preferences WHERE key IN (?, ?)',
      ACTING_DRIVER_ID_KEY,
      ACTING_DRIVER_NAME_KEY,
    );
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const id = values.get(ACTING_DRIVER_ID_KEY);
    const displayName = values.get(ACTING_DRIVER_NAME_KEY);
    return id && displayName ? { id, displayName } : null;
  }

  async setActingDriver(driver: ActingDriver | null): Promise<void> {
    const now = new Date().toISOString();
    if (!driver) {
      await this.db.runAsync('DELETE FROM app_preferences WHERE key IN (?, ?)', ACTING_DRIVER_ID_KEY, ACTING_DRIVER_NAME_KEY);
      return;
    }
    await this.db.withTransactionAsync(async () => {
      for (const [key, value] of [[ACTING_DRIVER_ID_KEY, driver.id], [ACTING_DRIVER_NAME_KEY, driver.displayName]]) {
        await this.db.runAsync(
          `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          key,
          value,
          now,
        );
      }
    });
  }

  async changePin(currentPin: string, nextPin: string): Promise<void> {
    const configuration = await this.getConfiguration();
    if (!configuration.username || !await this.verify(configuration.username, currentPin)) {
      throw new Error('Dabartinis PIN neteisingas.');
    }
    validateNewPin(nextPin);
    const salt = await randomSalt();
    const hash = await derivePinHash(configuration.username, nextPin, salt);
    await this.persist(configuration.username, salt, hash);
  }

  private async persist(username: string, salt: string, hash: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      for (const [key, value] of [
        [USERNAME_KEY, username],
        [SALT_KEY, salt],
        [HASH_KEY, hash],
        [UPDATED_KEY, now],
      ]) {
        await this.db.runAsync(
          `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          key,
          value,
          now,
        );
      }
    });
  }
}

export function validateUsername(value: string): string {
  const username = value.trim().toLocaleLowerCase('lt-LT');
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(username)) {
    throw new Error('Prisijungimo vardą turi sudaryti 3–32 raidės, skaičiai, taškas, brūkšnelis arba pabraukimas.');
  }
  return username;
}

export function validatePin(pin: string): void {
  if (!/^\d{6,8}$/.test(pin)) throw new Error('PIN turi sudaryti 6–8 skaitmenys.');
}

export function validateNewPin(pin: string): void {
  if (!/^\d{6,8}$/.test(pin)) throw new Error('PIN turi sudaryti 6–8 skaitmenys.');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
