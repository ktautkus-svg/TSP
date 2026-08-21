import type { SQLiteDatabase } from 'expo-sqlite';

export type CompanyProfile = {
  name: string;
  address: string;
};

const KEY = 'company_profile';
const EMPTY: CompanyProfile = { name: '', address: '' };

export class CompanyProfileSettings {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<CompanyProfile> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?',
      KEY,
    );
    if (!row?.value) return EMPTY;
    try {
      const parsed = JSON.parse(row.value) as Partial<CompanyProfile>;
      return { name: parsed.name ?? '', address: parsed.address ?? '' };
    } catch {
      return EMPTY;
    }
  }

  async save(profile: CompanyProfile, now = new Date().toISOString()): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      KEY,
      JSON.stringify({ name: profile.name.trim(), address: profile.address.trim() }),
      now,
    );
  }
}
