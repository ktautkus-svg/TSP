import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildFuelLedger } from '../../src/application/trip-sheet/fuel-balance';
import { KAROLIS_TAUTKUS_DRIVER_ID } from '../../src/domain/trip-sheet-august-2026-vehicle-fix';
import {
  NLL182_SEPTEMBER_0904_FILL,
  NLL182_SEPTEMBER_0906_EMPTY_KM,
  NLL182_SEPTEMBER_2026_BACKFILL_ID,
  NLL182_SEPTEMBER_2026_BACKFILL_V2_ID,
  NLL182_SEPTEMBER_2026_DAYS,
  NLL182_SEPTEMBER_2026_FILL_IDS,
  NLL182_SEPTEMBER_2026_OPENING,
  isNll182September0902WrongAssignment,
  isNll182September2026FuelEntry,
  nll182SeptemberDayDistanceKm,
  nll182SeptemberShipmentLines,
} from '../../src/domain/nll182-september-2026-backfill';
import { uniqueRegionCodes } from '../../src/domain/route-code';

const storeSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
const apiSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-api.ts'), 'utf8');
const productionServer = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');

const byDate = Object.fromEntries(NLL182_SEPTEMBER_2026_DAYS.map((day) => [day.date, day]));

describe('NLL182 September 2026 backfill catalog', () => {
  it('carries the authoritative odometer, driver and route facts', () => {
    expect(NLL182_SEPTEMBER_2026_DAYS.map((day) => day.date))
      .toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);

    expect(byDate['2026-09-01']).toMatchObject({
      startOdometer: 283165, endOdometer: 283256, driverId: null, driverName: null, routeCodes: [], routeId: null, fill: null,
    });
    expect(nll182SeptemberDayDistanceKm(byDate['2026-09-01']!)).toBe(91);

    expect(byDate['2026-09-02']).toMatchObject({
      startOdometer: 283256, endOdometer: 283671, driverId: KAROLIS_TAUTKUS_DRIVER_ID, driverName: 'Karolis Tautkus',
    });
    expect(byDate['2026-09-02']!.routeCodes).toEqual(['R11', 'R19', 'R54']);
    expect(byDate['2026-09-02']!.fill).toEqual({ id: 'seed-NLL182-20260902-78', liters: 78 });
    expect(nll182SeptemberDayDistanceKm(byDate['2026-09-02']!)).toBe(415);

    expect(byDate['2026-09-03']).toMatchObject({
      startOdometer: 283671, endOdometer: 283829, driverId: KAROLIS_TAUTKUS_DRIVER_ID, driverName: 'Karolis Tautkus',
    });
    expect(byDate['2026-09-03']!.routeCodes).toEqual(['M11']);
    expect(byDate['2026-09-03']!.fill).toEqual({ id: 'seed-NLL182-20260903-79', liters: 79 });
    expect(nll182SeptemberDayDistanceKm(byDate['2026-09-03']!)).toBe(158);
  });

  it('continues the August odometer chain without rewriting 2026-08-31', () => {
    // NLL182 2026-08-31 ends at 283165 in the August corrections; September opens there.
    expect(byDate['2026-09-01']!.startOdometer).toBe(283165);
    expect(storeSource).not.toContain("date: '2026-08-31', startOdometer: 283151, endOdometer: 283165 }, // rewritten");
  });

  it('shows the day route codes through uniqueRegionCodes, M11 included', () => {
    expect(uniqueRegionCodes(nll182SeptemberShipmentLines(byDate['2026-09-02']!))).toEqual(['R11', 'R19', 'R54']);
    expect(uniqueRegionCodes(nll182SeptemberShipmentLines(byDate['2026-09-03']!))).toEqual(['M11']);
    expect(uniqueRegionCodes(nll182SeptemberShipmentLines(byDate['2026-09-01']!))).toEqual([]);
  });

  it('opens the September ledger on 21 L, not a fictitious 30 L', () => {
    expect(NLL182_SEPTEMBER_2026_OPENING).toMatchObject({ liters: 21, effectiveAt: '2026-09-01', reportId: 'open-NLL182-20260901' });

    const ledger = buildFuelLedger(
      NLL182_SEPTEMBER_2026_DAYS.map((day) => ({
        date: day.date,
        distanceKm: nll182SeptemberDayDistanceKm(day),
        fuelNormLPer100Km: 13.9,
        addedLiters: day.fill?.liters ?? 0,
      })),
      NLL182_SEPTEMBER_2026_OPENING.liters,
    );

    expect(ledger[0]!.startLiters).toBe(21);
    expect(ledger[0]!.consumedLiters).toBeCloseTo(12.65, 2); // 91 * 13.9 / 100
    expect(ledger[0]!.endLiters).toBeCloseTo(8.35, 2);
    expect(ledger[1]!.startLiters).toBeCloseTo(8.35, 2);
    expect(ledger[1]!.endLiters).toBeCloseTo(28.66, 2); // 8.35 + 78 - 57.69
    expect(ledger[2]!.endLiters).toBeCloseTo(85.7, 1); // 28.66 + 79 - 21.96
    expect(ledger.every((day) => (day.endLiters ?? 0) >= 0)).toBe(true);
  });

  it('identifies its own fuel entries so a second boot never doubles a fill', () => {
    expect(NLL182_SEPTEMBER_2026_FILL_IDS).toEqual(['seed-NLL182-20260902-78', 'seed-NLL182-20260903-79']);
    expect(isNll182September2026FuelEntry({ id: 'seed-NLL182-20260902-78', registrationNumber: 'NLL182' })).toBe(true);
    expect(isNll182September2026FuelEntry({ id: 'seed-NLL182-20260903-79', registrationNumber: 'nll182' })).toBe(true);
    // The old August 08-19 78 L fill (receipt 212/1167) must not be mistaken for ours.
    expect(isNll182September2026FuelEntry({ id: 'excel-fuel-NLL182-20260819-212-1167', registrationNumber: 'NLL182' })).toBe(false);
    expect(isNll182September2026FuelEntry({ id: 'seed-NLL182-20260902-78', registrationNumber: 'MET630' })).toBe(false);
  });
});

