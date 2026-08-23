/**
 * Where each pallet physically sits on the van floor.
 *
 * Positions are never hardcoded. The floor is cut into bands along its length,
 * each band is measured, and the orientation that fits more pallets wins. The
 * classic 5-pallet Renault Master layout falls out of that rule rather than
 * being written down:
 *
 *   4000 x 2100 van, wheel arches from 2400 mm
 *     band 0-2400,    full 2100 mm   -> crosswise,  1 x 3 = 3 pallets
 *     band 2400-3700, 1600 mm usable -> lengthwise, 2 x 1 = 2 pallets
 *     band 3700-4000, 300 mm         -> nothing fits
 *
 * Coordinates are millimetres: x across the width (0 = left wall), y along the
 * length (0 = cabin, L = rear doors).
 */

export const EURO_PALLET_LONG_MM = 1_200;
export const EURO_PALLET_SHORT_MM = 800;

export type CargoBodyType = 'van' | 'box';

/**
 * Wheel arches, which is what can force pallets to turn lengthwise at the rear.
 * `intrusionMm` is per side.
 */
export type WheelArchProfile = {
  startMm: number;
  endMm: number;
  intrusionMm: number;
};

export type CargoVehicleProfile = {
  lengthMm: number;
  widthMm: number;
  bodyType: CargoBodyType;
  /** Ignored for a box body, whose floor is flat end to end. */
  wheelArch?: WheelArchProfile | null;
  maximumPayloadKg?: number | null;
};

/**
 * Typical figures, NOT measured from any real vehicle. They exist so a drawing
 * can be produced before anyone types real dimensions in, and any screen using
 * them must say so.
 */
export const ASSUMED_VAN_PROFILE: CargoVehicleProfile = {
  lengthMm: 4_000,
  widthMm: 2_100,
  bodyType: 'van',
  wheelArch: { startMm: 2_400, endMm: 3_700, intrusionMm: 250 },
  maximumPayloadKg: 1_500,
};

/**
 * GMC Savana / Chevrolet Express, read off the manufacturer drawing:
 * cargo length 3246 mm (short) or 3754 mm (long), maximum interior width
 * 1598 mm, 1338 mm between the wheel housings.
 *
 * Worth knowing before planning around it: 1598 mm cannot take two 800 mm
 * pallets side by side - it is 2 mm short of the 1600 mm needed - so this body
 * loads euro pallets single file whatever the orientation. It is built around
 * American 1219 x 1016 mm pallets, not euro ones.
 */
export const SAVANA_SHORT_PROFILE: CargoVehicleProfile = {
  lengthMm: 3_246,
  widthMm: 1_598,
  bodyType: 'van',
  wheelArch: { startMm: 1_900, endMm: 3_246, intrusionMm: 130 },
  maximumPayloadKg: 1_500,
};

export const SAVANA_LONG_PROFILE: CargoVehicleProfile = {
  ...SAVANA_SHORT_PROFILE,
  lengthMm: 3_754,
  wheelArch: { startMm: 2_400, endMm: 3_754, intrusionMm: 130 },
};

/**
 * 8-pallet box body ("buda"), from the real figures: 4200 mm outer, 4100 mm of
 * usable floor, 2100-2200 mm usable width. No wheel arches - the floor sits
 * above them and is flat end to end.
 */
export const BOX_8_PALLET_PROFILE: CargoVehicleProfile = {
  lengthMm: 4_100,
  widthMm: 2_100,
  bodyType: 'box',
  wheelArch: null,
  maximumPayloadKg: 1_500,
};

/** Same body at the wider end of the usual range. */
export const BOX_8_PALLET_WIDE_PROFILE: CargoVehicleProfile = {
  ...BOX_8_PALLET_PROFILE,
  widthMm: 2_200,
};

export type PalletOrientation = 'crosswise' | 'lengthwise';

export type CargoBand = {
  startMm: number;
  endMm: number;
  /** Width left after the wheel arches bite in, if they reach this band. */
  usableWidthMm: number;
  /** Left edge of the usable strip; non-zero only where arches intrude. */
  usableStartXMm: number;
  hasWheelArch: boolean;
};

export type CargoSlot = {
  /** 1 = nearest the cabin, loaded first, delivered last. */
  index: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  orientation: PalletOrientation;
  inWheelArchBand: boolean;
};

export type CargoItemInput = {
  id: string;
  /** 1 = first delivery of the day. */
  deliveryOrder: number;
  weightKg: number | null;
  label: string;
  /** Explicit pallet count, when it is actually known. */
  palletCount?: number | null;
};

export type PlacedPallet = {
  itemId: string;
  label: string;
  deliveryOrder: number;
  /** Which pallet of that delivery this is, when one drop needs several. */
  palletOfItem: number;
  palletsForItem: number;
  weightKg: number | null;
  /** True when the pallet count came from weight rather than being stated. */
  estimated: boolean;
  slot: CargoSlot;
};

export type CargoLayoutWarning = {
  code:
    | 'NO_SLOTS'
    | 'PALLETS_DO_NOT_FIT'
    | 'PAYLOAD_EXCEEDED'
    | 'ESTIMATED_PALLETS'
    | 'ASSUMED_VEHICLE';
  severity: 'warning' | 'critical';
  message: string;
};

