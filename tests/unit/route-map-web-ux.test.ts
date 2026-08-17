import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/route-map.web.tsx', 'utf8');

describe('web route map page scrolling', () => {
  // Shortening the map was not enough: Leaflet's wheel handler calls
  // preventDefault on every wheel event, so a map anywhere in the middle of the
  // page still swallowed the scroll and the page looked frozen. The zoom is kept
  // rather than switched off - it is now gated on Ctrl/Cmd, so a plain wheel
  // scrolls the page and the modifier still zooms the map.
  it('keeps the mouse-wheel zoom, gated behind Ctrl/Cmd', () => {
    expect(source).toMatch(/\n\s+scrollWheelZoom\s*\n/);
    expect(source).not.toContain('scrollWheelZoom={false}');
    expect(source).toContain('WheelZoomGuard');
    expect(source).toContain('map.scrollWheelZoom.disable()');
    expect(source).toContain('event.ctrlKey || event.metaKey');
  });

  it('reduces only the desktop map height by roughly one centimetre', () => {
    expect(source).toContain('width >= 1024 ? 500');
    expect(source).toContain('width >= 720 ? 390 : 330');
    expect(source).toContain('minHeight: 330');
  });
});
