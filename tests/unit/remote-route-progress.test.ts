import { describe, expect, it } from 'vitest';

import { remoteProgressMissingLocally } from '../../src/application/sync/remote-route-progress';

describe('iPad route progress sync', () => {
  it('adopts the phone odometer when the iPad row is newer but still empty', () => {
    expect(remoteProgressMissingLocally(
      { start_odometer: null, end_odometer: null, status: 'loading' },
      { start_odometer: 184320, status: 'loaded' },
    )).toBe(true);
  });

  it('does not replace an odometer the iPad already has', () => {
    expect(remoteProgressMissingLocally(
      { start_odometer: 184320, end_odometer: null, status: 'loaded' },
      { start_odometer: 184320, status: 'loaded' },
    )).toBe(false);
  });

  it('does not treat a completed cloud copy as the missing iPad odometer', () => {
    expect(remoteProgressMissingLocally(
      { start_odometer: null, end_odometer: null, status: 'in_progress' },
      { start_odometer: 184320, end_odometer: 184400, status: 'completed' },
    )).toBe(false);
  });
});
