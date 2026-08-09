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

export function normalizeAndScoreCandidates(
  candidates: RouteCandidate[],
  config: RoutingScoringConfig,
): RouteCandidate[] {
  const feasible = candidates.filter((candidate) => candidate.feasible);
  const bounds = Object.fromEntries(
    SCORE_KEYS.map((key) => {
      const values = feasible.map((candidate) =>
        Math.min(candidate.rawScoreComponents[key], config.normalizationCaps[key]),
      );
      return [key, { min: Math.min(...values), max: Math.max(...values) }];
    }),
  ) as Record<RoutingScoreKey, { min: number; max: number }>;

  return candidates.map((candidate) => {
    validateComponents(candidate.rawScoreComponents);
    if (!candidate.feasible || feasible.length === 0) {
      return {
        ...candidate,
        normalizedScoreComponents: zeroComponents(),
        totalScore: null,
      };
    }
    const normalized = zeroComponents();
    for (const key of SCORE_KEYS) {
      const capped = Math.min(
        candidate.rawScoreComponents[key],
        config.normalizationCaps[key],
      );
      const { min, max } = bounds[key];
      normalized[key] = max === min ? 0 : (capped - min) / (max - min);
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
const LATENESS_BAND_MINUTES = 30;

function latenessBand(minutes: number): number {
  return Math.ceil(Math.max(0, minutes) / LATENESS_BAND_MINUTES);
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
  };
}

function validateComponents(components: RawScoreComponents): void {
  for (const key of SCORE_KEYS) {
    if (!Number.isFinite(components[key]) || components[key] < 0) {
      throw new Error(`Neteisinga scoring komponentė ${key}: ${components[key]}`);
    }
  }
}
