import type { PlanningMode } from '@/domain/route';
import { evaluateCandidate } from '@/domain/routing/evaluation/candidate-evaluator';
import { repairHardOrdering } from '@/domain/routing/heuristics/generators';
import { normalizeAndScoreCandidates } from '@/domain/routing/scoring/scoring';
import { routeDiversity } from '@/application/routing/route-comparison';
import type {
  ExplanationEvidence,
  RouteCandidate,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  RouteOptimizer,
} from '@/domain/routing/models';

// The engine's own pick is followed by its explicit reverse and a real 2x2:
// each objective (fastest / shortest) is offered both with the delivery windows
// honoured and with them ignored. The reverse is deliberately kept as its own
// choice instead of hoping a mirror seed survives local search and ranking.
//
// `balanced` leads because the four objective picks are deliberate extremes —
// each one is an argmin on a single number. Without it nothing on the screen
// ever reflected the weighting (load, direction, priority stops, lateness) that
// the engine spends its whole search budget on.
export const ROUTE_ALTERNATIVE_MODES = [
  'balanced',
  'reversed_balanced',
  'free_fastest',
  'free_shortest',
  'timed_fastest',
  'timed_shortest',
] as const;

export type RouteAlternativeMode = (typeof ROUTE_ALTERNATIVE_MODES)[number];

export const ROUTE_ALTERNATIVE_LABELS: Record<
  RouteAlternativeMode,
  { title: string; group: string; objective: string; comment: string }
> = {
  balanced: {
    title: 'Subalansuotas',
    group: 'Rekomenduojama',
    objective: 'balanced',
    comment: 'Įvertinti kilometrai, laikas, kryptis, krovinio svoris ir prioritetiniai taškai.',
  },
  reversed_balanced: {
    title: 'Apverstas',
    group: 'Kita važiavimo kryptis',
    objective: 'reverse',
    comment: 'Subalansuoto maršruto sustojimai apversti; privalomos eiliškumo taisyklės išlaikomos.',
  },
  free_fastest: {
    title: 'Greičiausias',
    group: 'Nepaisant pristatymo laikų',
    objective: 'fastest',
    comment: 'Mažiausias vairavimo laikas, pristatymo laikai neapriboja eiliškumo.',
  },
  free_shortest: {
    title: 'Trumpiausias',
    group: 'Nepaisant pristatymo laikų',
    objective: 'shortest',
    comment: 'Mažiausias kilometražas, pristatymo laikai neapriboja eiliškumo.',
  },
  timed_fastest: {
    title: 'Greičiausias',
    group: 'Pagal pristatymo laikus',
    objective: 'fastest',
    comment: 'Greičiausias variantas, derinamas prie nurodytų pristatymo laikų.',
  },
  timed_shortest: {
    title: 'Trumpiausias',
    group: 'Pagal pristatymo laikus',
    objective: 'shortest',
    comment: 'Trumpiausias variantas, derinamas prie nurodytų pristatymo laikų.',
  },
};

export type LabeledRouteAlternative = {
  mode: RouteAlternativeMode;
  title: string;
  group: string;
  comment: string;
  candidate: RouteCandidate;
};

export type FourObjectiveAlternatives = {
  labeled: LabeledRouteAlternative[];
  result: RouteOptimizationResult;
  /** Request used for map labels / manual reorder (windows off — schedules already baked into candidates). */
  request: RouteOptimizationRequest;
};

export type RouteObjective = 'fastest' | 'shortest';

/**
 * Shares one screen-level time budget across `runs` engine calls. Never drops
 * below a single seed's budget, so short routes are unaffected.
 */
function splitTotalBudget(
  request: RouteOptimizationRequest,
  runs: number,
): RouteOptimizationRequest {
  const total = request.maxTotalCalculationMs ?? request.maxCalculationMs * 3;
  return {
    ...request,
    maxTotalCalculationMs: Math.max(request.maxCalculationMs, Math.round(total / runs)),
  };
}

/**
 * Rebuild a request so required windows match the chosen planning mode.
 *
 * The timed variant used to promote EVERY informational window to a required
 * one, which made the two modes all-or-nothing: the same delivery times the
 * driver typed either dictated the whole route or did not exist. A window is
 * now only binding if it was marked required at import (both "from" and "to"
 * given). The rest still shape the plan — `evaluateCandidate` models the wait
 * at the door and charges `informationalTimeMismatch` for missing them — but
 * they never generate lateness or a violation.
 */
