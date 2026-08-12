import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('approved first screens', () => {
  it('uses the approved red-blue transparent TSP asset on login and driver chrome', () => {
    const brand = source('src/components/tsp-brand.tsx');
    expect(brand).toContain('tsp-wordmark-red-blue.png');
    expect(brand).toContain('resizeMode="contain"');
    expect(source('src/components/local-access-gate.tsx')).toContain('PRISIJUNGTI →');
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
