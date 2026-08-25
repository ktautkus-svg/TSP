import {
  ASSUMED_VAN_PROFILE,
  BOX_8_PALLET_PROFILE,
  type CargoItemInput,
  type CargoVehicleProfile,
} from '@/domain/cargo-layout';
import { resolveVehicleCargo } from '@/domain/fleet-cargo-specs';
import type { ServerFleetVehicleSnapshot } from '@/infrastructure/auth/employee-session';

export type CargoProfileResolution = {
  profile: CargoVehicleProfile;
  /** False when the real floor is known and the drawing can be trusted. */
  assumed: boolean;
};

/**
 * The cargo floor to draw for an assigned vehicle.
 *
 * Measured length and width are used when both exist. Otherwise the typical
 * 5 PLL van or 8 PLL box floor for that vehicle is drawn, so the driver still
 * sees pallet places rather than an empty bay diagram.
 */
export function resolveCargoProfile(
  vehicle: ServerFleetVehicleSnapshot | null | undefined,
): CargoProfileResolution {
  const lengthMm = positive(vehicle?.cargoLengthMm);
  const widthMm = positive(vehicle?.cargoWidthMm);
  if (!vehicle || lengthMm === null || widthMm === null) {
    return { profile: typicalProfile(vehicle), assumed: true };
  }

  const bodyType = vehicle.cargoBodyType === 'box' ? 'box' : 'van';
  const startMm = positive(vehicle.wheelArchStartMm);
  const endMm = positive(vehicle.wheelArchEndMm);
  const intrusionMm = positive(vehicle.wheelArchIntrusionMm);

  return {
    profile: {
      lengthMm,
      widthMm,
      bodyType,
      // A box body has a flat floor; arches only matter on a van, and only when
      // all three figures are present.
      wheelArch: bodyType === 'van' && startMm !== null && endMm !== null && intrusionMm !== null
        ? { startMm, endMm, intrusionMm }
        : null,
      maximumPayloadKg: positive(vehicle.maximumPayloadKg),
    },
    assumed: false,
  };
}

/** Stops become cargo items; pallet counts are derived later from weight. */
export function toCargoItems(
  stops: readonly {
    id: string;
    activeOrder: number | null;
    optimizedOrder: number | null;
    originalOrder: number;
    weightKg: number | null;
    recipient: string;
    normalizedAddress?: string | null;
    originalAddress?: string;
    loadingStatus: 'pending' | 'loaded';
    deliveryStatus: 'pending' | 'delivered' | 'failed';
  }[],
): CargoItemInput[] {
  return stops
    .filter((stop) => !(stop.loadingStatus === 'pending' && stop.deliveryStatus === 'failed'))
    .map((stop) => ({
      id: stop.id,
      deliveryOrder: stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder,
      weightKg: stop.weightKg,
      label: stop.recipient || stop.normalizedAddress || stop.originalAddress || stop.id,
      // One floor place per stop. Weight does not invent extra pallets — a 956 kg
      // PLL is still one euro pallet, placed in one slot, not four guessed ones.
      palletCount: 1,
    }));
}

function typicalProfile(
  vehicle: ServerFleetVehicleSnapshot | null | undefined,
): CargoVehicleProfile {
  const cargo = resolveVehicleCargo(vehicle);
  const base = cargo.palletCapacity === 8 ? BOX_8_PALLET_PROFILE : ASSUMED_VAN_PROFILE;
  const payload = positive(vehicle?.maximumPayloadKg);
  return {
    ...base,
    maximumPayloadKg: payload ?? base.maximumPayloadKg ?? null,
  };
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