export function requestForPlanningMode(
  request: RouteOptimizationRequest,
  planningMode: PlanningMode,
): RouteOptimizationRequest {
  return {
    ...request,
    planningMode,
    stops: request.stops.map((stop) => ({
      ...stop,
      requiredTimeWindow:
        planningMode === 'with_time_windows' ? stop.requiredTimeWindow : undefined,
    })),
  };
}

export function requestForObjective(
  request: RouteOptimizationRequest,
  objective: RouteObjective,
): RouteOptimizationRequest {
  const primaryKey = objective === 'fastest' ? 'drivingTime' : 'distance';
  const weights = { ...request.scoring.weights };
  const secondaryWeightTotal = Object.entries(weights)
    .filter(([key]) => key !== primaryKey)
    .reduce((sum, [, weight]) => sum + weight, 0);
  for (const key of Object.keys(weights) as (keyof typeof weights)[]) {
    weights[key] = key === primaryKey
      ? 0.8
      : secondaryWeightTotal > 0 ? (weights[key] / secondaryWeightTotal) * 0.2 : 0;
  }
  return {
    ...request,
    scoring: {
      ...request.scoring,
      weights,
      normalizationCaps: { ...request.scoring.normalizationCaps },
      tolerances: { ...request.scoring.tolerances },
    },
  };
}

const byFastest = (left: RouteCandidate, right: RouteCandidate) =>
  left.drivingMinutes - right.drivingMinutes
  || left.totalWorkMinutes - right.totalWorkMinutes
  || left.totalDistanceKm - right.totalDistanceKm;

const byShortest = (left: RouteCandidate, right: RouteCandidate) =>
  left.totalDistanceKm - right.totalDistanceKm
  || left.drivingMinutes - right.drivingMinutes
  || left.totalWorkMinutes - right.totalWorkMinutes;

