import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  PALLET_WEIGHT_KG,
  recommendLoadingSchema,
  toLoadingSchemaStops,
} from '../../src/domain/loading-schema';

function stop(input: {
  id: string;
  loadingSequence: number;
  deliveryOrder: number;
  weightKg: number | null;
  skipped?: boolean;
}) {
  return {
    recipient: `Gavėjas ${input.deliveryOrder}`,
    address: `Tilžės g. ${input.deliveryOrder}, Šiauliai`,
    ...input,
  };
}

describe('van loading schema', () => {
  it('puts the first loaded stops into the two vertical cabin bays', () => {
    const schema = recommendLoadingSchema([
      stop({ id: 'a', loadingSequence: 1, deliveryOrder: 3, weightKg: 40 }),
      stop({ id: 'b', loadingSequence: 2, deliveryOrder: 2, weightKg: 20 }),
      stop({ id: 'c', loadingSequence: 3, deliveryOrder: 1, weightKg: 10 }),
    ]);
    expect(schema.placements.map((item) => `${item.stopId}:${item.bayId}`)).toEqual([
      'a:front_left',
      'b:front_right',
      'c:row_1',
    ]);
    expect(schema.palletCount).toBe(0);
  });

  it('fills five long-van floor slots cabin to doors, then stacks extras at the door', () => {
    const stops = Array.from({ length: 7 }, (_, index) => stop({
      id: `s${index + 1}`,
      loadingSequence: index + 1,
      deliveryOrder: 7 - index,
      weightKg: 10 + index,
    }));
    const schema = recommendLoadingSchema(stops, 'van_long');
    expect(schema.bays.map((bay) => bay.id)).toEqual([
      'front_left', 'front_right', 'row_1', 'row_2', 'row_3',
    ]);
    expect(schema.placements.find((item) => item.stopId === 's1')?.bayId).toBe('front_left');
    expect(schema.placements.find((item) => item.stopId === 's5')?.bayId).toBe('row_3');
    expect(schema.placements.find((item) => item.stopId === 's6')?.bayId).toBe('row_3');
    expect(schema.placements.find((item) => item.stopId === 's7')?.bayId).toBe('row_2');
  });

  it('uses the shorter van floor of two vertical plus two horizontal bays', () => {
    const schema = recommendLoadingSchema([
      stop({ id: 'a', loadingSequence: 1, deliveryOrder: 4, weightKg: 10 }),
      stop({ id: 'b', loadingSequence: 2, deliveryOrder: 3, weightKg: 10 }),
      stop({ id: 'c', loadingSequence: 3, deliveryOrder: 2, weightKg: 10 }),
      stop({ id: 'd', loadingSequence: 4, deliveryOrder: 1, weightKg: 10 }),
    ], 'van_short');
    expect(schema.bays.map((bay) => bay.id)).toEqual([
      'front_left', 'front_right', 'row_1', 'row_2',
    ]);
    expect(schema.placements.find((item) => item.stopId === 'd')?.bayId).toBe('row_2');
  });

  it('recommends a pallet only for heavy cargo and keeps it on the floor of its bay', () => {
    const stops = [
      stop({ id: 's1', loadingSequence: 1, deliveryOrder: 6, weightKg: 12 }),
      stop({ id: 's2', loadingSequence: 2, deliveryOrder: 5, weightKg: 12 }),
      stop({ id: 's3', loadingSequence: 3, deliveryOrder: 4, weightKg: 12 }),
      stop({ id: 's4', loadingSequence: 4, deliveryOrder: 3, weightKg: 12 }),
      stop({ id: 's5', loadingSequence: 5, deliveryOrder: 2, weightKg: 12 }),
      stop({ id: 'heavy', loadingSequence: 6, deliveryOrder: 1, weightKg: PALLET_WEIGHT_KG }),
    ];
    const schema = recommendLoadingSchema(stops, 'van_long');
    const door = schema.bays.find((bay) => bay.id === 'row_3');
    expect(door?.placements.map((item) => item.stopId)).toEqual(['heavy', 's5']);
    expect(door?.placements[0]?.usePallet).toBe(true);
    expect(door?.placements[0]?.stackLabel).toBe('apačia');
    expect(door?.placements[1]?.usePallet).toBe(false);
    expect(schema.palletCount).toBe(1);
  });

  it('skips not-loaded stops and treats unknown weight as no pallet', () => {
    const schema = recommendLoadingSchema([
      stop({ id: 'skip', loadingSequence: 1, deliveryOrder: 2, weightKg: 400, skipped: true }),
      stop({ id: 'unknown', loadingSequence: 2, deliveryOrder: 1, weightKg: null }),
    ]);
    expect(schema.placements.map((item) => item.stopId)).toEqual(['unknown']);
    expect(schema.placements[0]?.usePallet).toBe(false);
    expect(schema.placements[0]?.bayId).toBe('front_left');
  });

  it('derives loading sequence from reverse delivery order', () => {
    const stops = toLoadingSchemaStops([
      {
        id: 'first-delivery', activeOrder: 1, optimizedOrder: 1, originalOrder: 1,
        weightKg: 8, recipient: 'A', address: 'A', loadingStatus: 'pending', deliveryStatus: 'pending',
      },
      {
        id: 'last-delivery', activeOrder: 2, optimizedOrder: 2, originalOrder: 2,
        weightKg: 40, recipient: 'B', address: 'B', loadingStatus: 'pending', deliveryStatus: 'pending',
      },
    ]);
    expect(stops.map((item) => item.id)).toEqual(['last-delivery', 'first-delivery']);
    expect(stops[0]?.loadingSequence).toBe(1);
  });
});

describe('loading schema UI wiring', () => {
  it('shows the van diagram on the loading screen', () => {
    const loading = readFileSync('src/app/route/[id]/loading.tsx', 'utf8');
    const card = readFileSync('src/components/loading-schema-card.tsx', 'utf8');
    expect(loading).toContain('<LoadingSchemaCard');
    expect(card).toContain('testID="loading-schema-card"');
    expect(card).toContain('testID={`van-body-${kind}`}');
  });
});
