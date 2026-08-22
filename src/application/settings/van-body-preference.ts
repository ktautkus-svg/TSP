import type { SQLiteDatabase } from 'expo-sqlite';

import { isVanBodyKind, type VanBodyKind } from '@/domain/loading-schema';

const KEY = 'van_cargo_body';

export class VanBodyPreference {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<VanBodyKind> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?',
      KEY,
    );
    return isVanBodyKind(row?.value) ? row.value : 'van_long';
  }

  async save(value: VanBodyKind, now = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      KEY,
      value,
      now,
    );
  }
}
