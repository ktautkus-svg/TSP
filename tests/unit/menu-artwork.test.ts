import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../../src/components/menu-artwork.tsx'), 'utf8');

describe('menu artwork semantics', () => {
  it('uses a distinct visual object for every secondary menu action', () => {
    const expected = ['edit', 'drivers', 'vehicles', 'finance', 'history', 'statistics', 'navigation', 'account', 'clients', 'logout'];
    for (const kind of expected) expect(source).toContain(`${kind}:`);
    expect(source).not.toContain("drivers: 'quality'");
    expect(source).not.toContain("clients: 'quality'");
    expect(source).not.toContain("vehicles: 'dispatch'");
    expect(source).not.toContain("finance: 'settings'");
    expect(source).not.toContain("navigation: 'execute'");
  });
});
