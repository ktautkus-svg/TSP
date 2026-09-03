import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../../src/components/menu-artwork.tsx'), 'utf8');

describe('menu artwork semantics', () => {
  it('uses a distinct visual object for every secondary menu action', () => {
    const expected = ['edit', 'vehicles', 'finance', 'history', 'statistics', 'navigation', 'account', 'clients', 'logout'];
    for (const kind of expected) expect(source).toContain(`${kind}:`);
    expect(source).toContain('tsp-menu-secondary-3d.png');
    expect(source).toContain("type DirectArtworkKind = 'service'");
    expect(source).toContain('tsp-menu-service-3d.png');
    expect(source).not.toContain('emojiArtwork');
    expect(source).not.toContain('<Text');
    expect(source).not.toContain("drivers: 'quality'");
    expect(source).not.toContain("clients: 'quality'");
    expect(source).not.toContain("vehicles: 'dispatch'");
    expect(source).not.toContain("finance: 'settings'");
    expect(source).not.toContain("navigation: 'execute'");
  });

  it('keeps Vairuotojai and drive-route actions on distinct SVG glyphs', () => {
    expect(source).toContain("drivers: 'employees'");
    expect(source).toContain("driveRoute: 'steering'");
    expect(source).toContain('EmployeesIcon');
    expect(source).toContain('SteeringWheelIcon');
    // Retired sprite cell that looked like eyes must not drive these actions.
    expect(source).not.toContain('drivers: { column: 1, row: 0 }');
  });
});