describe('NLL182 September 2026 backfill migration wiring', () => {
  it('is a flag-gated one-shot that skips every write it has already made', () => {
    expect(NLL182_SEPTEMBER_2026_BACKFILL_ID).toBe('nll182-september-2026-backfill-v1');
    expect(storeSource).toContain('async applySeptember2026Nll182Backfill(');
    expect(storeSource).toContain('this.settings.doc(NLL182_SEPTEMBER_2026_BACKFILL_ID)');
    expect(storeSource).toContain("existingFlag.data()?.status === 'applied'");
    // deterministic ids + existence checks = idempotent re-run
    expect(storeSource).toContain('if (!(await this.vehicleDayReadings.doc(readingId).get()).exists)');
    expect(storeSource).toContain('if (!(await fillRef.get()).exists)');
    expect(storeSource).toContain("await this.assignments.where('routeId', '==', day.routeId).get()");
    expect(storeSource).toContain('this.fuelReports.doc(NLL182_SEPTEMBER_2026_OPENING.reportId)');
  });

  it('runs after the August backfills on both boot paths', () => {
    expect(apiSource).toContain('export function ensureNll182September2026Migrated()');
    expect(apiSource).toContain('store.applySeptember2026Nll182Backfill()');
    expect(apiSource.indexOf('await ensureAugust2026ExcelBackfillMigrated();'))
      .toBeLessThan(apiSource.indexOf('await ensureNll182September2026Migrated();'));
    expect(productionServer.indexOf('await ensureAugust2026ExcelBackfillMigrated();'))
      .toBeLessThan(productionServer.indexOf('await ensureNll182September2026Migrated();'));
  });

  it('v2 fixes 09-02 codes, adds the 09-04 fill and 09-06 empty km, idempotently', () => {
    expect(NLL182_SEPTEMBER_2026_BACKFILL_V2_ID).toBe('nll182-september-2026-backfill-v2');
    // Only a completed assignment made ENTIRELY of the wrong codes is removed.
    expect(isNll182September0902WrongAssignment(['R88', 'R90', 'R82', 'R86', 'R15'])).toBe(true);
    expect(isNll182September0902WrongAssignment(['r88', 'r15'])).toBe(true);
    expect(isNll182September0902WrongAssignment(['R88', 'R11'])).toBe(false); // has a real code
    expect(isNll182September0902WrongAssignment(['R11', 'R54', 'R19'])).toBe(false);
    expect(isNll182September0902WrongAssignment([])).toBe(false);
    expect(NLL182_SEPTEMBER_0904_FILL).toMatchObject({ id: 'seed-NLL182-20260904-79', liters: 79, date: '2026-09-04' });
    expect(NLL182_SEPTEMBER_0906_EMPTY_KM).toMatchObject({ date: '2026-09-06', extraKm: 68 });

    expect(storeSource).toContain('async applySeptember2026Nll182BackfillV2(');
    expect(storeSource).toContain('this.settings.doc(NLL182_SEPTEMBER_2026_BACKFILL_V2_ID)');
    expect(storeSource).toContain("if ((await flagRef.get()).data()?.status === 'applied')");
    expect(storeSource).toContain('extraDistanceKm: NLL182_SEPTEMBER_0906_EMPTY_KM.extraKm');
    expect(storeSource).toContain('startOdometer: anchorOdometer');
    expect(storeSource).toContain('endOdometer: anchorOdometer'); // 0 span — never wage distance
    expect(apiSource).toContain('store.applySeptember2026Nll182BackfillV2()');
    expect(apiSource.indexOf('applySeptember2026Nll182Backfill()'))
      .toBeLessThan(apiSource.indexOf('applySeptember2026Nll182BackfillV2()'));
  });

  it('does not touch the fuel norm or MET630 fills', () => {
    const method = storeSource.slice(
      storeSource.indexOf('async applySeptember2026Nll182Backfill('),
      storeSource.indexOf('private liteFromRouteAssignment('),
    );
    expect(method).not.toMatch(/fuelNormLPer100Km\s*[:=]/);
    expect(method).not.toContain('MET630');
    expect(method).not.toContain('fuelRemainingLiters:');
  });
});
