import { describe, expect, it } from 'vitest';

import { resolveCargoProfile, toCargoItems } from '../../src/application/loading/cargo-profile';
import { buildSlots } from '../../src/domain/cargo-layout';
import type { ServerFleetVehicleSnapshot } from '../../src/infrastructure/auth/employee-session';

function vehicle(extra: Partial<ServerFleetVehicleSnapshot> = {}): ServerFleetVehicleSnapshot {
  return {
    id: 'MET630', registrationNumber: 'MET630', model: 'Sprinter', maximumPayloadKg: 1_500, ...extra,
  } as ServerFleetVehicleSnapshot;
}

describe('kėbulo profilio parinkimas', () => {
  it('be matmenų grąžina spėjimą, kad liktų senoji schema', () => {
    expect(resolveCargoProfile(null).assumed).toBe(true);
    expect(resolveCargoProfile(vehicle()).assumed).toBe(true);
    expect(resolveCargoProfile(vehicle({ cargoLengthMm: 4_100 })).assumed).toBe(true);
    expect(resolveCargoProfile(vehicle({ cargoWidthMm: 2_100 })).assumed).toBe(true);
  });

  it('su ilgiu ir pločiu naudoja tikrus matmenis', () => {
    const resolved = resolveCargoProfile(vehicle({
      cargoLengthMm: 4_100, cargoWidthMm: 2_100, cargoBodyType: 'box',
    }));
    expect(resolved.assumed).toBe(false);
    expect(resolved.profile.lengthMm).toBe(4_100);
    expect(resolved.profile.bodyType).toBe('box');
    expect(resolved.profile.maximumPayloadKg).toBe(1_500);
    // Tikra būda -> 8 padėklai.
    expect(buildSlots(resolved.profile)).toHaveLength(8);
  });

  it('būdai ratų arkos ignoruojamos, net jei suvestos', () => {
    const resolved = resolveCargoProfile(vehicle({
      cargoLengthMm: 4_100, cargoWidthMm: 2_100, cargoBodyType: 'box',
      wheelArchStartMm: 2_000, wheelArchEndMm: 3_000, wheelArchIntrusionMm: 200,
    }));
    expect(resolved.profile.wheelArch).toBeNull();
  });

  it('furgonui arkos taikomos tik kai nurodyti visi trys skaičiai', () => {
    const partial = resolveCargoProfile(vehicle({
      cargoLengthMm: 4_000, cargoWidthMm: 2_100, cargoBodyType: 'van', wheelArchStartMm: 2_400,
    }));
    expect(partial.profile.wheelArch).toBeNull();

    const full = resolveCargoProfile(vehicle({
      cargoLengthMm: 4_000, cargoWidthMm: 2_100, cargoBodyType: 'van',
      wheelArchStartMm: 2_400, wheelArchEndMm: 3_700, wheelArchIntrusionMm: 250,
    }));
    expect(full.profile.wheelArch).toEqual({ startMm: 2_400, endMm: 3_700, intrusionMm: 250 });
  });
});

describe('taškų vertimas kroviniais', () => {
  const stop = (id: string, order: number, weightKg: number | null, over: Record<string, unknown> = {}) => ({
    id, activeOrder: order, optimizedOrder: null, originalOrder: order, weightKg,
    recipient: `Gavėjas ${order}`, loadingStatus: 'pending' as const, deliveryStatus: 'pending' as const, ...over,
  });

  it('ima aktyvią tvarką, kad rankinis perrikiavimas veiktų', () => {
    const items = toCargoItems([{ ...stop('a', 5, 100), activeOrder: 2 }]);
    expect(items[0]!.deliveryOrder).toBe(2);
  });

  it('praleidžia nepakrautus nepavykusius taškus', () => {
    const items = toCargoItems([
      stop('a', 1, 100),
      stop('b', 2, 100, { deliveryStatus: 'failed' }),
    ]);
    expect(items.map((item) => item.id)).toEqual(['a']);
  });
});