export type CargoLayout = {
  vehicle: CargoVehicleProfile;
  bands: CargoBand[];
  slots: CargoSlot[];
  placed: PlacedPallet[];
  /** Pallets that had nowhere to go. */
  unplaced: PlacedPallet[];
  totalWeightKg: number;
  usedSlotPercent: number;
  averagePalletWeightKg: number | null;
  warnings: CargoLayoutWarning[];
};

/** Split the floor along its length wherever the usable width changes. */
export function buildBands(vehicle: CargoVehicleProfile): CargoBand[] {
  const full = (startMm: number, endMm: number): CargoBand => ({
    startMm,
    endMm,
    usableWidthMm: vehicle.widthMm,
    usableStartXMm: 0,
    hasWheelArch: false,
  });

  const arch = vehicle.bodyType === 'van' ? vehicle.wheelArch : null;
  if (!arch || arch.intrusionMm <= 0 || arch.endMm <= arch.startMm) {
    return [full(0, vehicle.lengthMm)].filter((band) => band.endMm > band.startMm);
  }

  const archStart = clamp(arch.startMm, 0, vehicle.lengthMm);
  const archEnd = clamp(arch.endMm, 0, vehicle.lengthMm);
  const usableWidth = Math.max(0, vehicle.widthMm - arch.intrusionMm * 2);

  return [
    full(0, archStart),
    {
      startMm: archStart,
      endMm: archEnd,
      usableWidthMm: usableWidth,
      usableStartXMm: arch.intrusionMm,
      hasWheelArch: true,
    },
    full(archEnd, vehicle.lengthMm),
  ].filter((band) => band.endMm - band.startMm > 0);
}

export type CargoStrip = {
  orientation: PalletOrientation;
  widthMm: number;
  depthMm: number;
  rows: number;
};

/**
 * Fill a band's width with vertical strips, choosing each strip's orientation
 * on its own.
 *
 * One orientation for a whole band is not enough. A 4100 x 2100 box body takes
 * eight euro pallets, and only in a mixed layout: a 1200 mm strip holding five
 * crosswise pallets, and an 800 mm strip beside it holding three lengthwise.
 * Forcing a single orientation gives six and quietly loses two pallet spaces.
 */
export function packBand(band: CargoBand): CargoStrip[] {
  const depth = band.endMm - band.startMm;
  const strips: CargoStrip[] = [];
  let remaining = band.usableWidthMm;

  while (remaining >= EURO_PALLET_SHORT_MM) {
    const options: CargoStrip[] = [];
    if (remaining >= EURO_PALLET_LONG_MM) {
      options.push({
        orientation: 'crosswise',
        widthMm: EURO_PALLET_LONG_MM,
        depthMm: EURO_PALLET_SHORT_MM,
        rows: Math.floor(depth / EURO_PALLET_SHORT_MM),
      });
    }
    options.push({
      orientation: 'lengthwise',
      widthMm: EURO_PALLET_SHORT_MM,
      depthMm: EURO_PALLET_LONG_MM,
      rows: Math.floor(depth / EURO_PALLET_LONG_MM),
    });

    // More pallets per strip wins; a tie goes to the crosswise strip, whose
    // shallower rows leave the driver smaller steps to unload.
    const best = options
      .filter((option) => option.rows > 0)
      .sort((left, right) => right.rows - left.rows
        || (left.orientation === 'crosswise' ? -1 : 1))[0];
    if (!best) break;

    strips.push(best);
    remaining -= best.widthMm;
  }

  return strips;
}

/**
 * How many pallets one delivery takes.
 *
 * When nobody has stated a count it is derived from weight, using the vehicle's
 * own numbers: payload divided by the number of slots it has. A 1500 kg van
 * holding five pallets gives 300 kg each without anyone choosing that figure.
 * Derived counts are flagged, because a pallet of pillows and a pallet of tiles
 * weigh nothing alike.
 */
export function derivePalletCount(
  item: CargoItemInput,
  averagePalletWeightKg: number | null,
): { count: number; estimated: boolean } {
  if (typeof item.palletCount === 'number' && item.palletCount > 0) {
    return { count: Math.floor(item.palletCount), estimated: false };
  }
  if (item.weightKg === null || !averagePalletWeightKg || averagePalletWeightKg <= 0) {
    return { count: 1, estimated: true };
  }
  return {
    count: Math.max(1, Math.ceil(item.weightKg / averagePalletWeightKg)),
    estimated: true,
  };
}

