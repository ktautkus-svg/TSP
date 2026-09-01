import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('FiRo visual identity across employee modules', () => {
  it('uses one shared transparent wordmark and branded stack header', () => {
    const brand = readFileSync(resolve(root, 'src/components/firo-brand.tsx'), 'utf8');
    const layout = readFileSync(resolve(root, 'src/app/_layout.tsx'), 'utf8');
    const header = readFileSync(resolve(root, 'src/components/brand-header.tsx'), 'utf8');

    expect(brand).toContain('firo-wordmark-color.png');
    expect(brand).toContain('BADGE_ASPECT');
    expect(brand).toMatch(/720\s*\/\s*454/);
    expect(layout).toContain('<StackBrandTitle title={children} />');
    expect(layout).toContain('headerStyle: { backgroundColor: colors.surface }');
    expect(header).toContain('<FiroBrand compact />');
  });

  it('keeps the approved wide FR badge source in the brand pipeline', () => {
    const generatePy = readFileSync(resolve(root, 'scripts/generate-firo-assets.py'), 'utf8');
    const generatePs1 = readFileSync(resolve(root, 'scripts/generate-firo-assets.ps1'), 'utf8');
    expect(generatePy).toContain('firo-approved-source.png');
    expect(generatePs1).toContain('firo-logo-wide-c.png');
    expect(readdirSync(resolve(root, 'assets/brand'))).toEqual(expect.arrayContaining([
      'firo-wordmark-color.png',
      'firo-wordmark-inverse.png',
      'firo-approved-source.png',
      'firo-mark-color.png',
    ]));
    expect(readdirSync(resolve(root, 'assets/brand/legacy'))).toEqual(expect.arrayContaining([
      'firo-approved-source-spiral.jpg',
      'firo-wordmark-color-spiral.png',
    ]));
  });

  it('does not leave the retired green shell or old logo references in any app screen', () => {
    const retired = ['#0A5A31', '#07351E', '#0E766E', 'tsp-logo-mark.png', 'TSP Logistics', '<TspBrand'];
    const sources = filesBelow(resolve(root, 'src/app')).map((path) => readFileSync(path, 'utf8'));
    for (const value of retired) expect(sources.some((source) => source.includes(value)), value).toBe(false);
  });

  it('keeps light mode as the default while retaining explicit dark mode support', () => {
    const preference = readFileSync(resolve(root, 'src/application/settings/theme-preference.ts'), 'utf8');
    const theme = readFileSync(resolve(root, 'src/ui/theme.tsx'), 'utf8');
    expect(preference).toContain("return 'light'");
    expect(theme).toContain("useState<ThemeMode>('light')");
    expect(theme).toContain("scheme === 'dark' ? darkColors : lightColors");
  });
});
