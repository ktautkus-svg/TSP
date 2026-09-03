import { describe, expect, it } from 'vitest';

import {
  driverSheetRunPeriod,
  splitDriverSheetRuns,
  type VehicleDay,
} from '../../src/application/trip-sheet/driver-sheets';

type Row = { date: string; driver: string };

function day(date: string, driver: string, active = true): VehicleDay<Row> {
  return { date, driverKey: driver, driverName: driver, active, row: { date, driver } };
}

describe('splitDriverSheetRuns', () => {
  it('numbers a new sheet per driver each time they retake the vehicle after someone else', () => {
    const runs = splitDriverSheetRuns([
      day('2026-08-01', 'X'),
      day('2026-08-02', 'X'),
      day('2026-08-03', 'Y'),
      day('2026-08-04', 'X'),
      day('2026-08-05', 'Y'),
    ]);

    expect(runs.map((run) => ({
      driver: run.driverName,
      nr: run.sheetNumber,
      period: driverSheetRunPeriod(run),
      days: run.days.map((row) => row.date),
    }))).toEqual([
      { driver: 'X', nr: 1, period: '2026-08-01 – 2026-08-02', days: ['2026-08-01', '2026-08-02'] },
      { driver: 'Y', nr: 1, period: '2026-08-03', days: ['2026-08-03'] },
      { driver: 'X', nr: 2, period: '2026-08-04', days: ['2026-08-04'] },
      { driver: 'Y', nr: 2, period: '2026-08-05', days: ['2026-08-05'] },
    ]);
  });

  it('keeps consecutive same-driver days as one sheet, including across an idle gap', () => {
    const runs = splitDriverSheetRuns([
      day('2026-08-01', 'X'),
      day('2026-08-02', 'X'),
      // 08-03 the vehicle stood still — no entry at all
      day('2026-08-04', 'X'),
      day('2026-08-05', 'X'),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.sheetNumber).toBe(1);
    expect(driverSheetRunPeriod(runs[0]!)).toBe('2026-08-01 – 2026-08-05');
    expect(runs[0]!.days.map((row) => row.date)).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05',
    ]);
  });

  it('does not split a sheet for an inactive 0 km leftover-assignment day', () => {
    const runs = splitDriverSheetRuns([
      day('2026-08-01', 'X'),
      day('2026-08-02', 'X', false), // R88;R86 re-stapled here, 0 km, no fill
      day('2026-08-03', 'X'),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.days.map((row) => row.date)).toEqual(['2026-08-01', '2026-08-03']);
  });

  it('splits on a day another driver used the vehicle even at 0 km', () => {
    const runs = splitDriverSheetRuns([
      day('2026-08-01', 'X'),
      day('2026-08-02', 'Y'), // Y took it out, even if only briefly
      day('2026-08-03', 'X'),
    ]);

    expect(runs.map((run) => `${run.driverName} Nr.${run.sheetNumber}`)).toEqual([
      'X Nr.1', 'Y Nr.1', 'X Nr.2',
    ]);
  });

  it('produces no runs when nothing was active', () => {
    expect(splitDriverSheetRuns([day('2026-08-01', 'X', false)])).toEqual([]);
  });
});
