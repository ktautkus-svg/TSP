import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chronologicalVehicleFuelEntries } from '../../src/domain/vehicle-fuel-entries';

type Entry = { id: string; vehicleId: string; filledAt: string; liters: number };

function fill(id: string, filledAt: string, liters: number, vehicleId = 'MET630'): Entry {
  return { id, vehicleId, filledAt, liters };
}

describe('chronologicalVehicleFuelEntries', () => {
  it('shows every fill for the selected vehicle, oldest first, without a hidden cap', () => {
    const august: Entry[] = [
      fill('xlsx-MET630-20260804-135-1193', '2026-08-04T06:01:00.000Z', 104),
      fill('xlsx-MET630-20260805-230-419', '2026-08-05T15:14:00.000Z', 107.98),
      fill('xlsx-MET630-20260809-476-1159', '2026-08-09T20:23:00.000Z', 10),
      fill('xlsx-MET630-20260809-325-1158', '2026-08-09T20:38:00.000Z', 95),
      fill('xlsx-MET630-20260811-148-1145', '2026-08-11T06:34:00.000Z', 100),
      fill('xlsx-MET630-20260812-277-1160', '2026-08-12T10:52:00.000Z', 102.17),
      fill('xlsx-MET630-20260813-669-1206', '2026-08-13T20:42:00.000Z', 30.07),
      fill('xlsx-MET630-20260817-333-1165', '2026-08-16T21:45:00.000Z', 103.31),
      fill('xlsx-MET630-20260819-212-1167', '2026-08-19T07:55:00.000Z', 78),
      fill('xlsx-MET630-20260821-1-265', '2026-08-21T01:41:00.000Z', 90),
      fill('xlsx-MET630-20260826-362-1165', '2026-08-26T09:00:00.000Z', 90),
      fill('xlsx-MET630-20260827-271-1215', '2026-08-27T09:00:00.000Z', 86.1),
      fill('xlsx-MET630-20260829-834-1206', '2026-08-29T09:00:00.000Z', 9.5),
      fill('xlsx-MET630-20260830-151-563', '2026-08-30T09:00:00.000Z', 102),
      fill('xlsx-manual-08-52', '2026-08-31T09:00:00.000Z', 95.07),
    ];
    expect(august).toHaveLength(15);

    const listed = chronologicalVehicleFuelEntries(
      [
        { fuelEntries: august.slice(8).reverse() },
        { fuelEntries: august.slice(0, 8) },
        { fuelEntries: [august[0]!, august[12]!] },
        { fuelEntries: [fill('nll-other', '2026-08-13T01:13:00.000Z', 59.99, 'NLL182')] },
      ],
      'MET630',
    );

    expect(listed).toHaveLength(15);
    expect(listed.map((entry) => entry.id)).toEqual(august.map((entry) => entry.id));
    expect(listed[0]!.filledAt <= listed[listed.length - 1]!.filledAt).toBe(true);
    expect(listed.some((entry) => entry.liters === 9.5)).toBe(true);
    expect(listed.some((entry) => entry.id === 'xlsx-manual-08-52')).toBe(true);
    expect(listed.every((entry) => entry.vehicleId === 'MET630')).toBe(true);
  });

  it('does not invent a page that still hides later August fills', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/vehicle.tsx'), 'utf8');
    expect(source).toContain('chronologicalVehicleFuelEntries');
    const fuelEditor = source.slice(
      source.indexOf('testID="vehicle-fuel-editor"'),
      source.indexOf('testID="vehicle-opening-fuel-balance"'),
    );
    expect(fuelEditor).toContain('vehicleFuelEntries.map');
    expect(fuelEditor).not.toContain('slice(0, 8)');
    expect(fuelEditor).toContain('Redaguoti kuro pylimą');
    expect(fuelEditor).toContain('Ištrinti kuro pylimą');
  });
});
