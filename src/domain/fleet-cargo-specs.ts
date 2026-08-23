export const PALLET_CAPACITIES = [5, 8] as const;
export type PalletCapacity = (typeof PALLET_CAPACITIES)[number];

export type FleetCargoSpec = {
  palletCapacity: PalletCapacity;
  hasSideDoor: boolean;
};

/** Karolio parko kėbulai. Krovimo schema ima šiuos duomenis pagal valstybinį numerį. */
export const FLEET_CARGO_SPECS: Record<string, FleetCargoSpec> = {
  MSZ859: { palletCapacity: 8, hasSideDoor: true },
  NLL182: { palletCapacity: 8, hasSideDoor: true },
  LRI740: { palletCapacity: 8, hasSideDoor: true },
  LRI744: { palletCapacity: 8, hasSideDoor: true },
  LRI748: { palletCapacity: 8, hasSideDoor: true },
  LRI741: { palletCapacity: 8, hasSideDoor: false },
  MET630: { palletCapacity: 5, hasSideDoor: true },
  MET628: { palletCapacity: 5, hasSideDoor: true },
};

export function isPalletCapacity(value: unknown): value is PalletCapacity {
  return value === 5 || value === 8;
}

export function fleetCargoSpec(registration: string | null | undefined): FleetCargoSpec | null {
  if (!registration) return null;
  return FLEET_CARGO_SPECS[registration.trim().toUpperCase()] ?? null;
}

export function bodyKindFromPalletCapacity(capacity: PalletCapacity): 'van_long' | 'van_8pll' {
  return capacity === 8 ? 'van_8pll' : 'van_long';
}

/** Known diesel tank sizes in litres. Opening balance is a separate fuel reading. */
export const FLEET_TANK_CAPACITIES: Record<string, number> = {
  MET630: 110,
  NLL182: 90,
};

export function fleetTankCapacity(registration: string | null | undefined): number | null {
  if (!registration) return null;
  return FLEET_TANK_CAPACITIES[registration.trim().toUpperCase()] ?? null;
}

export function isFuelTankCapacity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 400;
}

/**
 * Stored tank size wins. If the vehicle document has none yet, known plates
 * fill in from the catalog so MET630 and NLL182 show 110 l and 90 l without a
 * separate data model.
 */
export function resolveFuelTankCapacity(
  vehicle: {
    registrationNumber?: string | null;
    fuelTankCapacityLiters?: number | null;
  } | null | undefined,
): number | null {
  if (isFuelTankCapacity(vehicle?.fuelTankCapacityLiters)) {
    return Math.round(vehicle.fuelTankCapacityLiters * 10) / 10;
  }
  return fleetTankCapacity(vehicle?.registrationNumber);
}

export function resolveVehicleCargo(
  vehicle: {
    registrationNumber?: string | null;
    palletCapacity?: number | null;
    cargoBodyKind?: string | null;
    hasSideDoor?: boolean | null;
  } | null | undefined,
): FleetCargoSpec {
  const known = fleetCargoSpec(vehicle?.registrationNumber);
  if (isPalletCapacity(vehicle?.palletCapacity)) {
    return {
      palletCapacity: vehicle.palletCapacity,
      hasSideDoor: vehicle?.hasSideDoor === true,
    };
  }
  if (vehicle?.cargoBodyKind === 'van_8pll') {
    return { palletCapacity: 8, hasSideDoor: vehicle.hasSideDoor === true };
  }
  if (known) return known;
  return {
    palletCapacity: 5,
    hasSideDoor: vehicle?.hasSideDoor === true,
  };
}
