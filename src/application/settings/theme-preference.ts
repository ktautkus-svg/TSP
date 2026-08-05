import type { SQLiteDatabase } from 'expo-sqlite';

export type ThemeMode = 'light' | 'dark' | 'system';

export class ThemePreference {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<ThemeMode> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_preferences WHERE key = 'theme_preference'",
    );
    if (row?.value === 'light' || row?.value === 'dark' || row?.value === 'system') return row.value;
    // No preference saved yet (first launch): default to dark rather than
    // following the system theme, per explicit product decision. The user
    // can still switch to Šviesus/Sistema in Settings at any time.
    return 'dark';
  }

  async save(value: ThemeMode, now = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at)
       VALUES ('theme_preference', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      value,
      now,
    );
  }
}
