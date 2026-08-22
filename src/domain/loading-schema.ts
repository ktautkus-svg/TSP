import {
  bodyKindFromPalletCapacity,
  fleetCargoSpec,
  isPalletCapacity,
  resolveVehicleCargo,
  type PalletCapacity,
} from '@/domain/fleet-cargo-specs';

export const PALLET_WEIGHT_KG = 200;

export const VAN_BODY_KINDS = ['van_long', 'van_8pll', 'van_short'] as const;
export type VanBodyKind = (typeof VAN_BODY_KINDS)[number];

export type LoadingBayId =
  | 'front_left'
  | 'front_right'
  | 'row_1'
  | 'row_2'
  | 'row_3'
  | 'row_4'
  | 'row_5'
  | 'row_6';

export type LoadingBayOrientation = 'vertical' | 'horizontal';

export type LoadingSchemaOptions = {
  bodyKind?: VanBodyKind;
  hasSideDoor?: boolean;
};

export type LoadingSchemaStopInput = {
  id: string;
  loadingSequence: number;
  deliveryOrder: number;
  weightKg: number | null;
  recipient: string;
  address: string;
  skipped?: boolean;
};

export type LoadingPlacement = {
  stopId: string;
  loadingSequence: number;
  deliveryOrder: number;
  weightKg: number | null;
  recipient: string;
  address: string;
  bayId: LoadingBayId;
  bayLabel: string;
  stackLevel: number;
  stackLabel: string;
  usePallet: boolean;
  sideAccess: boolean;
  reason: string;
};

export type LoadingBayView = {
  id: LoadingBayId;
  label: string;
  orientation: LoadingBayOrientation;
  nearDoors: boolean;
  sideDoor: boolean;
  placements: LoadingPlacement[];
};

export type LoadingSchema = {
  bodyKind: VanBodyKind;
  bodyLabel: string;
  hasSideDoor: boolean;
  bays: LoadingBayView[];
  placements: LoadingPlacement[];
  palletCount: number;
  sideUnloadCount: number;
  summary: string;
};

type BayDefinition = {
  id: LoadingBayId;
  label: string;
  orientation: LoadingBayOrientation;
  /** 1 = nearest the rear doors. */
  doorRank: number;
};

const LONG_BAYS: BayDefinition[] = [
  { id: 'front_left', label: 'Priekis kairė', orientation: 'vertical', doorRank: 5 },
  { id: 'front_right', label: 'Priekis dešinė', orientation: 'vertical', doorRank: 5 },
  { id: 'row_1', label: '1 eilė', orientation: 'horizontal', doorRank: 3 },
  { id: 'row_2', label: '2 eilė', orientation: 'horizontal', doorRank: 2 },
  { id: 'row_3', label: 'Prie galinių durų', orientation: 'horizontal', doorRank: 1 },
];

const SHORT_BAYS: BayDefinition[] = [
  { id: 'front_left', label: 'Priekis kairė', orientation: 'vertical', doorRank: 4 },
  { id: 'front_right', label: 'Priekis dešinė', orientation: 'vertical', doorRank: 4 },
  { id: 'row_1', label: '1 eilė', orientation: 'horizontal', doorRank: 2 },
  { id: 'row_2', label: 'Prie galinių durų', orientation: 'horizontal', doorRank: 1 },
];

const EIGHT_BAYS: BayDefinition[] = [
  { id: 'front_left', label: 'Priekis kairė', orientation: 'vertical', doorRank: 8 },
  { id: 'front_right', label: 'Priekis dešinė', orientation: 'vertical', doorRank: 8 },
  { id: 'row_1', label: '1 eilė', orientation: 'horizontal', doorRank: 6 },
  { id: 'row_2', label: '2 eilė', orientation: 'horizontal', doorRank: 5 },
  { id: 'row_3', label: '3 eilė', orientation: 'horizontal', doorRank: 4 },
  { id: 'row_4', label: '4 eilė', orientation: 'horizontal', doorRank: 3 },
  { id: 'row_5', label: '5 eilė', orientation: 'horizontal', doorRank: 2 },
  { id: 'row_6', label: 'Prie galinių durų', orientation: 'horizontal', doorRank: 1 },
];

