import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  PALLET_WEIGHT_KG,
  cargoLayoutFromAssignedVehicle,
  recommendLoadingSchema,
  toLoadingSchemaStops,
  vehicleCargoSummary,
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
      'a:row_1',
      'b:row_2',
      'c:row_3',
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
    expect(schema.placements.find((item) => item.stopId === 's7')?.bayId).toBe('row_3');
    const rear = schema.bays.find((bay) => bay.id === 'row_3');
    expect(rear?.placements[rear.placements.length - 1]?.stopId).toBe('s7');
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
    expect(door?.placements.map((item) => item.stopId)).toEqual(['s5', 'heavy']);
    expect(door?.placements[1]?.usePallet).toBe(true);
    expect(door?.placements[1]?.stackLabel).toBe('viršus');
    expect(schema.palletCount).toBe(1);
  });

  it('skips not-loaded stops and treats unknown weight as no pallet', () => {
    const schema = recommendLoadingSchema([
      stop({ id: 'skip', loadingSequence: 1, deliveryOrder: 2, weightKg: 400, skipped: true }),
      stop({ id: 'unknown', loadingSequence: 2, deliveryOrder: 1, weightKg: null }),
    ]);
    expect(schema.placements.map((item) => item.stopId)).toEqual(['unknown']);
    expect(schema.placements[0]?.usePallet).toBe(false);
    expect(schema.placements[0]?.bayId).toBe('row_3');
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

  it('keeps the first delivery at the rear doors when there is no side door', () => {
    const stops = Array.from({ length: 7 }, (_, index) => stop({
      id: `d${index + 1}`,
      loadingSequence: index + 1,
      deliveryOrder: 7 - index,
      weightKg: index === 2 ? PALLET_WEIGHT_KG : 20,
    }));
    const schema = recommendLoadingSchema(stops, { bodyKind: 'van_long', hasSideDoor: false });
    expect(schema.placements.find((item) => item.deliveryOrder === 1)?.bayId).toBe('row_3');
    expect(schema.placements.find((item) => item.stopId === 'd3')?.sideAccess).toBe(false);
    expect(schema.placements.find((item) => item.stopId === 'd3')?.bayId).not.toBe('row_2');
  });

  it('loads a heavy mid-route stop at the side door without burying the first drop', () => {
    const stops = Array.from({ length: 7 }, (_, index) => stop({
      id: `d${index + 1}`,
      loadingSequence: index + 1,
      deliveryOrder: 7 - index,
      weightKg: 7 - index === 5 ? 240 : 18,
    }));
    const schema = recommendLoadingSchema(stops, { bodyKind: 'van_long', hasSideDoor: true });
    const fifth = schema.placements.find((item) => item.deliveryOrder === 5);
    const first = schema.placements.find((item) => item.deliveryOrder === 1);
    const last = schema.placements.find((item) => item.deliveryOrder === 7);
    expect(fifth?.bayId).toBe('row_2');
    expect(fifth?.sideAccess).toBe(true);
    expect(fifth?.usePallet).toBe(true);
    expect(first?.bayId).toBe('row_3');
    expect(first?.sideAccess).toBe(false);
    expect(last?.bayId).toBe('front_left');
    expect(schema.sideUnloadCount).toBe(1);
    expect(schema.placements.filter((item) => !item.sideAccess).map((item) => `${item.deliveryOrder}:${item.bayId}`)).toEqual([
      '7:front_left',
      '6:front_right',
      '4:row_1',
      '3:row_3',
      '2:row_3',
      '1:row_3',
    ]);
    const rear = schema.bays.find((bay) => bay.id === 'row_3');
    expect(rear?.placements.map((item) => item.deliveryOrder)).toEqual([3, 2, 1]);
  });

  it('uses the short-van side bay for a heavy mid-route stop', () => {
    const schema = recommendLoadingSchema([
      stop({ id: 'd4', loadingSequence: 1, deliveryOrder: 4, weightKg: 18 }),
      stop({ id: 'd3', loadingSequence: 2, deliveryOrder: 3, weightKg: 240 }),
      stop({ id: 'd2', loadingSequence: 3, deliveryOrder: 2, weightKg: 18 }),
      stop({ id: 'd1', loadingSequence: 4, deliveryOrder: 1, weightKg: 18 }),
    ], { bodyKind: 'van_short', hasSideDoor: true });
    expect(schema.placements.find((item) => item.stopId === 'd3')?.bayId).toBe('row_1');
    expect(schema.placements.find((item) => item.stopId === 'd3')?.sideAccess).toBe(true);
    expect(schema.placements.find((item) => item.stopId === 'd1')?.bayId).toBe('row_2');
    expect(schema.placements.find((item) => item.stopId === 'd4')?.bayId).toBe('front_left');
  });

  it('does not move the first stop to the side even when it is heavy', () => {
    const schema = recommendLoadingSchema([
      stop({ id: 'last', loadingSequence: 1, deliveryOrder: 3, weightKg: 20 }),
      stop({ id: 'mid', loadingSequence: 2, deliveryOrder: 2, weightKg: 20 }),
      stop({ id: 'first', loadingSequence: 3, deliveryOrder: 1, weightKg: 400 }),
    ], { bodyKind: 'van_long', hasSideDoor: true });
    expect(schema.placements.find((item) => item.stopId === 'first')?.bayId).toBe('row_3');
    expect(schema.placements.find((item) => item.stopId === 'first')?.sideAccess).toBe(false);
    expect(schema.sideUnloadCount).toBe(0);
  });

  it('takes side doors and pallet capacity from the assigned vehicle catalog', () => {
    const assigned = cargoLayoutFromAssignedVehicle({
      registrationNumber: 'LRI744',
      model: 'Renault Master',
      cargoBodyKind: 'van_long',
      hasSideDoor: false,
    });
    expect(assigned).toMatchObject({
      bodyKind: 'van_8pll',
      palletCapacity: 8,
      hasSideDoor: true,
      assigned: true,
      vehicleLabel: 'LRI744 · Renault Master',
    });
    expect(vehicleCargoSummary(assigned)).toContain('8 PLL');
    expect(vehicleCargoSummary(assigned)).toContain('šoninės durys yra');
    expect(cargoLayoutFromAssignedVehicle({
      registrationNumber: 'LRI741',
      model: 'Renault Master',
    })).toMatchObject({
      bodyKind: 'van_8pll',
      palletCapacity: 8,
      hasSideDoor: false,
    });
    expect(cargoLayoutFromAssignedVehicle({
      registrationNumber: 'MET628',
      model: 'Citroen Jumper',
    })).toMatchObject({
      bodyKind: 'van_long',
      palletCapacity: 5,
      hasSideDoor: true,
    });
    expect(cargoLayoutFromAssignedVehicle(null)).toMatchObject({
      bodyKind: 'van_long',
      palletCapacity: 5,
      hasSideDoor: false,
      assigned: false,
    });
  });

  it('still honours a short van on an unknown plate', () => {
    const assigned = cargoLayoutFromAssignedVehicle({
      registrationNumber: 'TST001',
      model: 'Test',
      cargoBodyKind: 'van_short',
      hasSideDoor: true,
    });
    expect(assigned).toMatchObject({
      bodyKind: 'van_short',
      hasSideDoor: true,
      assigned: true,
    });
    expect(vehicleCargoSummary(assigned)).toContain('4 PLL');
  });

  it('uses the eight-pallet floor with the first drop at the rear and a heavy mid-route stop at the side', () => {
    const stops = Array.from({ length: 8 }, (_, index) => stop({
      id: `d${index + 1}`,
      loadingSequence: index + 1,
      deliveryOrder: 8 - index,
      weightKg: 8 - index === 5 ? 240 : 18,
    }));
    const schema = recommendLoadingSchema(stops, { bodyKind: 'van_8pll', hasSideDoor: true });
    expect(schema.bays.map((bay) => bay.id)).toEqual([
      'front_left', 'front_right', 'row_1', 'row_2', 'row_3', 'row_4', 'row_5', 'row_6',
    ]);
    expect(schema.placements.find((item) => item.deliveryOrder === 1)?.bayId).toBe('row_6');
    expect(schema.placements.find((item) => item.deliveryOrder === 5)?.bayId).toBe('row_5');
    expect(schema.placements.find((item) => item.deliveryOrder === 5)?.sideAccess).toBe(true);
    expect(schema.placements.find((item) => item.deliveryOrder === 8)?.bayId).toBe('front_left');
    expect(schema.sideUnloadCount).toBe(1);
  });
});

describe('loading schema UI wiring', () => {
  it('shows the van diagram on the loading screen', () => {
    const loading = readFileSync('src/app/route/[id]/loading.tsx', 'utf8');
    const card = readFileSync('src/components/loading-schema-card.tsx', 'utf8');
    expect(loading).toContain('<LoadingSchemaCard');
    expect(loading).toContain('cargoLayoutFromAssignedVehicle(assignment?.vehicle ?? fuelStatus?.vehicle)');
    expect(card).toContain('testID="loading-schema-card"');
    expect(card).toContain('testID="loading-schema-vehicle"');
    expect(card).toContain('per šoną');
    expect(card).not.toContain('onSideDoorChange');
    expect(loading).toContain('{placement.sideAccess ? \' · per šoną\' : \'\'}');
  });

  it('keeps server-compiled loading schema free of unresolved path aliases', () => {
    const source = readFileSync('src/domain/loading-schema.ts', 'utf8');
    expect(source).toContain("from './fleet-cargo-specs'");
    expect(source).not.toContain("@/domain/fleet-cargo-specs");
  });
});
