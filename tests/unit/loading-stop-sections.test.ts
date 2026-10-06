import { describe, expect, it } from 'vitest';

import { partitionLoadingStops } from '../../src/application/routes/loading-stop-sections';

describe('loading stop sections', () => {
  it('keeps unprocessed deliveries active and makes loaded or not-loaded stops recoverable separately', () => {
    const stops = [
      { id: 'pending', loadingStatus: 'pending' as const, deliveryStatus: 'pending' as const },
      { id: 'loaded', loadingStatus: 'loaded' as const, deliveryStatus: 'pending' as const },
      { id: 'not-loaded', loadingStatus: 'pending' as const, deliveryStatus: 'failed' as const },
    ];

    const sections = partitionLoadingStops(stops);

    expect(sections.active.map((stop) => stop.id)).toEqual(['pending']);
    expect(sections.processed.map((stop) => stop.id)).toEqual(['loaded', 'not-loaded']);
  });
});
