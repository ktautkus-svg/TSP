import type {
  CriticalRank,
  RawScoreComponents,
  RouteCandidate,
  RoutingScoreKey,
  RoutingScoringConfig,
} from '../models';

const SCORE_KEYS: RoutingScoreKey[] = [
  'drivingTime',
  'totalWorkTime',
  'distance',
  'tonneKilometers',
  'waitingTime',
  'informationalTimeMismatch',
  'directionality',
  'endLocationConvenience',
  'maneuvers',
  'userPreferences',
  'lateness',
];

export function cappedObjective(
  raw: RawScoreComponents,
  config: RoutingScoringConfig,
): number {
  validateComponents(raw);
  return SCORE_KEYS.reduce((sum, key) => {
    const cap = config.normalizationCaps[key];
    const normalized = cap > 0 ? Math.min(raw[key] / cap, 1) : 0;
    return sum + normalized * config.weights[key];
  }, 0);
}

/**
 * Scores every candidate against the FIXED normalization caps, never against
 * the spread of the current candidate pool.
 *
 * Min–max normalisation over the pool used to be used here, and it silently
 * rewrote the weight table: whichever criterion happened to have the widest
 * spread got the full 0..1 range and its nominal weight, while a criterion
 * where every candidate sat near its cap collapsed towards zero influence.
 * A single bad candidate (e.g. a random seed the time budget never got to
 * refine) stretched the distance axis far enough to make real kilometre
 * differences between sane routes almost invisible. Worse, local search
 * hill-climbs on `cappedObjective`, so ranking and search were optimising
 * two different functions and the search winner could lose the ranking.
 *
 * With absolute caps, `totalScore` equals `cappedObjective` exactly, the score
 * means the same thing between runs, and the pool composition no longer moves
 * the answer.
 */
export function normalizeAndScoreCandidates(
  candidates: RouteCandidate[],
  config: RoutingScoringConfig,
): RouteCandidate[] {
  return candidates.map((candidate) => {
    validateComponents(candidate.rawScoreComponents);
    if (!candidate.feasible) {
      return {
        ...candidate,
        normalizedScoreComponents: zeroComponents(),
        totalScore: null,
      };
    }
    const normalized = zeroComponents();
    for (const key of SCORE_KEYS) {
      const cap = config.normalizationCaps[key];
      normalized[key] = cap > 0 ? Math.min(candidate.rawScoreComponents[key] / cap, 1) : 0;
    }
    const totalScore = SCORE_KEYS.reduce(
      (sum, key) => sum + normalized[key] * config.weights[key],
      0,
    );
    return { ...candidate, normalizedScoreComponents: normalized, totalScore };
  });
}

export function compareCriticalRank(left: CriticalRank, right: CriticalRank): number {
  const leftTuple = criticalTuple(left);
  const rightTuple = criticalTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    const delta = leftTuple[index] - rightTuple[index];
    if (delta !== 0) return delta;
  }
  return 0;
}

export function compareCandidates(
  left: RouteCandidate,
  right: RouteCandidate,
  config: RoutingScoringConfig,
): number {
  if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
  const critical = compareCriticalRank(left.criticalRank, right.criticalRank);
  if (critical !== 0) return critical;

  const scoreDelta =
    (left.totalScore ?? cappedObjective(left.rawScoreComponents, config)) -
    (right.totalScore ?? cappedObjective(right.rawScoreComponents, config));
  if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;

  const durationDelta = left.totalWorkMinutes - right.totalWorkMinutes;
  if (Math.abs(durationDelta) > config.tolerances.durationMinutes) return durationDelta;
  const distanceDelta = left.totalDistanceKm - right.totalDistanceKm;
  if (Math.abs(distanceDelta) > config.tolerances.distanceKm) return distanceDelta;
  return left.stopSequence.join('|').localeCompare(right.stopSequence.join('|'));
}

// Time windows are a preference, not a hard rule: comparing raw lateness minute
// by minute let a geographically absurd sequence win purely because it shaved a
// couple of minutes off one window. Lateness is therefore compared in coarse
// bands, so only materially worse schedules outrank a sane, drivable route.
//
// `rank.totalLateMinutes` / `rank.maximumSingleStopLateMinutes` already hold
// per-stop excess-beyond-tolerance minutes (raw lateness minus the stop's
// latenessToleranceMinutes / priorityLatenessToleranceMinutes, floored at 0 —
// see constraint-evaluator.ts), so a value of 0 here means "within tolerance",
// not "exactly on time".
const LATENESS_BAND_MINUTES = 30;

function latenessBand(excessMinutes: number): number {
  return excessMinutes > 0 ? 1 + Math.floor(excessMinutes / LATENESS_BAND_MINUTES) : 0;
}

function criticalTuple(rank: CriticalRank): number[] {
  return [
    rank.unservedRequiredStops,
    latenessBand(rank.totalLateMinutes),
    latenessBand(rank.maximumSingleStopLateMinutes),
    rank.workdayOverrunMinutes,
    rank.criticalRoadOrVehicleViolations,
  ];
}

export function zeroComponents(): RawScoreComponents {
  return {
    drivingTime: 0,
    totalWorkTime: 0,
    distance: 0,
    tonneKilometers: 0,
    waitingTime: 0,
    informationalTimeMismatch: 0,
    directionality: 0,
    endLocationConvenience: 0,
    maneuvers: 0,
    userPreferences: 0,
    lateness: 0,
  };
}

function validateComponents(components: RawScoreComponents): void {
  for (const key of SCORE_KEYS) {
    if (!Number.isFinite(components[key]) || components[key] < 0) {
      throw new Error(`Neteisinga scoring komponentė ${key}: ${components[key]}`);
    }
  }
}
