import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadRouteWeatherScene } from '../../src/application/weather/route-weather';

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

function createDb(through = 26): SQLiteDatabase {
  const adapter = new ExpoLikeDatabase();
  for (let version = 1; version <= through; version += 1) adapter.raw.exec(migration(`migrationV${version}`));
  return adapter as unknown as SQLiteDatabase;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadRouteWeatherScene readout', () => {
  it('parses temperature, wind speed, and the current hour precipitation chance', async () => {
    const now = new Date('2026-08-27T14:30:00');
    const hourKey = '2026-08-27T14:00';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      current: { weather_code: 3, is_day: 1, temperature_2m: 21.4, wind_speed_10m: 13.6 },
      hourly: { time: [hourKey], precipitation_probability: [35] },
    }), { status: 200 })));

    const scene = await loadRouteWeatherScene(createDb(), 54.9, 23.9, now);

    expect(scene.temperatureC).toBe(21);
    expect(scene.windSpeedKmh).toBe(14);
    expect(scene.precipitationProbabilityPercent).toBe(35);
  });

  it('leaves the readout null when the provider is unreachable', async () => {
    vi.stubGlobal('__DEV__', false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const scene = await loadRouteWeatherScene(createDb(), 54.9, 23.9, new Date('2026-08-27T14:30:00'));

    expect(scene.temperatureC).toBeNull();
    expect(scene.windSpeedKmh).toBeNull();
    expect(scene.precipitationProbabilityPercent).toBeNull();
  });
});
