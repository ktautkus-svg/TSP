import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/route-map.web.tsx', 'utf8');

describe('web route map page scrolling', () => {
  it('preserves the existing mouse-wheel map zoom', () => {
    expect(source).toMatch(/\n\s+scrollWheelZoom\s*\n/);
    expect(source).not.toContain('scrollWheelZoom={false}');
  });

  it('reduces only the desktop map height by roughly one centimetre', () => {
    expect(source).toContain('width >= 1024 ? 500');
    expect(source).toContain('width >= 720 ? 390 : 330');
    expect(source).toContain('minHeight: 330');
  });
});
