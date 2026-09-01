import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { ThemePreference } from '../../src/application/settings/theme-preference';
import { darkColors } from '../../src/ui/theme-palette';

// Mirrors the keys of src/ui/tokens.ts `colors` without importing that module,
// since it pulls in react-native (Flow syntax vitest/rolldown can't parse in the node test env).
// tsc already enforces darkColors matches ColorPalette = Record<keyof typeof lightColors, string>.
const expectedPaletteKeys = [
  'background', 'surface', 'surfaceElevated', 'surfaceMuted', 'surfaceSubtle',
  'text', 'textSecondary', 'textMuted', 'textSubtle', 'textDisabled', 'textInverse',
  'border', 'borderSubtle', 'borderStrong', 'primary', 'primaryDark', 'primarySoft',
  'accent', 'accentSoft', 'accentStrong', 'success',
  'warning', 'warningSoft', 'danger', 'dangerSoft', 'info', 'infoSoft',
  'actionPrimary', 'actionPrimaryPressed', 'actionRoute', 'actionRoutePressed',
  'disabledSurface', 'disabledText',
  'brandNavy', 'brandOperationalNavy', 'brandBurgundy', 'brandBurgundyLight',
];

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

const migrationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations.ts'),
  'utf8',
);

function migration(name: string): string {
  const match = migrationSource.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
}

function createDb(through = 11): SQLiteDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= through; version += 1) adapter.raw.exec(migration(`migrationV${version}`));
  return adapter as unknown as SQLiteDatabase;
}

describe('ThemePreference', () => {
  it('defaults to the approved light theme when nothing is stored', async () => {
    const db = createDb();
    expect(await new ThemePreference(db).get()).toBe('light');
  });

  it('persists and reloads the chosen mode, including an explicit system choice', async () => {
    const db = createDb();
    const preference = new ThemePreference(db);
    await preference.save('light');
    expect(await preference.get()).toBe('light');

    await preference.save('system');
    expect(await preference.get()).toBe('system');

    await preference.save('dark');
    expect(await preference.get()).toBe('dark');
  });

  it('falls back to light for an unexpected stored value', async () => {
    const db = createDb();
    await db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at) VALUES ('theme_preference', 'garbled', ?)`,
      new Date().toISOString(),
    );
    expect(await new ThemePreference(db).get()).toBe('light');
  });
});

describe('darkColors', () => {
  it('defines every key present in the light palette', () => {
    expect(Object.keys(darkColors).sort()).toEqual(expectedPaletteKeys.sort());
  });
});
