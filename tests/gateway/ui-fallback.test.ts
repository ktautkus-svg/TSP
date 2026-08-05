import { describe, expect, it } from 'vitest';
import type { MatrixRequest, TravelCostProvider } from '../../src/domain/routing/models';
import { FallbackTravelCostProvider } from '../../src/infrastructure/routing/providers/fallback-travel-cost-provider';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';
import { presentRoutingDataSource } from '../../src/ui/routing-data-source';
import { gatewayRequest } from './helpers';

describe('app provider fallback and source labels', () => {
  it('uses explicit synthetic fallback with a visible warning', async () => {
    const unavailable: TravelCostProvider = {
      name: 'HERE',
      getMatrix: async () => { throw new Error('gateway nepasiekiamas'); },
    };
    const provider = new FallbackTravelCostProvider([
      unavailable,
      new SyntheticTravelCostProvider('linear'),
    ]);
    const request = gatewayRequest();
    const matrixRequest: MatrixRequest = {
      locations: [request.startLocation, ...request.stops, request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.departureAt,
      trafficMode: 'live',
      timeoutMs: 1000,
    };
    const matrix = await provider.getMatrix(matrixRequest);
    expect(matrix.executionMode).toBe('synthetic');
    expect(matrix.warnings.join(' ')).toContain('atsarginis');
  });

  it('presents exactly the real, cache and synthetic states', () => {
    expect(presentRoutingDataSource({
      provider: 'HERE',
      executionMode: 'real',
      trafficMode: 'live',
    }).trafficLabel).toBe('Eismas įvertintas');
    expect(presentRoutingDataSource({
      provider: 'Google Routes',
      executionMode: 'cache',
      trafficMode: 'live',
    }).trafficLabel).toBe('Naudojami cache išsaugoti realūs duomenys');
    expect(presentRoutingDataSource({
      provider: 'synthetic:linear',
      executionMode: 'synthetic',
      trafficMode: 'synthetic',
    }).trafficLabel).toBe('Naudojami sintetiniai duomenys');
    expect(presentRoutingDataSource({
      provider: 'Google Routes',
      executionMode: 'real',
      trafficMode: 'none',
    }).trafficLabel).toBe('Eismas nevertintas');
  });
});
