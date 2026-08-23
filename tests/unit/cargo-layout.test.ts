import { describe, expect, it } from 'vitest';

import {
  ASSUMED_VAN_PROFILE,
  BOX_8_PALLET_PROFILE,
  EURO_PALLET_LONG_MM,
  EURO_PALLET_SHORT_MM,
  SAVANA_LONG_PROFILE,
  SAVANA_SHORT_PROFILE,
  buildBands,
  buildSlots,
  derivePalletCount,
  packBand,
  planCargoLayout,
  type CargoItemInput,
  type CargoVehicleProfile,
} from '../../src/domain/cargo-layout';

function item(deliveryOrder: number, weightKg: number | null, palletCount?: number): CargoItemInput {
  return { id: `i${deliveryOrder}`, deliveryOrder, weightKg, label: `Taškas ${deliveryOrder}`, palletCount };
}

describe('padėklų geometrija', () => {
  it('būda 4100 x 2100 talpina 8 europadėklus mišria orientacija', () => {
    const slots = buildSlots(BOX_8_PALLET_PROFILE);
    expect(slots).toHaveLength(8);
    expect(slots.filter((slot) => slot.orientation === 'crosswise')).toHaveLength(5);
    expect(slots.filter((slot) => slot.orientation === 'lengthwise')).toHaveLength(3);
  });

  it('nė vienas padėklas neišlenda už kėbulo ir nesusikerta su kitu', () => {
    for (const profile of [BOX_8_PALLET_PROFILE, ASSUMED_VAN_PROFILE, SAVANA_LONG_PROFILE]) {
      const slots = buildSlots(profile);
      for (const slot of slots) {
        expect(slot.xMm).toBeGreaterThanOrEqual(0);
        expect(slot.yMm).toBeGreaterThanOrEqual(0);
        expect(slot.xMm + slot.widthMm).toBeLessThanOrEqual(profile.widthMm + 0.001);
        expect(slot.yMm + slot.depthMm).toBeLessThanOrEqual(profile.lengthMm + 0.001);
      }
      for (const a of slots) {
        for (const b of slots) {
          if (a === b) continue;
          const apart = a.xMm + a.widthMm <= b.xMm + 0.001 || b.xMm + b.widthMm <= a.xMm + 0.001
            || a.yMm + a.depthMm <= b.yMm + 0.001 || b.yMm + b.depthMm <= a.yMm + 0.001;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('kiekvienas padėklas yra 1200 x 800, tik pasuktas', () => {
    for (const slot of buildSlots(BOX_8_PALLET_PROFILE)) {
      const sides = [slot.widthMm, slot.depthMm].sort((left, right) => left - right);
      expect(sides).toEqual([EURO_PALLET_SHORT_MM, EURO_PALLET_LONG_MM]);
    }
  });

  it('numeruoja nuo kabinos: 1 kraunamas pirmas, pristatomas paskutinis', () => {
    const slots = buildSlots(BOX_8_PALLET_PROFILE);
    expect(slots[0]!.index).toBe(1);
    expect(slots[0]!.yMm).toBeLessThanOrEqual(slots[slots.length - 1]!.yMm);
  });

  it('ratų arkos susiaurina ruožą ir padėklai centruojami', () => {
    const bands = buildBands(ASSUMED_VAN_PROFILE);
    const arched = bands.find((band) => band.hasWheelArch)!;
    expect(arched.usableWidthMm).toBe(2_100 - 250 * 2);
    expect(arched.usableStartXMm).toBe(250);

    const archSlots = buildSlots(ASSUMED_VAN_PROFILE).filter((slot) => slot.inWheelArchBand);
    for (const slot of archSlots) {
      expect(slot.xMm).toBeGreaterThanOrEqual(250);
      expect(slot.xMm + slot.widthMm).toBeLessThanOrEqual(2_100 - 250);
    }
  });

  it('būdai arkų nėra — vienas ruožas per visą ilgį', () => {
    const bands = buildBands(BOX_8_PALLET_PROFILE);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.hasWheelArch).toBe(false);
    expect(bands[0]!.usableWidthMm).toBe(BOX_8_PALLET_PROFILE.widthMm);
  });

  it('per siauras kėbulas neduoda dviejų padėklų greta', () => {
    // Savana: 1598 mm — dviem 800 mm padėklams trūksta 2 mm.
    const slots = buildSlots(SAVANA_SHORT_PROFILE);
    const rows = new Map<number, number>();
    for (const slot of slots) rows.set(slot.yMm, (rows.get(slot.yMm) ?? 0) + 1);
    expect([...rows.values()].every((count) => count === 1)).toBe(true);
  });

  it('visai per mažas kėbulas negrąžina nė vienos vietos', () => {
    const tiny: CargoVehicleProfile = { lengthMm: 700, widthMm: 700, bodyType: 'box' };
    expect(buildSlots(tiny)).toHaveLength(0);
    expect(packBand(buildBands(tiny)[0]!)).toHaveLength(0);
  });
});

describe('padėklų kiekis pagal svorį', () => {
  it('naudoja nurodytą kiekį, kai jis žinomas', () => {
    expect(derivePalletCount(item(1, 900, 2), 300)).toEqual({ count: 2, estimated: false });
  });

  it('išveda iš svorio ir pažymi kaip įvertį', () => {
    expect(derivePalletCount(item(1, 900), 300)).toEqual({ count: 3, estimated: true });
    expect(derivePalletCount(item(1, 100), 300)).toEqual({ count: 1, estimated: true });
  });

  it('be svorio laiko vienu padėklu ir pažymi', () => {
    expect(derivePalletCount(item(1, null), 300)).toEqual({ count: 1, estimated: true });
  });

  it('vidutinis padėklo svoris ateina iš automobilio: galia / vietų skaičius', () => {
    const layout = planCargoLayout(BOX_8_PALLET_PROFILE, [item(1, 100)]);
    // 1500 kg / 8 vietų
    expect(layout.averagePalletWeightKg).toBeCloseTo(187.5, 5);
  });
});

describe('krovinio išdėstymas', () => {
  it('pirmas pristatymas atsiduria arčiausiai durų', () => {
    const layout = planCargoLayout(BOX_8_PALLET_PROFILE, [item(1, 100, 1), item(2, 100, 1), item(3, 100, 1)]);
    const first = layout.placed.find((pallet) => pallet.deliveryOrder === 1)!;
    const last = layout.placed.find((pallet) => pallet.deliveryOrder === 3)!;
    expect(first.slot.yMm).toBeGreaterThan(last.slot.yMm);
  });

  it('vienas pristatymas gali užimti kelias vietas', () => {
    const layout = planCargoLayout(BOX_8_PALLET_PROFILE, [item(1, 600, 3)]);
    expect(layout.placed).toHaveLength(3);
    expect(layout.placed.every((pallet) => pallet.palletsForItem === 3)).toBe(true);
    expect(layout.placed.map((pallet) => pallet.weightKg)).toEqual([200, 200, 200]);
  });

  it('netelpantys padėklai atskiriami ir apie juos pranešama', () => {
    const items = Array.from({ length: 10 }, (_, index) => item(index + 1, 100, 1));
    const layout = planCargoLayout(BOX_8_PALLET_PROFILE, items);
    expect(layout.placed).toHaveLength(8);
    expect(layout.unplaced).toHaveLength(2);
    expect(layout.warnings.some((warning) => warning.code === 'PALLETS_DO_NOT_FIT')).toBe(true);
    expect(layout.usedSlotPercent).toBe(100);
  });

  it('praneša apie viršytą keliamąją galią', () => {
    const layout = planCargoLayout(BOX_8_PALLET_PROFILE, [item(1, 2_000, 1)]);
    const overload = layout.warnings.find((warning) => warning.code === 'PAYLOAD_EXCEEDED');
    expect(overload?.severity).toBe('critical');
  });

  it('pažymi, kai naudojami tipiniai, o ne tikri matmenys', () => {
    const layout = planCargoLayout(ASSUMED_VAN_PROFILE, [item(1, 100, 1)], { assumedVehicle: true });
    expect(layout.warnings.some((warning) => warning.code === 'ASSUMED_VEHICLE')).toBe(true);
  });

  it('tvarkingas krovinys su nurodytais kiekiais neduoda įspėjimų', () => {
    const layout = planCargoLayout(BOX_8_PALLET_PROFILE, [item(1, 100, 1), item(2, 100, 1)]);
    expect(layout.warnings).toEqual([]);
  });
});
