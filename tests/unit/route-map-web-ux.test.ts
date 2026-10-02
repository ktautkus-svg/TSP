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

  it('remounts numbered pins when stop order changes', () => {
    expect(source).toContain('key={`${index}-${stop.id}`}');
    expect(source).toContain('key={orderedStops.map((stop) => stop.id).join(\'|\')}');
  });

  // CARTO now watermarks keyless tiles. Default to the documented OSM endpoint,
  // keep a normal Referer and allow a self-hosted compatible URL via config.
  it('loads a configurable, correctly identified OSM basemap without the CARTO watermark', () => {
    expect(source).toContain('process.env.EXPO_PUBLIC_OSM_TILE_URL?.trim()');
    expect(source).toContain("'https://tile.openstreetmap.org/{z}/{x}/{y}.png'");
    expect(source).toContain('url={MAP_TILE_URL}');
    expect(source).toContain('MAP_TILE_ATTRIBUTION');
    expect(source).toContain('OpenStreetMap contributors');
    expect(source).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(source).not.toMatch(/basemaps\.cartocdn\.com/);
  });

  // Always-visible map must not claim the driving line is missing before the driver requests it.
  it('gates the idle polyline pending hint behind expectPolyline', () => {
    expect(source).toContain('expectPolyline = true');
    expect(source).toContain('expectPolyline && !encodedPolyline && !allowStraightLineFallback');
  });
});