export function selectRouteAlternatives(
  timed: RouteOptimizationResult,
  geo: RouteOptimizationResult,
  request: RouteOptimizationRequest,
  objectiveResults?: ObjectiveResults,
): LabeledRouteAlternative[] {
  const planningMode = request.planningMode;
  const timedFallback =
    timed.recommended ?? timed.diagnosticCandidate ?? firstFeasible(timed.candidates) ?? timed.candidates[0];
  const geoFallback =
    geo.recommended ?? geo.diagnosticCandidate ?? firstFeasible(geo.candidates) ?? geo.candidates[0];
  if (!timedFallback || !geoFallback) {
    throw new Error('Nepavyko sudaryti keturių maršruto variantų.');
  }

  const timedPool = poolForObjective(timed);
  const geoPool = poolForObjective(geo);

  const freeFastest = pickBest(
    objectiveResults ? poolForObjective(objectiveResults.geoFastest) : geoPool,
    byFastest,
  ) ?? geoFallback;
  const freeShortest = pickBest(
    objectiveResults ? poolForObjective(objectiveResults.geoShortest) : geoPool,
    byShortest,
  ) ?? geoFallback;
  const timedFastest = pickBest(
    objectiveResults ? poolForObjective(objectiveResults.timedFastest) : timedPool,
    byFastest,
  ) ?? timedFallback;
  const timedShortest = pickBest(
    objectiveResults ? poolForObjective(objectiveResults.timedShortest) : timedPool,
    byShortest,
  ) ?? timedFallback;

  // The balanced pick comes from the run that matches how the route is planned,
  // so it answers the same question the driver set up rather than a second one.
  const balancedRun = planningMode === 'with_time_windows' ? timed : geo;
  const balanced =
    balancedRun.recommended
    ?? (planningMode === 'with_time_windows' ? timedFallback : geoFallback);
  const reversedRequest = requestForPlanningMode(request, planningMode);
  const stopById = new Map(reversedRequest.stops.map((stop) => [stop.id, stop]));
  const reversedSequence = repairHardOrdering([...balanced.stopSequence].reverse(), stopById);
  const reversed = normalizeAndScoreCandidates([
    evaluateCandidate({
      stopSequence: reversedSequence,
      generatedBy: ['explicit_reverse', `reverse_of:${balanced.id}`],
      request: reversedRequest,
      matrix: balancedRun.matrix,
    }),
  ], reversedRequest.scoring)[0]!;

  const picks: {
    mode: RouteAlternativeMode;
    candidate: RouteCandidate;
    duplicateWinner: boolean;
    alternateShown: boolean;
  }[] = [
    { mode: 'balanced', candidate: balanced, duplicateWinner: false, alternateShown: false },
    { mode: 'reversed_balanced', candidate: reversed, duplicateWinner: false, alternateShown: false },
    { mode: 'free_fastest', candidate: freeFastest, duplicateWinner: false, alternateShown: false },
    {
      mode: 'free_shortest',
      candidate: freeShortest,
      duplicateWinner: sameSequence(freeFastest, freeShortest),
      alternateShown: false,
    },
    { mode: 'timed_fastest', candidate: timedFastest, duplicateWinner: false, alternateShown: false },
    {
      mode: 'timed_shortest',
      candidate: timedShortest,
      duplicateWinner: sameSequence(timedFastest, timedShortest),
      alternateShown: false,
    },
  ];

  const labeled = picks.map(({ mode, candidate, duplicateWinner, alternateShown }) => {
    const label = ROUTE_ALTERNATIVE_LABELS[mode];
    const duplicateComment = duplicateWinner
      ? alternateShown
        ? 'Absoliučiai trumpiausias sutampa su greičiausiu; rodoma artimiausia skirtinga seka pagal atstumą.'
        : 'Tas pats eiliškumas pagal turimą kelių matricą yra ir greičiausias, ir trumpiausias.'
      : label.comment;
    return {
      mode,
      ...label,
      title: label.title,
      comment: duplicateComment,
      candidate: stampMode(candidate, mode, duplicateComment),
    };
  });

  const distinct: LabeledRouteAlternative[] = [];
  for (const item of labeled) {
    const sameRoute = distinct.find((existing) => sameSequence(existing.candidate, item.candidate));
    if (sameRoute) {
      sameRoute.title = `${sameRoute.title} = ${item.title}`;
      sameRoute.comment = `Tas pats įvertintas sustojimų eiliškumas atitinka: ${sameRoute.title}. ${sameRoute.comment}`;
      continue;
    }
    const nearEquivalent = item.mode === 'reversed_balanced'
      ? undefined
      : distinct.find((existing) =>
      routeDiversity(existing.candidate, item.candidate) < 0.12
      && Math.abs(existing.candidate.totalWorkMinutes - item.candidate.totalWorkMinutes)
        < Math.max(5, existing.candidate.totalWorkMinutes * 0.05)
      && Math.abs(existing.candidate.totalDistanceKm - item.candidate.totalDistanceKm)
        < Math.max(2, existing.candidate.totalDistanceKm * 0.05),
      );
    if (nearEquivalent) {
      nearEquivalent.comment = `${nearEquivalent.comment} ${item.title} beveik nesiskiria, todėl atskiras pasiūlymas nerodomas.`;
      continue;
    }
    distinct.push(item);
  }
  return distinct;
}

/**
 * Runs the engine twice (honour windows vs ignore) and returns the labeled
 * picks ready for the alternatives screen: the engine's balanced recommendation
 * first, then four single-objective extremes to compare it against.
 */
