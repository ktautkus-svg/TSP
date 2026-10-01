import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assembleDailyTripRows,
  fuelEntriesOnDate,
  fuelFillCalendarDate,
  indexFuelByVehicleFillDate,
  presentedDistanceKm,
  tripSheetRouteLabel,
  type TripDayFuelEntry,
  type TripDaySheet,
} from '../../src/application/trip-sheet/day-rows';
import { buildFuelLedger, fuelFillContinuesLedger } from '../../src/application/trip-sheet/fuel-balance';
import { uncoveredFuelDayKeys } from '../../src/domain/excel-fuel-log';

const NORM = 13.9;
const storeSource = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');

function fill(partial: Partial<TripDayFuelEntry> & Pick<TripDayFuelEntry, 'id' | 'filledAt' | 'liters'>): TripDayFuelEntry {
  return {
    receiptNumber: null,
    odometer: null,
    ...partial,
  };
}

function drivingDay(date: string, km: number, fuelEntries: TripDayFuelEntry[] = []): TripDaySheet {
  return {
    id: `trip-${date}`,
    assignmentId: `assignment-${date}`,
    date,
    driverId: 'driver-1',
    driverName: 'Karolis Tautkus',
    routeNumbers: ['R11'],
    startAddress: 'Vilnius',
    endAddress: 'Kaunas',
    startOdometer: 1000,
    endOdometer: 1000 + km,
    actualDistanceKm: km,
    plannedDistanceKm: km,
    extraDistanceKm: 0,
    fuelNormLitersPer100Km: NORM,
    compensation: { totalNetEur: 40, preliminary: false },
    vehicle: { id: 'van-1' },
    source: 'server',
    fuelEntries,
  };
}

function ledgerOf(rows: ReturnType<typeof assembleDailyTripRows>, opening: number) {
  return buildFuelLedger(rows.map((day) => ({
    date: day.date,
    distanceKm: fuelFillContinuesLedger(day) ? 0 : day.distanceKm,
    fuelOnly: fuelFillContinuesLedger(day),
    fuelNormLPer100Km: day.fuelNorm,
    addedLiters: day.fuelAdded,
  })), opening);
}

