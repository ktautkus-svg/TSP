import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { calculateTripFuelEnd } from '../../src/application/trip-sheet/fuel-balance';

const source = readFileSync(resolve(import.meta.dirname, '../../src/app/trip-sheet.tsx'), 'utf8');

describe('trip sheet fuel workflow', () => {
  it('calculates the remaining fuel from start, real refills and normative consumption', () => {
    expect(calculateTripFuelEnd(90, 45, 68.7)).toBeCloseTo(66.3);
    expect(calculateTripFuelEnd(null, 45, 68.7)).toBeNull();
    expect(calculateTripFuelEnd(10, 0, 20)).toBe(0);
  });

  it('starts with a compact fuel summary and exposes refill entry inside details', () => {
    for (const label of ['PASKUTINIS ODOMETRAS', 'KURO LIKUTIS PRADŽIOJE', 'ĮPILTA', 'SUNAUDOTA PAGAL NORMĄ', 'DABARTINIS LIKUTIS']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('Atidaryti kelionės lapą · ${group.rows.length} d.');
    expect(source).toContain('+ Įvesti kurą');
    expect(source).toContain('+ Kuro papildymas');
    expect(source).toContain('fuel-entry-form-');
    expect(source).toContain('/fuel-entries');
    // A standalone odometer entry was reintroduced for vehicle+day combinations
    // with no route at all (canEnterTripReadings-gated) — it must keep the
    // trip-sheet-odometer-entry testID so the print stylesheet (+html.tsx)
    // hides it from the printed/PDF output.
    expect(source).toContain('trip-sheet-odometer-entry');
    expect(source).toContain('/api/trip-sheets/day-readings');
    expect(source).not.toContain('ATLYGIS');
    expect(source).toContain('Kasos čekio Nr.');
    expect(source).toContain('Privalomi laukai: litrai ir data');
    expect(source).toContain('NUVAŽIUOTA');
    expect(source).toContain('Eksportuoti Excel');
    expect(source).not.toContain('Sustojimo trukmė');
    expect(source).not.toContain('Stovėjimo laikas');
    expect(source).not.toContain('Kaina už litrą');
    expect(source).not.toContain('Degalinė');
    expect(source).toContain("timeZone: 'Europe/Vilnius'");
  });
});
