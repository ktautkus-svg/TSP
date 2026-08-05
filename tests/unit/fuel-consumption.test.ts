import { describe, expect, it } from 'vitest';

import { calculateFullTankConsumption } from '../../src/application/services/fuel-consumption';

describe('full-to-full fuel consumption', () => {
  it('includes partial fills between two full tanks', () => {
    const result = calculateFullTankConsumption(
      [
        { id: 'start', odometer: 1_000, liters: 50, fullTank: true },
        { id: 'partial-1', odometer: 1_100, liters: 20, fullTank: false },
        { id: 'partial-2', odometer: 1_200, liters: 15, fullTank: false },
        { id: 'end', odometer: 1_300, liters: 25, fullTank: true },
      ],
      13,
    );

    expect(result.reliable).toBe(true);
    if (result.reliable) {
      expect(result.distanceKm).toBe(300);
      expect(result.actualLiters).toBe(60);
      expect(result.actualLPer100Km).toBe(20);
      expect(result.normativeLiters).toBe(39);
      expect(result.savingLiters).toBe(-21);
    }
  });

  it('does not claim exact consumption without a closing full tank', () => {
    expect(
      calculateFullTankConsumption(
        [
          { id: 'start', odometer: 1_000, liters: 50, fullTank: true },
          { id: 'partial', odometer: 1_100, liters: 20, fullTank: false },
        ],
        13,
      ),
    ).toEqual({
      reliable: false,
      reason: 'NEED_TWO_FULL_TANKS',
      recordedLiters: 70,
    });
  });

  it('rejects a decreasing odometer sequence', () => {
    const result = calculateFullTankConsumption(
      [
        { id: 'start', odometer: 1_000, liters: 50, fullTank: true },
        { id: 'partial', odometer: 999, liters: 10, fullTank: false },
        { id: 'end', odometer: 1_100, liters: 20, fullTank: true },
      ],
      13,
    );

    expect(result).toMatchObject({ reliable: false, reason: 'INVALID_ODOMETER_SEQUENCE' });
  });
});
