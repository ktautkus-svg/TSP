import { FallbackTravelCostProvider } from '@/infrastructure/routing/providers/fallback-travel-cost-provider';
import { GoogleTravelCostProvider, HereTravelCostProvider } from '@/infrastructure/routing/providers/gateway-travel-cost-provider';
import { PlanningRunTravelCostProvider } from '@/infrastructure/routing/providers/planning-run-travel-cost-provider';
import { SyntheticTravelCostProvider } from '@/infrastructure/routing/providers/synthetic-travel-cost-provider';
import type { TravelCostProvider } from '@/domain/routing/models';

export function syntheticFallbackAllowed(explicit = false): boolean {
  return explicit || process.env.EXPO_PUBLIC_ALLOW_SYNTHETIC_FALLBACK === '1';
}

/**
 * One planning run, one paid matrix.
 *
 * Synthetic is not chained unless the driver confirmed it or the explicit
 * development flag is on. Silent haversine routes look driveable and are
 * too easy to save under time pressure.
 */
export function createPlanningTravelProvider(options?: { allowSynthetic?: boolean }): TravelCostProvider {
  const selectedProvider = process.env.EXPO_PUBLIC_ROUTING_PROVIDER === 'here'
    ? new HereTravelCostProvider()
    : new GoogleTravelCostProvider();
  const chain = syntheticFallbackAllowed(options?.allowSynthetic)
    ? [selectedProvider, new SyntheticTravelCostProvider('linear')]
    : [selectedProvider];
  return new PlanningRunTravelCostProvider(new FallbackTravelCostProvider(chain));
}
