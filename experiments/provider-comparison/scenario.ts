import { routingScenarios } from '../../src/domain/routing/scenarios';

export const comparisonScenario = routingScenarios.find(
  (scenario) => scenario.id === 'vilnius-workday-2',
)!;