export async function buildRouteAlternatives(
  engine: RouteOptimizer,
  request: RouteOptimizationRequest,
): Promise<FourObjectiveAlternatives> {
  // Two engine runs share the screen's budget instead of each taking a full one,
  // so opening the alternatives screen costs the same wall-clock time as planning.
  const halved = splitTotalBudget(request, 2);
  const timedRequest = requestForPlanningMode(halved, 'with_time_windows');
  const geoRequest = requestForPlanningMode(halved, 'ignore_time_windows');
  const [timed, geo] = await Promise.all([
    engine.optimize(timedRequest),
    engine.optimize(geoRequest),
  ]);
  const objectiveBudget = {
    maxCalculationMs: Math.min(600, halved.maxCalculationMs),
    maxTotalCalculationMs: Math.min(600, halved.maxTotalCalculationMs ?? halved.maxCalculationMs * 3),
  };
  const [timedFastest, timedShortest, geoFastest, geoShortest] = await Promise.all([
    engine.optimize(requestForObjective({ ...timedRequest, ...objectiveBudget }, 'fastest'), timed.matrix),
    engine.optimize(requestForObjective({ ...timedRequest, ...objectiveBudget }, 'shortest'), timed.matrix),
    engine.optimize(requestForObjective({ ...geoRequest, ...objectiveBudget }, 'fastest'), geo.matrix),
    engine.optimize(requestForObjective({ ...geoRequest, ...objectiveBudget }, 'shortest'), geo.matrix),
  ]);
  const labeled = selectRouteAlternatives(timed, geo, request, {
    timedFastest,
    timedShortest,
    geoFastest,
    geoShortest,
  });
  const candidates = labeled.map((item) => item.candidate);
  // The balanced pick is what the driver gets unless he deliberately reaches for
  // an extreme, so it is also what the screen preselects.
  const recommended =
    labeled.find((item) => item.mode === 'balanced')?.candidate
    ?? candidates[0]
    ?? null;

  const generatedAt = new Date().toISOString();
  const result: RouteOptimizationResult = {
    requestId: `${request.routeId}-alt-${generatedAt}`,
    provider: geo.provider || timed.provider,
    executionMode: geo.executionMode,
    generatedAt,
    matrixFetchedAt: geo.matrixFetchedAt || timed.matrixFetchedAt,
    matrix: geo.matrix,
    feasibleRouteFound: candidates.some((candidate) => candidate.feasible),
    recommended,
    alternatives: candidates.filter((candidate) => candidate.id !== recommended?.id),
    diagnosticCandidate: recommended ? null : candidates[0] ?? null,
    candidates,
    conflictingConstraints: [
      ...timed.conflictingConstraints,
      ...geo.conflictingConstraints,
    ],
    suggestions: [...new Set([...timed.suggestions, ...geo.suggestions])],
    warnings: [...new Set([...timed.warnings, ...geo.warnings])],
  };

  return { labeled, result, request: geoRequest };
}

type ObjectiveResults = {
  timedFastest: RouteOptimizationResult;
  timedShortest: RouteOptimizationResult;
  geoFastest: RouteOptimizationResult;
  geoShortest: RouteOptimizationResult;
};

function poolForObjective(result: RouteOptimizationResult): RouteCandidate[] {
  const feasible = result.candidates.filter((candidate) => candidate.feasible);
  return feasible.length > 0 ? feasible : result.candidates;
}

function firstFeasible(candidates: RouteCandidate[]): RouteCandidate | undefined {
  return candidates.find((candidate) => candidate.feasible);
}

function pickBest(
  pool: RouteCandidate[],
  compare: (left: RouteCandidate, right: RouteCandidate) => number,
): RouteCandidate | null {
  if (pool.length === 0) return null;
  return [...pool].sort(compare)[0] ?? null;
}

function sameSequence(left: RouteCandidate, right: RouteCandidate): boolean {
  return left.stopSequence.length === right.stopSequence.length
    && left.stopSequence.every((stopId, index) => stopId === right.stopSequence[index]);
}

function stampMode(candidate: RouteCandidate, mode: RouteAlternativeMode, comment = ROUTE_ALTERNATIVE_LABELS[mode].comment): RouteCandidate {
  const label = ROUTE_ALTERNATIVE_LABELS[mode];
  // The balanced pick already carries the engine's real explanations (why this
  // sequence beat the baseline on load, direction, windows). Prefixing a canned
  // line would bury them.
  if (mode === 'balanced') {
    return {
      ...candidate,
      id: `${candidate.id}:${mode}`,
      generatedBy: [...new Set([...candidate.generatedBy, `objective:${mode}`])],
    };
  }
  const honoursWindows = mode.startsWith('timed_');
  const isShortest = label.objective === 'shortest';
  const isReverse = mode === 'reversed_balanced';
  const explanation: ExplanationEvidence = {
    code: isReverse ? 'MIRROR_ROUTE' : honoursWindows ? 'REQUIRED_WINDOW' : isShortest ? 'LOWER_TONNE_KM' : 'LONGER_BUT_FASTER',
    text: comment,
    criterion: isReverse ? 'directionality' : isShortest ? 'distance' : 'drivingTime',
    baselineValue: null,
    selectedValue: `${label.group} · ${label.title}`,
    difference: null,
    dataSource: `objective:${mode}`,
    relatedStopIds: [],
  };
  return {
    ...candidate,
    id: `${candidate.id}:${mode}`,
    generatedBy: [...new Set([...candidate.generatedBy, `objective:${mode}`])],
    explanations: [explanation, ...candidate.explanations],
  };
}
