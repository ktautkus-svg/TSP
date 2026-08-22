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
    expect(source).toContain('+ Įvesti kuro papildymą');
    expect(source).toContain('fuel-entry-form-');
    expect(source).toContain('/fuel-entries');
    expect(source).toContain('Kasos čekio Nr.');
    expect(source).toContain('Eksportuoti Excel');
    expect(source).not.toContain('Sustojimo trukmė');
    expect(source).not.toContain('Stovėjimo laikas');
  });
});
