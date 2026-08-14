import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SERVICE_TIME_MODEL, serviceMinutesForWeight } from '../../src/domain/service-time';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path: string) => readFileSync(resolve(here, '../../', path), 'utf8');

describe('stop service time', () => {
  it('scales handling time with the load at five kilograms per minute', () => {
    expect(serviceMinutesForWeight(60)).toBe(12);
    expect(serviceMinutesForWeight(150)).toBe(30);
    expect(serviceMinutesForWeight(200)).toBe(40);
  });

  it('keeps a floor so a light drop still pays for parking and paperwork', () => {
    expect(serviceMinutesForWeight(5)).toBe(SERVICE_TIME_MODEL.minimumMinutes);
    expect(serviceMinutesForWeight(0)).toBe(SERVICE_TIME_MODEL.minimumMinutes);
    expect(serviceMinutesForWeight(24)).toBe(SERVICE_TIME_MODEL.minimumMinutes);
    expect(serviceMinutesForWeight(25)).toBe(SERVICE_TIME_MODEL.minimumMinutes);
    expect(serviceMinutesForWeight(30)).toBe(6);
  });

  it('caps a single stop so one absurd row cannot swallow the workday', () => {
    expect(serviceMinutesForWeight(5_000)).toBe(SERVICE_TIME_MODEL.maximumMinutes);
  });

  it('falls back to a flat estimate when the file gave no weight', () => {
    expect(serviceMinutesForWeight(null)).toBe(SERVICE_TIME_MODEL.unknownWeightMinutes);
    expect(serviceMinutesForWeight(undefined)).toBe(SERVICE_TIME_MODEL.unknownWeightMinutes);
    expect(serviceMinutesForWeight(Number.NaN)).toBe(SERVICE_TIME_MODEL.unknownWeightMinutes);
  });

  it('stores the derived time instead of the old flat ten minutes', () => {
    const commands = source('src/application/routes/route-commands.ts');
    expect(commands).toContain('serviceMinutesForWeight(stop.weightKg)');
    expect(commands).not.toContain("'pending', 'pending', 10,");
  });

  it('backfills pending stops with a migration that never changes', () => {
    const migrations = source('src/database/migrations.ts');
    expect(migrations).toContain('SCHEMA_VERSION = 20');
    expect(migrations).toContain('PRAGMA user_version = 14');
    expect(migrations).toContain("WHERE delivery_status = 'pending'");
    // A migration must not read live tuning constants.
    expect(migrations).not.toContain('SERVICE_MINUTES_SQL');
  });
});
