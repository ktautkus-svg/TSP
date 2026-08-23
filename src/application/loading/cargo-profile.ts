import {
  ASSUMED_VAN_PROFILE,
  type CargoItemInput,
  type CargoVehicleProfile,
} from '@/domain/cargo-layout';
import type { ServerFleetVehicleSnapshot } from '@/infrastructure/auth/employee-session';

export type CargoProfileResolution = {
  profile: CargoVehicleProfile;
  /** False when the real floor is known and the drawing can be trusted. */
  assumed: boolean;
};

/**
 * The cargo floor to draw for an assigned vehicle.
 *
 * Both length and width have to be recorded before a pallet drawing means
 * anything; with either missing there is nothing honest to scale against, so
 * the caller is told the figures are assumed and can fall back to the older bay
 * diagram instead.
 */
export function resolveCargoProfile(
  vehicle: ServerFleetVehicleSnapshot | null | undefined,
): CargoProfileResolution {
  const lengthMm = positive(vehicle?.cargoLengthMm);
  const widthMm = positive(vehicle?.cargoWidthMm);
  if (!vehicle || lengthMm === null || widthMm === null) {
    return { profile: ASSUMED_VAN_PROFILE, assumed: true };
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
    }));
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
