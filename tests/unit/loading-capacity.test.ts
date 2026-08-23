import { describe, expect, it } from 'vitest';

import {
  MAX_BAY_WEIGHT_KG,
  MAX_ITEMS_PER_BAY,
  cargoLayoutFromAssignedVehicle,
  recommendLoadingSchema,
} from '../../src/domain/loading-schema';

function stop(loadingSequence: number, deliveryOrder: number, weightKg: number | null) {
  return {
    id: `s${loadingSequence}`,
    loadingSequence,
    deliveryOrder,
    weightKg,
    recipient: `Gavėjas ${deliveryOrder}`,
    address: `Tilžės g. ${deliveryOrder}, Šiauliai`,
  };
}

/** n taškų, atvirkštine pristatymo tvarka, po `weight` kg. */
function stops(count: number, weight: number | null = 50) {
  return Array.from({ length: count }, (_, index) => stop(index + 1, count - index, weight));
}

describe('krovinio paskirstymas, kai taškų daugiau nei zonų', () => {
  it('nebesuverčia perteklieaus į vieną zoną prie durų', () => {
    // Ilgas van: 5 zonos, 13 taškų. Anksčiau būdavo 1,1,1,1,9.
    const schema = recommendLoadingSchema(stops(13), { bodyKind: 'van_long' });
    const counts = schema.bays.map((bay) => bay.placements.length);

    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(13);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts).toEqual([2, 2, 3, 3, 3]);
  });

  it('išlaiko maršruto eilę: paskutinis pristatymas lieka prie kabinos', () => {
    const schema = recommendLoadingSchema(stops(13), { bodyKind: 'van_long' });
    const cabin = schema.bays[0]!;
    const doors = schema.bays[schema.bays.length - 1]!;
    const cabinOrders = cabin.placements.map((item) => item.deliveryOrder);
    const doorOrders = doors.placements.map((item) => item.deliveryOrder);

    // Prie durų — ankstyviausi pristatymai, prie kabinos — vėlyviausi.
    expect(Math.min(...cabinOrders)).toBeGreaterThan(Math.max(...doorOrders));
  });

  it('trumpame vane su 4 zonomis paskirsto taip pat tolygiai', () => {
    const schema = recommendLoadingSchema(stops(10), { bodyKind: 'van_short' });
    const counts = schema.bays.map((bay) => bay.placements.length);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});

describe('talpos įspėjimai', () => {
  it('perspėja, kai zonoje per daug vienetų', () => {
    // 5 zonos x (MAX+1) vienetų — kiekviena zona virš ribos.
    const schema = recommendLoadingSchema(stops(5 * (MAX_ITEMS_PER_BAY + 1)), { bodyKind: 'van_long' });
    const stacked = schema.warnings.filter((item) => item.code === 'BAY_STACK_EXCEEDED');
    expect(stacked).toHaveLength(5);
    expect(stacked[0]!.severity).toBe('warning');
    expect(stacked[0]!.bayId).toBeDefined();
  });

  it('perspėja, kai vienoje zonoje per didelis svoris', () => {
    const schema = recommendLoadingSchema(stops(5, MAX_BAY_WEIGHT_KG + 1), { bodyKind: 'van_long' });
    const heavy = schema.warnings.filter((item) => item.code === 'BAY_WEIGHT_EXCEEDED');
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy[0]!.message).toContain('kg vienoje vietoje');
  });

  it('praneša apie viršytą automobilio keliamąją galią', () => {
    const schema = recommendLoadingSchema(stops(5, 400), {
      bodyKind: 'van_long',
      maximumPayloadKg: 1_500,
    });
    const overload = schema.warnings.find((item) => item.code === 'VEHICLE_PAYLOAD_EXCEEDED');
    expect(schema.totalWeightKg).toBe(2_000);
    expect(overload).toBeDefined();
    expect(overload!.severity).toBe('critical');
  });

  it('netikrina keliamosios galios, kai ji nežinoma', () => {
    const schema = recommendLoadingSchema(stops(5, 400), { bodyKind: 'van_long' });
    expect(schema.warnings.some((item) => item.code === 'VEHICLE_PAYLOAD_EXCEEDED')).toBe(false);
  });

  it('pažymi nežinomus svorius, nes tada apkrova nepatikima', () => {
    const schema = recommendLoadingSchema(
      [stop(1, 2, null), stop(2, 1, 100)],
      { bodyKind: 'van_long', maximumPayloadKg: 1_000 },
    );
    const unknown = schema.warnings.find((item) => item.code === 'UNKNOWN_WEIGHTS');
    expect(schema.unknownWeightCount).toBe(1);
    expect(unknown).toBeDefined();
  });

  it('tvarkingas krovinys neduoda jokių įspėjimų', () => {
    const schema = recommendLoadingSchema(stops(4, 50), {
      bodyKind: 'van_long',
      maximumPayloadKg: 1_500,
    });
    expect(schema.warnings).toEqual([]);
  });

  it('keliamoji galia paimama iš priskirto automobilio', () => {
    const layout = cargoLayoutFromAssignedVehicle({
      registrationNumber: 'MET630',
      model: 'Sprinter',
      cargoBodyKind: 'van_long',
      hasSideDoor: true,
      maximumPayloadKg: 1_200,
    });
    expect(layout.maximumPayloadKg).toBe(1_200);
    expect(cargoLayoutFromAssignedVehicle(null).maximumPayloadKg).toBeNull();
  });
});
