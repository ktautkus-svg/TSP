import { describe, expect, it } from 'vitest';

import { vehicleLoadPercent } from '../../src/domain/vehicle-load';
import { describeVehicleLoad } from '../../src/ui/vehicle-load';

describe('vehicle load percent', () => {
  it('is route weight divided by the vehicle payload norm', () => {
    expect(vehicleLoadPercent(1000, 1500)).toBe(1000 / 1500 * 100);
    const load = describeVehicleLoad(1000, 1500);
    expect(load?.percentLabel).toBe('67%');
    expect(load?.overCapacity).toBe(false);
    expect(load?.ratioLabel).toMatch(/1\s?000 \/ 1\s?500 kg/);
    expect(load?.summaryLabel).toMatch(/^Apkrova 67%/);

  });

  it('flags cargo above the vehicle payload', () => {
    const load = describeVehicleLoad(1800, 1500);
    expect(load?.percent).toBe(120);
    expect(load?.overCapacity).toBe(true);
    expect(load?.percentLabel).toBe('120%');
  });

  it('is unavailable without a payload norm', () => {
    expect(vehicleLoadPercent(1000, 0)).toBeNull();
    expect(describeVehicleLoad(1000, null)).toBeNull();
    expect(describeVehicleLoad(-1, 1500)).toBeNull();
  });
});