export function planCargoLayout(
  vehicle: CargoVehicleProfile,
  items: readonly CargoItemInput[],
  options: { assumedVehicle?: boolean } = {},
): CargoLayout {
  const slots = buildSlots(vehicle);
  const averagePalletWeightKg = vehicle.maximumPayloadKg && slots.length > 0
    ? vehicle.maximumPayloadKg / slots.length
    : null;

  // First delivery goes nearest the doors, so slots are filled from the rear.
  const rearFirst = [...slots].sort((left, right) => right.yMm - left.yMm || left.xMm - right.xMm);
  const ordered = [...items].sort((left, right) => left.deliveryOrder - right.deliveryOrder);

  const placed: PlacedPallet[] = [];
  const unplaced: PlacedPallet[] = [];
  let cursor = 0;
  let estimatedItems = 0;

  for (const item of ordered) {
    const { count, estimated } = derivePalletCount(item, averagePalletWeightKg);
    if (estimated) estimatedItems += 1;
    for (let pallet = 1; pallet <= count; pallet += 1) {
      const slot = rearFirst[cursor];
      const entry: PlacedPallet = {
        itemId: item.id,
        label: item.label,
        deliveryOrder: item.deliveryOrder,
        palletOfItem: pallet,
        palletsForItem: count,
        // Weight is split evenly across the pallets of one delivery.
        weightKg: item.weightKg === null ? null : item.weightKg / count,
        estimated,
        slot: slot ?? placeholderSlot(cursor),
      };
      if (slot) {
        placed.push(entry);
        cursor += 1;
      } else {
        unplaced.push(entry);
      }
    }
  }

  const totalWeightKg = items.reduce((sum, item) => sum + (item.weightKg ?? 0), 0);
  return {
    vehicle,
    bands: buildBands(vehicle),
    slots,
    placed,
    unplaced,
    totalWeightKg,
    usedSlotPercent: slots.length === 0 ? 0 : Math.round((placed.length / slots.length) * 100),
    averagePalletWeightKg,
    warnings: collectWarnings({
      slots,
      unplaced,
      totalWeightKg,
      estimatedItems,
      maximumPayloadKg: vehicle.maximumPayloadKg ?? null,
      assumedVehicle: options.assumedVehicle === true,
    }),
  };
}

function collectWarnings(input: {
  slots: CargoSlot[];
  unplaced: PlacedPallet[];
  totalWeightKg: number;
  estimatedItems: number;
  maximumPayloadKg: number | null;
  assumedVehicle: boolean;
}): CargoLayoutWarning[] {
  const warnings: CargoLayoutWarning[] = [];
  if (input.assumedVehicle) {
    warnings.push({
      code: 'ASSUMED_VEHICLE',
      severity: 'warning',
      message: 'Naudojami tipiniai furgono matmenys — suveskite tikruosius automobilio kortelėje.',
    });
  }
  if (input.slots.length === 0) {
    warnings.push({
      code: 'NO_SLOTS',
      severity: 'critical',
      message: 'Pagal nurodytus matmenis netelpa nė vienas europadėklas.',
    });
  }
  if (input.unplaced.length > 0) {
    warnings.push({
      code: 'PALLETS_DO_NOT_FIT',
      severity: 'critical',
      message: `${input.unplaced.length} padėklui (-ams) neužtenka vietos — reikia antro reiso arba didesnio automobilio.`,
    });
  }
  if (
    input.maximumPayloadKg !== null
    && input.maximumPayloadKg > 0
    && input.totalWeightKg > input.maximumPayloadKg
  ) {
    warnings.push({
      code: 'PAYLOAD_EXCEEDED',
      severity: 'critical',
      message: `Krovinys ${Math.round(input.totalWeightKg)} kg viršija keliamąją galią ${Math.round(input.maximumPayloadKg)} kg.`,
    });
  }
  if (input.estimatedItems > 0) {
    warnings.push({
      code: 'ESTIMATED_PALLETS',
      severity: 'warning',
      message: `${input.estimatedItems} pristatymo (-ų) padėklų kiekis įvertintas pagal svorį — patikslinkite, jei žinote tikslų.`,
    });
  }
  return warnings;
}

function placeholderSlot(index: number): CargoSlot {
  return {
    index: index + 1,
    xMm: 0,
    yMm: 0,
    widthMm: EURO_PALLET_LONG_MM,
    depthMm: EURO_PALLET_SHORT_MM,
    orientation: 'crosswise',
    inWheelArchBand: false,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildSlots(vehicle: CargoVehicleProfile): CargoSlot[] {
  const slots: CargoSlot[] = [];
  for (const band of buildBands(vehicle)) {
    const strips = packBand(band);
    if (strips.length === 0) continue;
    const usedWidth = strips.reduce((sum, strip) => sum + strip.widthMm, 0);
    // The packed block is centred: a pallet cannot sit on a wheel arch.
    let cursorX = band.usableStartXMm + (band.usableWidthMm - usedWidth) / 2;
    for (const strip of strips) {
      for (let row = 0; row < strip.rows; row += 1) {
        slots.push({
          index: 0,
          xMm: cursorX,
          yMm: band.startMm + row * strip.depthMm,
          widthMm: strip.widthMm,
          depthMm: strip.depthMm,
          orientation: strip.orientation,
          inWheelArchBand: band.hasWheelArch,
        });
      }
      cursorX += strip.widthMm;
    }
  }
  // Numbered cabin first, so slot 1 is loaded first and delivered last.
  return slots
    .sort((left, right) => left.yMm - right.yMm || left.xMm - right.xMm)
    .map((slot, index) => ({ ...slot, index: index + 1 }));
}

