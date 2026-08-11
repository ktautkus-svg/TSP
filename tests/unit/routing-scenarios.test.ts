import { describe, expect, it } from 'vitest';

import { RoutingEngine } from '../../src/application/routing/routing-engine';
import { routingScenarios } from '../../src/domain/routing/scenarios';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

describe('deterministic routing scenario catalogue', () => {
  it('contains the 25 required edge cases and five Vilnius workdays', () => {
    expect(routingScenarios.length).toBeGreaterThanOrEqual(30);
    expect(routingScenarios.filter((scenario) => scenario.category === 'vilnius')).toHaveLength(5);
    expect(
      routingScenarios.filter((scenario) => scenario.category === 'recalculation').length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      routingScenarios
        .filter((scenario) => scenario.category === 'vilnius')
        .every((scenario) => Boolean(scenario.expectedDirectionComment)),
    ).toBe(true);
    expect(routingScenarios.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        'heavy-near',
        'heavy-far',
        'heavy-late-window',
        'light-early-required',
        'locked-position',
        'impossible-window',
        'workday-overrun',
        'full-tank-interval',
        'actual-faster',
        'actual-slower',
      ]),
    );
  });

  it(
    'keeps every recommended route permutation valid across all runnable scenarios',
    async () => {
      const engine = new RoutingEngine(new SyntheticTravelCostProvider('linear'));
      for (const scenario of routingScenarios) {
        const result = await engine.optimize(scenario.request);
        const candidate = result.recommended ?? result.diagnosticCandidate;
        expect(candidate, scenario.id).not.toBeNull();
        expect([...candidate!.stopSequence].sort(), scenario.id).toEqual(
          scenario.request.stops.map((stop) => stop.id).sort(),
        );
        expect(new Set(candidate!.stopSequence).size, scenario.id).toBe(
          scenario.request.stops.length,
        );
        expect(candidate!.legs[0].fromId, scenario.id).toBe(
          scenario.request.startLocation.id,
        );
        expect(candidate!.legs.at(-1)?.toId, scenario.id).toBe(
          scenario.request.endLocation.id,
        );
        const remainingLoads = candidate!.legs.map(
          (leg) => leg.remainingLoadKgAfterArrival,
        );
        expect(remainingLoads.every((load) => load >= 0), scenario.id).toBe(true);
        expect(
          remainingLoads.every(
            (load, index) => index === 0 || load <= remainingLoads[index - 1],
          ),
          scenario.id,
        ).toBe(true);
        expect(remainingLoads.at(-1), scenario.id).toBe(0);
        expect(candidate!.totalDistanceKm, scenario.id).toBeGreaterThanOrEqual(0);
        expect(candidate!.totalWorkMinutes, scenario.id).toBeGreaterThanOrEqual(0);
        expect(candidate!.tonneKilometers, scenario.id).toBeGreaterThanOrEqual(0);
        expect(
          Object.values(candidate!.rawScoreComponents).every(Number.isFinite),
          scenario.id,
        ).toBe(true);
      }
    },
    60_000,
  );

  it('uses distinct node IDs when a ring route returns to the same coordinates', () => {
    const scenario = routingScenarios.find((item) => item.id === 'vilnius-workday-2')!;
    expect(scenario.request.startLocation.latitude).toBe(scenario.request.endLocation.latitude);
    expect(scenario.request.startLocation.longitude).toBe(scenario.request.endLocation.longitude);
    expect(scenario.request.startLocation.id).not.toBe(scenario.request.endLocation.id);
    const ids = [
      scenario.request.startLocation.id,
      ...scenario.request.stops.map((stop) => stop.location.id),
      scenario.request.endLocation.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
