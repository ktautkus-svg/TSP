export const PALLET_WEIGHT_KG = 200;

export const VAN_BODY_KINDS = ['van_long', 'van_short'] as const;
export type VanBodyKind = (typeof VAN_BODY_KINDS)[number];

export type LoadingBayId =
  | 'front_left'
  | 'front_right'
  | 'row_1'
  | 'row_2'
  | 'row_3';

export type LoadingBayOrientation = 'vertical' | 'horizontal';

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
  reason: string;
};

export type LoadingBayView = {
  id: LoadingBayId;
  label: string;
  orientation: LoadingBayOrientation;
  nearDoors: boolean;
  placements: LoadingPlacement[];
};

export type LoadingSchema = {
  bodyKind: VanBodyKind;
  bodyLabel: string;
  bays: LoadingBayView[];
  placements: LoadingPlacement[];
  palletCount: number;
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
  { id: 'row_3', label: 'Prie durų', orientation: 'horizontal', doorRank: 1 },
];

const SHORT_BAYS: BayDefinition[] = [
  { id: 'front_left', label: 'Priekis kairė', orientation: 'vertical', doorRank: 4 },
  { id: 'front_right', label: 'Priekis dešinė', orientation: 'vertical', doorRank: 4 },
  { id: 'row_1', label: '1 eilė', orientation: 'horizontal', doorRank: 2 },
  { id: 'row_2', label: 'Prie durų', orientation: 'horizontal', doorRank: 1 },
];

export function isVanBodyKind(value: unknown): value is VanBodyKind {
  return value === 'van_long' || value === 'van_short';
}

export function vanBodyLabel(kind: VanBodyKind): string {
  return kind === 'van_short' ? 'Trumpesnis van · 2+2' : 'Ilgesnis van · 2+3';
}

export function baysForVanBody(kind: VanBodyKind): BayDefinition[] {
  return kind === 'van_short' ? SHORT_BAYS : LONG_BAYS;
}

export function shouldUsePallet(weightKg: number | null): boolean {
  return weightKg !== null && Number.isFinite(weightKg) && weightKg >= PALLET_WEIGHT_KG;
}

function sortKey(stop: LoadingSchemaStopInput): number {
  return stop.loadingSequence;
}

function overflowBays(bays: BayDefinition[]): BayDefinition[] {
  return [...bays]
    .filter((bay) => bay.orientation === 'horizontal')
    .sort((left, right) => left.doorRank - right.doorRank);
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
}): string {
  const pallet = input.usePallet
    ? `PLL, nes svoris nuo ${PALLET_WEIGHT_KG} kg`
    : 'be paletės';
  const depth = input.nearDoors ? 'arčiau durų, kad pirmiau iškrautumėte' : 'giliau, nes pristatymas vėlesnis';
  return `${input.bayLabel}, ${input.stackLabel}, ${pallet}. ${depth}.`;
}

export function recommendLoadingSchema(
  stops: readonly LoadingSchemaStopInput[],
  bodyKind: VanBodyKind = 'van_long',
): LoadingSchema {
  const bays = baysForVanBody(bodyKind);
  const active = stops
    .filter((stop) => !stop.skipped)
    .slice()
    .sort((left, right) => sortKey(left) - sortKey(right));

  const assigned = new Map<string, LoadingBayId>();
  const floorOrder = bays;
  const overflow = overflowBays(bays);

  active.forEach((stop, index) => {
    if (index < floorOrder.length) {
      assigned.set(stop.id, floorOrder[index].id);
      return;
    }
    const overflowBay = overflow[(index - floorOrder.length) % Math.max(overflow.length, 1)] ?? floorOrder[floorOrder.length - 1];
    assigned.set(stop.id, overflowBay.id);
  });

  const grouped = new Map<LoadingBayId, LoadingSchemaStopInput[]>();
  for (const bay of bays) grouped.set(bay.id, []);
  for (const stop of active) {
    const bayId = assigned.get(stop.id);
    if (!bayId) continue;
    grouped.get(bayId)?.push(stop);
  }

  const placements: LoadingPlacement[] = [];
  const bayViews: LoadingBayView[] = bays.map((bay) => {
    const items = [...(grouped.get(bay.id) ?? [])].sort((left, right) => {
      const leftWeight = left.weightKg ?? 0;
      const rightWeight = right.weightKg ?? 0;
      if (rightWeight !== leftWeight) return rightWeight - leftWeight;
      return left.loadingSequence - right.loadingSequence;
    });
    const bayPlacements = items.map((stop, stackLevel) => {
      const usePallet = shouldUsePallet(stop.weightKg);
      const stack = stackLabel(stackLevel, items.length);
      const nearDoors = bay.doorRank === 1;
      const placement: LoadingPlacement = {
        stopId: stop.id,
        loadingSequence: stop.loadingSequence,
        deliveryOrder: stop.deliveryOrder,
        weightKg: stop.weightKg,
        recipient: stop.recipient,
        address: stop.address,
        bayId: bay.id,
        bayLabel: bay.label,
        stackLevel,
        stackLabel: stack,
        usePallet,
        reason: placementReason({
          bayLabel: bay.label,
          stackLabel: stack,
          usePallet,
          nearDoors,
        }),
      };
      return placement;
    });
    placements.push(...bayPlacements);
    return {
      id: bay.id,
      label: bay.label,
      orientation: bay.orientation,
      nearDoors: bay.doorRank === 1,
      placements: bayPlacements,
    };
  });

  const palletCount = placements.filter((item) => item.usePallet).length;
  const summary = palletCount > 0
    ? `Sunkesni apačioje. ${palletCount} užsakymams rekomenduojama PLL; kitus kraukite be paletės.`
    : 'Sunkesni apačioje. Paletės nereikia — kraukite kaip stovi, pagal krovimo eilę.';

  return {
    bodyKind,
    bodyLabel: vanBodyLabel(bodyKind),
    bays: bayViews,
    placements: placements.sort((left, right) => left.loadingSequence - right.loadingSequence),
    palletCount,
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
