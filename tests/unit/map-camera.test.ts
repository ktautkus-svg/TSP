import { describe, expect, it } from 'vitest';

import { mapGeometrySignature, shouldRefitMap } from '../../src/application/routes/map-camera';

describe('route map camera', () => {
  it('fits on first open and again when geometry changes before the user moves the map', () => {
    expect(shouldRefitMap({ previousSignature: null, nextSignature: 'a', userAdjusted: false, explicit: false })).toBe(true);
    expect(shouldRefitMap({ previousSignature: 'a', nextSignature: 'a', userAdjusted: false, explicit: false })).toBe(false);
    expect(shouldRefitMap({ previousSignature: 'a', nextSignature: 'b', userAdjusted: false, explicit: false })).toBe(true);
  });

  it('keeps a user zoom across sync updates and refits only from the button or a new variant before interaction', () => {
    expect(shouldRefitMap({ previousSignature: 'a', nextSignature: 'a', userAdjusted: true, explicit: false })).toBe(false);
    expect(shouldRefitMap({ previousSignature: 'a', nextSignature: 'b', userAdjusted: true, explicit: false })).toBe(false);
    expect(shouldRefitMap({ previousSignature: 'a', nextSignature: 'b', userAdjusted: true, explicit: true })).toBe(true);
  });

  it('builds a stable signature so a rerender does not look like a new route', () => {
    const points: [number, number][] = [[54.6872, 25.2797], [54.69, 25.28]];
    expect(mapGeometrySignature(points)).toBe(mapGeometrySignature([...points]));
  });
});