export function isVanBodyKind(value: unknown): value is VanBodyKind {
  return value === 'van_long' || value === 'van_8pll' || value === 'van_short';
}

export function vanBodyLabel(kind: VanBodyKind): string {
  if (kind === 'van_8pll') return '8 PLL';
  if (kind === 'van_short') return '4 PLL · 2+2';
  return '5 PLL · 2+3';
}

export type AssignedVehicleCargo = {
  registrationNumber?: string | null;
  model?: string | null;
  cargoBodyKind?: VanBodyKind | null;
  palletCapacity?: number | null;
  hasSideDoor?: boolean | null;
};

export type VehicleCargoLayout = {
  bodyKind: VanBodyKind;
  palletCapacity: PalletCapacity;
  hasSideDoor: boolean;
  assigned: boolean;
  vehicleLabel: string | null;
};

export function cargoLayoutFromAssignedVehicle(
  vehicle: AssignedVehicleCargo | null | undefined,
): VehicleCargoLayout {
  const cargo = resolveVehicleCargo(vehicle);
  if (!vehicle) {
    return {
      bodyKind: 'van_long',
      palletCapacity: 5,
      hasSideDoor: false,
      assigned: false,
      vehicleLabel: null,
    };
  }
  const keepShort = vehicle.cargoBodyKind === 'van_short'
    && !fleetCargoSpec(vehicle.registrationNumber)
    && !isPalletCapacity(vehicle.palletCapacity);
  const bodyKind: VanBodyKind = keepShort
    ? 'van_short'
    : bodyKindFromPalletCapacity(cargo.palletCapacity);
  const registration = vehicle.registrationNumber?.trim() || null;
  const model = vehicle.model?.trim() || null;
  return {
    bodyKind,
    palletCapacity: cargo.palletCapacity,
    hasSideDoor: cargo.hasSideDoor,
    assigned: true,
    vehicleLabel: [registration, model].filter(Boolean).join(' · ') || registration,
  };
}

export function vehicleCargoSummary(layout: VehicleCargoLayout): string {
  const doors = layout.hasSideDoor ? 'šoninės durys yra' : 'šoninių durų nėra';
  const size = layout.bodyKind === 'van_short' ? '4 PLL' : `${layout.palletCapacity} PLL`;
  if (!layout.assigned) {
    return `Automobilis nepriskirtas · ${size} · ${doors}`;
  }
  return `${layout.vehicleLabel} · ${size} · ${doors}`;
}

export function baysForVanBody(kind: VanBodyKind): BayDefinition[] {
  if (kind === 'van_8pll') return EIGHT_BAYS;
  if (kind === 'van_short') return SHORT_BAYS;
  return LONG_BAYS;
}

export function shouldUsePallet(weightKg: number | null): boolean {
  return weightKg !== null && Number.isFinite(weightKg) && weightKg >= PALLET_WEIGHT_KG;
}

function normalizeOptions(options?: VanBodyKind | LoadingSchemaOptions): Required<LoadingSchemaOptions> {
  if (options === 'van_long' || options === 'van_8pll' || options === 'van_short') {
    return { bodyKind: options, hasSideDoor: false };
  }
  return {
    bodyKind: options?.bodyKind ?? 'van_long',
    hasSideDoor: options?.hasSideDoor ?? false,
  };
}

function sideDoorBay(bays: BayDefinition[]): BayDefinition | null {
  return bays.find((bay) => bay.orientation === 'horizontal' && bay.doorRank === 2) ?? null;
}

function stackLabel(level: number, count: number): string {
  if (count <= 1) return 'grindys';
  if (level === 0) return 'apačia';
  if (level === count - 1) return 'viršus';
  return `sluoksnis ${level + 1}`;
}

