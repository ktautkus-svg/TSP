import type { ProviderExecutionMode, TrafficMode } from '@/domain/routing/models';

export type RoutingDataSourcePresentation = {
  title: string;
  trafficLabel:
    | 'Eismas įvertintas'
    | 'Eismas nevertintas'
    | 'Naudojami sintetiniai duomenys'
    | 'Naudojami cache išsaugoti realūs duomenys';
  isLive: boolean;
};

export function presentRoutingDataSource(input: {
  provider: string;
  executionMode: ProviderExecutionMode;
  trafficMode: TrafficMode;
}): RoutingDataSourcePresentation {
  const trafficWasEvaluated =
    (input.executionMode === 'real' || input.executionMode === 'cache') &&
    (input.trafficMode === 'live' || input.trafficMode === 'historical');
  if (input.executionMode === 'cache') {
    return {
      title: `${friendlyProvider(input.provider)} realūs duomenys iš cache`,
      trafficLabel: 'Naudojami cache išsaugoti realūs duomenys',
      isLive: false,
    };
  }
  if (input.executionMode === 'real') {
    return {
      title: `${friendlyProvider(input.provider)} realūs duomenys`,
      trafficLabel: trafficWasEvaluated ? 'Eismas įvertintas' : 'Eismas nevertintas',
      isLive: trafficWasEvaluated,
    };
  }
  return {
    title: 'Sintetinis demonstracinis režimas',
    trafficLabel: 'Naudojami sintetiniai duomenys',
    isLive: false,
  };
}

function friendlyProvider(provider: string): string {
  const normalized = provider.toLowerCase();
  if (normalized.includes('here')) return 'HERE';
  if (normalized.includes('google')) return 'Google';
  return provider;
}