describe('kelionės lapo diena be važiavimo, kai piltas kuras', () => {
  const misplaced = fill({
    id: 'fill-0908',
    filledAt: '2026-09-08T12:00:00.000Z',
    liters: 107.23,
    receiptNumber: '44821',
  });

  it('įterpia kuro dieną tarp dviejų važiavimų ir neperkelia litrų į kitą dieną', () => {
    const rows = assembleDailyTripRows([
      drivingDay('2026-09-07', 80, [fill({ id: 'own-07', filledAt: '2026-09-07T12:00:00.000Z', liters: 20, receiptNumber: '1' })]),
      drivingDay('2026-09-09', 200, [
        misplaced,
        fill({ id: 'own-09', filledAt: '2026-09-09T12:00:00.000Z', liters: 30, receiptNumber: '2' }),
      ]),
    ]);

    expect(rows.map((row) => row.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
    const [before, fuelDay, after] = rows;
    expect(before?.distanceKm).toBe(80);
    expect(before?.fuelAdded).toBe(20);
    expect(before?.compensationEur).toBe(40);
    expect(fuelDay?.routeNumbers).toEqual([]);
    expect(tripSheetRouteLabel(fuelDay!)).toBe('—');
    expect(presentedDistanceKm(fuelDay!)).toBe(0);
    expect(fuelDay?.fuelAdded).toBe(107.23);
    expect(fuelDay?.fuelEntries.map((entry) => entry.receiptNumber)).toEqual(['44821']);
    expect(fuelDay?.startOdometer).toBeNull();
    expect(fuelDay?.endOdometer).toBeNull();
    expect(after?.distanceKm).toBe(200);
    expect(after?.fuelAdded).toBe(30);
    expect(after?.routeNumbers).toEqual(['R11']);
    expect(tripSheetRouteLabel(after!)).toBe('R11');

    const ledger = ledgerOf(rows, 40);
    expect(ledger[0]?.consumedLiters).toBe(11.12);
    expect(ledger[0]?.endLiters).toBe(48.88);
    expect(ledger[1]?.consumedLiters).toBe(0);
    expect(ledger[1]?.startLiters).toBe(48.88);
    expect(ledger[1]?.endLiters).toBe(156.11);
    expect(ledger[2]?.startLiters).toBe(156.11);
    expect(ledger[2]?.consumedLiters).toBe(27.8);
  });

  it('sukuria kuro dieną prieš pirmą mėnesio važiavimą', () => {
    const rows = assembleDailyTripRows([
      drivingDay('2026-09-09', 200, [misplaced]),
    ]);
    expect(rows.map((row) => row.date)).toEqual(['2026-09-08', '2026-09-09']);
    expect(rows[0]?.fuelAdded).toBe(107.23);
    expect(rows[1]?.fuelAdded).toBe(0);
    expect(presentedDistanceKm(rows[0]!)).toBe(0);
    const ledger = ledgerOf(rows, 10);
    expect(ledger[0]?.endLiters).toBe(117.23);
    expect(ledger[1]?.startLiters).toBe(117.23);
    expect(ledger[1]?.consumedLiters).toBe(27.8);
  });

  it('sukuria kuro dieną po paskutinio mėnesio važiavimo', () => {
    const later = fill({ id: 'fill-0912', filledAt: '2026-09-12T12:00:00.000Z', liters: 107.23, receiptNumber: '90' });
    const rows = assembleDailyTripRows([
      drivingDay('2026-09-09', 200, [later]),
    ]);
    expect(rows.map((row) => row.date)).toEqual(['2026-09-09', '2026-09-12']);
    expect(rows[0]?.fuelAdded).toBe(0);
    expect(rows[0]?.distanceKm).toBe(200);
    expect(rows[1]?.fuelAdded).toBe(107.23);
    expect(tripSheetRouteLabel(rows[1]!)).toBe('—');
    const ledger = ledgerOf(rows, 50);
    expect(ledger[0]?.endLiters).toBe(22.2);
    expect(ledger[1]?.startLiters).toBe(22.2);
    expect(ledger[1]?.consumedLiters).toBe(0);
    expect(ledger[1]?.endLiters).toBe(129.43);
  });

  it('kelias kuro operacijas tą pačią dieną sudeda į vieną eilutę', () => {
    const rows = assembleDailyTripRows([
      drivingDay('2026-09-09', 200, [
        fill({ id: 'b', filledAt: '2026-09-08T15:00:00.000Z', liters: 66.73, receiptNumber: 'B' }),
        fill({ id: 'a', filledAt: '2026-09-08T08:00:00.000Z', liters: 40.5, receiptNumber: 'A' }),
        fill({ id: 'a', filledAt: '2026-09-08T08:00:00.000Z', liters: 40.5, receiptNumber: 'A' }),
      ]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.date).toBe('2026-09-08');
    expect(rows[0]?.fuelEntries.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(rows[0]?.fuelAdded).toBe(107.23);
    expect(rows[0]?.fuelEntries.map((entry) => entry.receiptNumber)).toEqual(['A', 'B']);
    expect(rows[1]?.fuelAdded).toBe(0);
  });

  it('palieka tos pačios dienos pylimą važiavimo eilutėje ir nekeičia kilometrų', () => {
    const own = fill({ id: 'own', filledAt: '2026-09-09T12:00:00.000Z', liters: 50, receiptNumber: '77' });
    const rows = assembleDailyTripRows([drivingDay('2026-09-09', 200, [own])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-09-09',
      distanceKm: 200,
      fuelAdded: 50,
      compensationEur: 40,
      routeNumbers: ['R11'],
    });
    expect(presentedDistanceKm(rows[0]!)).toBe(200);
    const ledger = ledgerOf(rows, 40);
    expect(ledger[0]?.consumedLiters).toBe(27.8);
    expect(ledger[0]?.endLiters).toBe(62.2);
  });

  it('pylimo datą ima iš filledAt, o ne iš vehicle-day priskyrimo', () => {
    const entry = {
      id: 'fill-0908',
      filledAt: '2026-09-08T12:00:00.000Z',
      liters: 107.23,
      vehicleId: 'van-1',
      assignmentId: 'vehicle-day-van-1-2026-09-09',
    };
    expect(fuelFillCalendarDate(entry.filledAt)).toBe('2026-09-08');
    const indexed = indexFuelByVehicleFillDate([entry]);
    expect([...indexed.keys()]).toEqual(['van-1:2026-09-08']);
    expect(uncoveredFuelDayKeys(indexed, new Set(['van-1:2026-09-09']))).toEqual(['van-1:2026-09-08']);
    expect(fuelEntriesOnDate([entry], '2026-09-09')).toEqual([]);
    expect(fuelEntriesOnDate([entry], '2026-09-08').map((item) => item.id)).toEqual(['fill-0908']);
    expect(storeSource).toContain('indexFuelByVehicleFillDate(allEntries)');
    expect(storeSource).toContain('return fuelEntriesOnDate([');
    expect(storeSource).not.toContain('vehicleDay?.date ?? entry.filledAt');
  });
});
