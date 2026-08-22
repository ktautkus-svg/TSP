import type { SQLiteDatabase } from 'expo-sqlite';

import { isVanBodyKind, type VanBodyKind } from '@/domain/loading-schema';

const BODY_KEY = 'van_cargo_body';
const SIDE_DOOR_KEY = 'van_has_side_door';

export type VanCargoConfig = {
  bodyKind: VanBodyKind;
  hasSideDoor: boolean;
};

export class VanBodyPreference {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<VanCargoConfig> {
    const [body, side] = await Promise.all([
      this.db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', BODY_KEY),
      this.db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', SIDE_DOOR_KEY),
    ]);
    return {
      bodyKind: isVanBodyKind(body?.value) ? body.value : 'van_long',
      hasSideDoor: side?.value === '1',
    };
  }

  async save(config: Partial<VanCargoConfig>, now = new Date().toISOString()): Promise<void> {
    if (config.bodyKind !== undefined) {
      await this.db.runAsync(
        `INSERT INTO app_preferences (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        BODY_KEY,
        config.bodyKind,
        now,
      );
    }
    if (config.hasSideDoor !== undefined) {
      await this.db.runAsync(
        `INSERT INTO app_preferences (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        SIDE_DOOR_KEY,
        config.hasSideDoor ? '1' : '0',
        now,
      );
    }
  }
}
