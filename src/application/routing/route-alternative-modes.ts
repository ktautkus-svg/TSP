import type { PlanningMode } from '@/domain/route';
import type {
  ExplanationEvidence,
  RouteCandidate,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  RouteOptimizer,
} from '@/domain/routing/models';

// A real 2x2: each objective (fastest / shortest) is offered both with the
// delivery windows honoured and with them ignored, so the driver compares like
// with like instead of four picks that can collapse onto the same sequence.
export const ROUTE_ALTERNATIVE_MODES = [
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
  free_fastest: {
    title: 'Greičiausias',
    group: 'Nepaisant laiko langų',
    objective: 'fastest',
    comment: 'Mažiausias vairavimo laikas, langai ignoruojami.',
  },
  free_shortest: {
    title: 'Trumpiausias',
    group: 'Nepaisant laiko langų',
    objective: 'shortest',
    comment: 'Mažiausias kilometražas, langai ignoruojami.',
  },
  timed_fastest: {
    title: 'Greičiausias',
    group: 'Pagal laiko langus',
    objective: 'fastest',
    comment: 'Greičiausias variantas, kuris dar taikosi į langus.',
  },
  timed_shortest: {
    title: 'Trumpiausias',
    group: 'Pagal laiko langus',
    objective: 'shortest',
    comment: 'Trumpiausias variantas, kuris dar taikosi į langus.',
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

/** Rebuild a request so required windows match the chosen planning mode. */
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
        planningMode === 'with_time_windows'
          ? stop.requiredTimeWindow ?? stop.informationalTimeWindow
          : undefined,
    })),
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

export function selectFourObjectiveAlternatives(
  timed: RouteOptimizationResult,
  geo: RouteOptimizationResult,
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

  const picks: Array<{ mode: RouteAlternativeMode; candidate: RouteCandidate; duplicateWinner: boolean; alternateShown: boolean }> = [
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
 * Runs the engine twice (honour windows vs ignore) and returns four labeled,
 * clearly different objective picks ready for the alternatives screen.
 */
export async function buildFourObjectiveAlternatives(
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
  const labeled = selectFourObjectiveAlternatives(timed, geo);
  const candidates = labeled.map((item) => item.candidate);
  const defaultMode: RouteAlternativeMode =
    request.planningMode === 'with_time_windows' ? 'timed_fastest' : 'free_fastest';
  const recommended =
    labeled.find((item) => item.mode === defaultMode)?.candidate
    ?? candidates[0]
    ?? null;

  const generatedAt = new Date().toISOString();
  const result: RouteOptimizationResult = {
    requestId: `${request.routeId}-four-${generatedAt}`,
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
