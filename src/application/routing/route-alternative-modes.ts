import type { PlanningMode } from '@/domain/route';
import type {
  ExplanationEvidence,
  RouteCandidate,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  RouteOptimizer,
} from '@/domain/routing/models';

// The engine's own pick, followed by a real 2x2: each objective (fastest /
// shortest) is offered both with the delivery windows honoured and with them
// ignored, so the driver compares like with like instead of picks that can
// collapse onto the same sequence.
//
// `balanced` leads because the four objective picks are deliberate extremes —
// each one is an argmin on a single number. Without it nothing on the screen
// ever reflected the weighting (load, direction, priority stops, lateness) that
// the engine spends its whole search budget on.
export const ROUTE_ALTERNATIVE_MODES = [
  'balanced',
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

// "Fastest" is when the driver gets to go home, not how many minutes the engine
// was turning. Sorting on drivingMinutes alone ignored waiting, so with time
// windows on, the card labelled Greičiausias could finish 24 minutes after the
// card next to it (measured on a 16-stop route: 92 driving / 416 total against
// 95 driving / 392 total).
const byFastest = (left: RouteCandidate, right: RouteCandidate) =>
  left.totalWorkMinutes - right.totalWorkMinutes
  || left.drivingMinutes - right.drivingMinutes
  || left.totalDistanceKm - right.totalDistanceKm;

const byShortest = (left: RouteCandidate, right: RouteCandidate) =>
  left.totalDistanceKm - right.totalDistanceKm
  || left.drivingMinutes - right.drivingMinutes
  || left.totalWorkMinutes - right.totalWorkMinutes;

export function selectRouteAlternatives(
  timed: RouteOptimizationResult,
  geo: RouteOptimizationResult,
  planningMode: PlanningMode,
): LabeledRouteAlternative[] {
  const timedFallback =
    timed.recommended ?? timed.diagnosticCandidate ?? firstFeasible(timed.candidates) ?? timed.candidates[0];
  const geoFallback =
    geo.recommended ?? geo.diagnosticCandidate ?? firstFeasible(geo.candidates) ?? geo.candidates[0];
  if (!timedFallback || !geoFallback) {
    throw new Error('Nepavyko sudaryti keturių maršruto variantų.');
  }

  const timedPool = poolForObjective(timed);
  const geoPool = poolForObjective(geo);

  const freeFastest = pickBest(geoPool, byFastest) ?? geoFallback;
  const absoluteFreeShortest = pickBest(geoPool, byShortest) ?? geoFallback;
  const freeShortestAlternative = sameSequence(freeFastest, absoluteFreeShortest)
    ? pickBestDistinct(geoPool, byShortest, freeFastest)
    : absoluteFreeShortest;
  const timedFastest = pickBest(timedPool, byFastest) ?? timedFallback;
  const absoluteTimedShortest = pickBest(timedPool, byShortest) ?? timedFallback;
  const timedShortestAlternative = sameSequence(timedFastest, absoluteTimedShortest)
    ? pickBestDistinct(timedPool, byShortest, timedFastest)
    : absoluteTimedShortest;

  // The balanced pick comes from the run that matches how the route is planned,
  // so it answers the same question the driver set up rather than a second one.
  const balancedRun = planningMode === 'with_time_windows' ? timed : geo;
  const balanced =
    balancedRun.recommended
    ?? (planningMode === 'with_time_windows' ? timedFallback : geoFallback);

  const picks: {
    mode: RouteAlternativeMode;
    candidate: RouteCandidate;
    duplicateWinner: boolean;
    alternateShown: boolean;
  }[] = [
    { mode: 'balanced', candidate: balanced, duplicateWinner: false, alternateShown: false },
    { mode: 'free_fastest', candidate: freeFastest, duplicateWinner: false, alternateShown: false },
    {
      mode: 'free_shortest',
      candidate: freeShortestAlternative ?? absoluteFreeShortest,
      duplicateWinner: sameSequence(freeFastest, absoluteFreeShortest),
      alternateShown: Boolean(freeShortestAlternative),
    },
    { mode: 'timed_fastest', candidate: timedFastest, duplicateWinner: false, alternateShown: false },
    {
      mode: 'timed_shortest',
      candidate: timedShortestAlternative ?? absoluteTimedShortest,
      duplicateWinner: sameSequence(timedFastest, absoluteTimedShortest),
      alternateShown: Boolean(timedShortestAlternative),
    },
  ];

  return picks.map(({ mode, candidate, duplicateWinner, alternateShown }) => {
    const label = ROUTE_ALTERNATIVE_LABELS[mode];
    const duplicateComment = duplicateWinner
      ? alternateShown
        ? 'Absoliučiai trumpiausias sutampa su greičiausiu; rodoma artimiausia skirtinga seka pagal atstumą.'
        : 'Tas pats eiliškumas pagal turimą kelių matricą yra ir greičiausias, ir trumpiausias.'
      : label.comment;
    return {
      mode,
      ...label,
      title: duplicateWinner ? (alternateShown ? 'Kitas trumpiausias' : 'Trumpiausias = greičiausias') : label.title,
      comment: duplicateComment,
      candidate: stampMode(candidate, mode, duplicateComment),
    };
  });
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
  const planningMode = request.planningMode;
  const labeled = selectRouteAlternatives(timed, geo, planningMode);
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

function pickBestDistinct(
  pool: RouteCandidate[],
  compare: (left: RouteCandidate, right: RouteCandidate) => number,
  excluded: RouteCandidate,
): RouteCandidate | null {
  return pickBest(pool.filter((candidate) => !sameSequence(candidate, excluded)), compare);
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
  const explanation: ExplanationEvidence = {
    code: honoursWindows ? 'REQUIRED_WINDOW' : isShortest ? 'LOWER_TONNE_KM' : 'LONGER_BUT_FASTER',
    text: comment,
    criterion: isShortest ? 'distance' : 'drivingTime',
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
