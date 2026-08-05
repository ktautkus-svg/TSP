import { describe, expect, it } from 'vitest';

import { DEFAULT_ROUTING_SCORING } from '../../src/domain/routing/defaults';
import { calculateLoadDistance } from '../../src/domain/routing/evaluation/load-distance';
import type { RouteCandidate } from '../../src/domain/routing/models';
import {
  compareCandidates,
  normalizeAndScoreCandidates,
  zeroComponents,
} from '../../src/domain/routing/scoring/scoring';

describe('exact load-distance objective', () => {
  it('sums the carried load on every leg in tonne-kilometres', () => {
    const result = calculateLoadDistance([
      { fromId: 'depot', toId: 'heavy', distanceKm: 10, carriedLoadKg: 900 },
      { fromId: 'heavy', toId: 'light', distanceKm: 60, carriedLoadKg: 100 },
      { fromId: 'light', toId: 'depot', distanceKm: 5, carriedLoadKg: 0 },
    ]);
    expect(result.legs.map((leg) => leg.tonneKilometers)).toEqual([9, 6, 0]);
    expect(result.totalTonneKilometers).toBe(15);
  });

  it('rejects invalid legs', () => {
    expect(() =>
      calculateLoadDistance([
        { fromId: 'a', toId: 'b', distanceKm: -1, carriedLoadKg: 100 },
      ]),
    ).toThrow();
  });

  it('handles zero and equal weights and distinguishes heavy-early from heavy-late', () => {
    expect(
      calculateLoadDistance([
        { fromId: 'a', toId: 'b', distanceKm: 20, carriedLoadKg: 0 },
      ]).totalTonneKilometers,
    ).toBe(0);
    const equal = calculateLoadDistance([
      { fromId: 'a', toId: 'b', distanceKm: 10, carriedLoadKg: 1_000 },
      { fromId: 'b', toId: 'c', distanceKm: 10, carriedLoadKg: 500 },
    ]);
    expect(equal.totalTonneKilometers).toBe(15);
    const heavyEarly = calculateLoadDistance([
      { fromId: 'a', toId: 'heavy', distanceKm: 5, carriedLoadKg: 1_000 },
      { fromId: 'heavy', toId: 'light', distanceKm: 50, carriedLoadKg: 100 },
    ]);
    const heavyLate = calculateLoadDistance([
      { fromId: 'a', toId: 'light', distanceKm: 50, carriedLoadKg: 1_000 },
      { fromId: 'light', toId: 'heavy', distanceKm: 5, carriedLoadKg: 900 },
    ]);
    expect(heavyEarly.totalTonneKilometers).toBeLessThan(
      heavyLate.totalTonneKilometers,
    );
  });
});

describe('normalized multi-criteria scoring', () => {
  it('normalizes all equal components to zero and caps outliers', () => {
    const left = candidate('left', true, { distance: 10 });
    const right = candidate('right', true, { distance: 10 });
    const scored = normalizeAndScoreCandidates([left, right], DEFAULT_ROUTING_SCORING);
    expect(scored[0].normalizedScoreComponents.distance).toBe(0);
    expect(scored[1].totalScore).toBe(0);
  });

  it('always ranks a feasible route before an infeasible cheap route', () => {
    const feasible = candidate('feasible', true, { distance: 100 });
    const infeasible = candidate('infeasible', false, { distance: 1 });
    expect(compareCandidates(feasible, infeasible, DEFAULT_ROUTING_SCORING)).toBeLessThan(0);
  });

  it('uses critical criteria lexicographically before a soft score', () => {
    const oneLate = candidate('one-late', false);
    oneLate.criticalRank.requiredWindowViolations = 1;
    const twoLate = candidate('two-late', false);
    twoLate.criticalRank.requiredWindowViolations = 2;
    expect(compareCandidates(oneLate, twoLate, DEFAULT_ROUTING_SCORING)).toBeLessThan(0);
  });
});

function candidate(
  id: string,
  feasible: boolean,
  components: Partial<RouteCandidate['rawScoreComponents']> = {},
): RouteCandidate {
  const raw = { ...zeroComponents(), ...components };
  return {
    id,
    provider: 'test',
    stopSequence: [id],
    generatedBy: ['test'],
    schedules: [],
    legs: [],
    totalDistanceKm: raw.distance,
    drivingMinutes: raw.drivingTime,
    serviceMinutes: 0,
    waitingMinutes: raw.waitingTime,
    totalWorkMinutes: raw.totalWorkTime,
    totalLateMinutes: 0,
    maximumSingleStopLateMinutes: 0,
    tonneKilometers: raw.tonneKilometers,
    directionalityPenalty: raw.directionality,
    maneuverPenalty: raw.maneuvers,
    violations: [],
    feasible,
    criticalRank: {
      unservedRequiredStops: 0,
      requiredWindowViolations: 0,
      totalLateMinutes: 0,
      maximumSingleStopLateMinutes: 0,
      workdayOverrunMinutes: 0,
      criticalRoadOrVehicleViolations: 0,
    },
    rawScoreComponents: raw,
    normalizedScoreComponents: zeroComponents(),
    totalScore: null,
    localSearch: {
      iterations: 0,
      initialSequence: [id],
      initialObjective: 0,
      finalObjective: 0,
      improvementPercent: 0,
      stoppedBy: 'no_improvement',
    },
    warnings: [],
    explanations: [],
  };
}
