import { describe, expect, it } from 'vitest';

import {
  filterLearnedCoordinates,
  learnedCoordinateCsv,
  shouldKeepLearnedPin,
  toLearnedCoordinateRow,
} from '../../src/domain/learned-coordinate-audit';

describe('learned coordinate audit', () => {
  const row = toLearnedCoordinateRow({
    address: 'Varnių g. 10A, Šilalė',
    normalizedAddress: 'varniu g 10a silale',
    recipient: 'UAB Lambda',
    routeNumber: 'R09',
    geocodeLatitude: 55.49,
    geocodeLongitude: 22.18,
    learnedLatitude: 55.4902,
    learnedLongitude: 22.1804,
    sampleCount: 3,
    lastSampledAt: '2026-10-08T10:00:00.000Z',
    accuracyM: 12,
    driverName: 'Karolis',
    status: 'used',
  });

  it('exports every audit field and can filter by address and status', () => {
    const csv = learnedCoordinateCsv([row]);
    expect(csv).toContain('originalus_adresas');
    expect(csv).toContain('Varnių g. 10A, Šilalė');
    expect(csv).toContain('used');
    expect(csv).toContain('Karolis');
    expect(row.differenceM).not.toBeNull();
    expect(filterLearnedCoordinates([row], { address: 'šilalė', status: 'used' })).toHaveLength(1);
    expect(filterLearnedCoordinates([row], { status: 'rejected' })).toHaveLength(0);
  });

  it('does not let an older device overwrite a newer learned pin', () => {
    expect(shouldKeepLearnedPin('2026-10-08T10:00:00.000Z', '2026-10-07T10:00:00.000Z')).toBe(true);
    expect(shouldKeepLearnedPin('2026-10-07T10:00:00.000Z', '2026-10-08T10:00:00.000Z')).toBe(false);
  });
});
