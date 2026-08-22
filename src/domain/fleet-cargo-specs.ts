export const PALLET_CAPACITIES = [5, 8] as const;
export type PalletCapacity = (typeof PALLET_CAPACITIES)[number];

export type FleetCargoSpec = {
  palletCapacity: PalletCapacity;
  hasSideDoor: boolean;
};

/** Karolio parko kėbulai. Krovimo schema ima šiuos duomenis pagal valstybinį numerį. */
export const FLEET_CARGO_SPECS: Record<string, FleetCargoSpec> = {
  MSZ859: { palletCapacity: 8, hasSideDoor: true },
  MSZ867: { palletCapacity: 8, hasSideDoor: true },
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