function placementReason(input: {
  bayLabel: string;
  stackLabel: string;
  usePallet: boolean;
  nearDoors: boolean;
  sideAccess: boolean;
}): string {
  const pallet = input.usePallet
    ? `PLL, nes svoris nuo ${PALLET_WEIGHT_KG} kg`
    : 'be paletės';
  if (input.sideAccess) {
    return `${input.bayLabel}, ${input.stackLabel}, ${pallet}. Iškrauti per šonines duris, kad nereikėtų kasti iš maršruto vidurio.`;
  }
  const depth = input.nearDoors
    ? 'prie galinių durų, nes tai ankstesnis pristatymas'
    : 'giliau, nes pristatymas vėlesnis';
  return `${input.bayLabel}, ${input.stackLabel}, ${pallet}. ${depth}.`;
}

function sideDoorCandidates(stops: readonly LoadingSchemaStopInput[]): LoadingSchemaStopInput[] {
  if (stops.length < 3) return [];
  const orders = stops.map((stop) => stop.deliveryOrder);
  const first = Math.min(...orders);
  const last = Math.max(...orders);
  // First drop stays on the rear path even if heavy. Last drop stays toward the cabin.
  // Only a heavy mid-route stop is pulled to the side so it can leave without unstacking 7→1.
  return stops
    .filter((stop) => shouldUsePallet(stop.weightKg) && stop.deliveryOrder > first && stop.deliveryOrder < last)
    .sort((left, right) => (right.weightKg ?? 0) - (left.weightKg ?? 0) || left.deliveryOrder - right.deliveryOrder);
}

function assignRearAccess(
  stops: readonly LoadingSchemaStopInput[],
  bays: BayDefinition[],
): Map<string, LoadingBayId> {
  const assigned = new Map<string, LoadingBayId>();
  if (bays.length === 0) return assigned;
  const ordered = [...stops].sort((left, right) => left.loadingSequence - right.loadingSequence);
  const rear = [...bays].sort((left, right) => left.doorRank - right.doorRank)[0] ?? bays[bays.length - 1];
  if (ordered.length <= bays.length) {
    const offset = bays.length - ordered.length;
    ordered.forEach((stop, index) => {
      assigned.set(stop.id, bays[offset + index].id);
    });
    return assigned;
  }
  ordered.forEach((stop, index) => {
    assigned.set(stop.id, index < bays.length ? bays[index].id : rear.id);
  });
  return assigned;
}

