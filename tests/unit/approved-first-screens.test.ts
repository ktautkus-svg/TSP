import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('approved first screens', () => {
  it('uses the approved navy-burgundy transparent FiRo asset on login and driver chrome', () => {
    const brand = source('src/components/firo-brand.tsx');
    const gate = source('src/components/local-access-gate.tsx');
    expect(brand).toContain('firo-wordmark-color.png');
    expect(brand).toContain('firo-wordmark-inverse.png');
    expect(brand).toContain("resizeMode={compact ? 'stretch' : 'contain'}");
    expect(brand).toContain('COMPACT_WIDTH_SCALE');
    expect(brand).toContain('BADGE_ASPECT');
    // Login must use the shared inverse wide badge — never a separate spiral asset.
    expect(gate).toContain('<FiroBrand hero inverse />');
    expect(gate).not.toContain('firo-wordmark-color-spiral');
    expect(gate).not.toContain('tsp-logo');
    // No Fibonacci / "FIBONACCI + ROAD" tagline anywhere in the UI.
    expect(gate).not.toMatch(/fibonacci/i);
    expect(gate).toContain('FiRo · maršrutų planavimas ir pristatymai');
    expect(source('src/components/brand-header.tsx')).toContain("variant?: 'default' | 'driver'");
  });

  it('keeps the approved bright driver palette local to the Dabar screen', () => {
    const theme = source('src/theme.ts');
    const dashboard = source('src/components/driver-now-dashboard.tsx');
    expect(theme).toContain("routeBlue: '#155EEF'");
    expect(theme).toContain("progress: '#00C853'");
    const copy = source('src/data/driver-ui.ts');
    expect(copy).toContain('LIKO SVORIO');
    expect(copy).toContain('Artimiausi sustojimai');
    expect(copy).toContain('TĘSTI MARŠRUTĄ');
    expect(dashboard).toContain('<RouteMapView compact');
  });
});
