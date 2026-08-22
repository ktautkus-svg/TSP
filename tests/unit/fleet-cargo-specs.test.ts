import { describe, expect, it } from 'vitest';

import {
  FLEET_CARGO_SPECS,
  bodyKindFromPalletCapacity,
  fleetCargoSpec,
  resolveVehicleCargo,
} from '../../src/domain/fleet-cargo-specs';

describe('fleet cargo specs', () => {
  it('stores Karolis fleet plates as 5 or 8 PLL with side-door flags', () => {
    expect(FLEET_CARGO_SPECS).toEqual({
      MSZ859: { palletCapacity: 8, hasSideDoor: true },
      MSZ867: { palletCapacity: 8, hasSideDoor: true },
      NLL182: { palletCapacity: 8, hasSideDoor: true },
      LRI740: { palletCapacity: 8, hasSideDoor: true },
      LRI744: { palletCapacity: 8, hasSideDoor: true },
      LRI748: { palletCapacity: 8, hasSideDoor: true },
      LRI741: { palletCapacity: 8, hasSideDoor: false },
      MET630: { palletCapacity: 5, hasSideDoor: true },
      MET628: { palletCapacity: 5, hasSideDoor: true },
    });
    expect(bodyKindFromPalletCapacity(8)).toBe('van_8pll');
    expect(bodyKindFromPalletCapacity(5)).toBe('van_long');
  });

  it('matches plates case-insensitively and ignores unknown numbers', () => {
    expect(fleetCargoSpec(' lri741 ')).toEqual({ palletCapacity: 8, hasSideDoor: false });
    expect(fleetCargoSpec('met628')).toEqual({ palletCapacity: 5, hasSideDoor: true });
    expect(fleetCargoSpec('ABC123')).toBeNull();
  });

  it('uses the catalog when a known plate has no stored pallet capacity yet', () => {
    expect(resolveVehicleCargo({
      registrationNumber: 'LRI744',
      cargoBodyKind: 'van_long',
      hasSideDoor: false,
    })).toEqual({ palletCapacity: 8, hasSideDoor: true });
    expect(resolveVehicleCargo({
      registrationNumber: 'LRI741',
      hasSideDoor: true,
    })).toEqual({ palletCapacity: 8, hasSideDoor: false });
    expect(resolveVehicleCargo({
      registrationNumber: 'MET630',
    })).toEqual({ palletCapacity: 5, hasSideDoor: true });
  });

  it('lets a stored pallet capacity override the catalog', () => {
    expect(resolveVehicleCargo({
      registrationNumber: 'MSZ859',
      palletCapacity: 5,
      hasSideDoor: false,
    })).toEqual({ palletCapacity: 5, hasSideDoor: false });
  });

  it('defaults unknown vehicles to 5 PLL', () => {
    expect(resolveVehicleCargo({
      registrationNumber: 'TST001',
      hasSideDoor: true,
    })).toEqual({ palletCapacity: 5, hasSideDoor: true });
    expect(resolveVehicleCargo(null)).toEqual({ palletCapacity: 5, hasSideDoor: false });
  });
});