export function recommendLoadingSchema(
  stops: readonly LoadingSchemaStopInput[],
  options?: VanBodyKind | LoadingSchemaOptions,
): LoadingSchema {
  const { bodyKind, hasSideDoor } = normalizeOptions(options);
  const bays = baysForVanBody(bodyKind);
  const active = stops
    .filter((stop) => !stop.skipped)
    .slice()
    .sort((left, right) => left.loadingSequence - right.loadingSequence);

  const sideBay = hasSideDoor ? sideDoorBay(bays) : null;
  const sideStops = sideBay ? sideDoorCandidates(active) : [];
  const sideIds = new Set(sideStops.map((stop) => stop.id));
  const rearStops = active.filter((stop) => !sideIds.has(stop.id));
  const rearBays = sideBay && sideStops.length > 0
    ? bays.filter((bay) => bay.id !== sideBay.id)
    : bays;

  const assigned = assignRearAccess(rearStops, rearBays);
  for (const stop of sideStops) {
    if (sideBay) assigned.set(stop.id, sideBay.id);
  }

  const grouped = new Map<LoadingBayId, LoadingSchemaStopInput[]>();
  for (const bay of bays) grouped.set(bay.id, []);
  for (const stop of active) {
    const bayId = assigned.get(stop.id);
    if (!bayId) continue;
    grouped.get(bayId)?.push(stop);
  }

  const placements: LoadingPlacement[] = [];
  const bayViews: LoadingBayView[] = bays.map((bay) => {
    const isSide = Boolean(sideBay && bay.id === sideBay.id && sideStops.length > 0);
    const items = [...(grouped.get(bay.id) ?? [])].sort((left, right) => {
      if (right.deliveryOrder !== left.deliveryOrder) return right.deliveryOrder - left.deliveryOrder;
      return (right.weightKg ?? 0) - (left.weightKg ?? 0);
    });
    const label = isSide ? 'Šoninės durys' : bay.label;
    const bayPlacements = items.map((stop, stackLevel) => {
      const usePallet = shouldUsePallet(stop.weightKg);
      const stack = stackLabel(stackLevel, items.length);
      const nearDoors = bay.doorRank === 1;
      return {
        stopId: stop.id,
        loadingSequence: stop.loadingSequence,
        deliveryOrder: stop.deliveryOrder,
        weightKg: stop.weightKg,
        recipient: stop.recipient,
        address: stop.address,
        bayId: bay.id,
        bayLabel: label,
        stackLevel,
        stackLabel: stack,
        usePallet,
        sideAccess: isSide,
        reason: placementReason({
          bayLabel: label,
          stackLabel: stack,
          usePallet,
          nearDoors,
          sideAccess: isSide,
        }),
      };
    });
    placements.push(...bayPlacements);
    return {
      id: bay.id,
      label,
      orientation: bay.orientation,
      nearDoors: bay.doorRank === 1,
      sideDoor: isSide,
      placements: bayPlacements,
    };
  });

  const palletCount = placements.filter((item) => item.usePallet).length;
  const sideUnloadCount = placements.filter((item) => item.sideAccess).length;
  const summary = [
    'Maršruto eilė išlieka: pirmas taškas prie galinių durų, paskutinis — prie kabinos.',
    hasSideDoor
      ? sideUnloadCount > 0
        ? 'Sunkų vidurio tašką kraukite prie šoninių durų, kad išeitų iškrauti neardant viso krovinio.'
        : 'Šoninės durys yra, bet viduryje maršruto nėra sunkaus krovinio — kraunama tik per galą.'
      : 'Šoninių durų nėra — kraunama tik pagal galines duris, viduryje mašinos pirmo taško nedėti.',
    palletCount === 0
      ? 'Paletės nereikia, nebent svoris didelis.'
      : `${palletCount === 1 ? '1 užsakymui' : `${palletCount} užsakymams`} rekomenduojama PLL.`,
  ].join(' ');

  return {
    bodyKind,
    bodyLabel: vanBodyLabel(bodyKind),
    hasSideDoor,
    bays: bayViews,
    placements: placements.sort((left, right) => left.loadingSequence - right.loadingSequence),
    palletCount,
    sideUnloadCount,
    summary,
  };
}

export function deliveryOrderOf(stop: { activeOrder: number | null; optimizedOrder: number | null; originalOrder: number }): number {
  return stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder;
}

export function toLoadingSchemaStops(
  stops: readonly {
    id: string;
    activeOrder: number | null;
    optimizedOrder: number | null;
    originalOrder: number;
    weightKg: number | null;
    recipient: string;
    address: string;
    normalizedAddress?: string | null;
    originalAddress?: string;
    loadingStatus: 'pending' | 'loaded';
    deliveryStatus: 'pending' | 'delivered' | 'failed';
  }[],
): LoadingSchemaStopInput[] {
  const ordered = [...stops].sort((left, right) => deliveryOrderOf(right) - deliveryOrderOf(left));
  return ordered.map((stop, index) => ({
    id: stop.id,
    loadingSequence: index + 1,
    deliveryOrder: deliveryOrderOf(stop),
    weightKg: stop.weightKg,
    recipient: stop.recipient,
    address: stop.normalizedAddress ?? stop.originalAddress ?? stop.address,
    skipped: stop.loadingStatus === 'pending' && stop.deliveryStatus === 'failed',
  }));
}
