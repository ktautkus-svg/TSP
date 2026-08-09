import type { SQLiteDatabase } from 'expo-sqlite';

export type NavigationProvider = 'waze' | 'apple_maps' | 'google_maps';

const KEY = 'default_navigation_provider';

export class NavigationPreference {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<NavigationProvider> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?',
      KEY,
    );
    return isNavigationProvider(row?.value) ? row.value : 'waze';
  }

  async save(value: NavigationProvider, now = new Date().toISOString()): Promise<void> {
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

export function isNavigationProvider(value: unknown): value is NavigationProvider {
  return value === 'waze' || value === 'apple_maps' || value === 'google_maps';
}
