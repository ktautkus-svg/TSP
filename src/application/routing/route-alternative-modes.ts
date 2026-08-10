import type { PlanningMode } from '@/domain/route';
import type {
  ExplanationEvidence,
  RouteCandidate,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  RouteOptimizer,
} from '@/domain/routing/models';

export const ROUTE_ALTERNATIVE_MODES = [
  'fastest',
  'shortest',
  'with_time_windows',
  'ignore_time_windows',
] as const;

export type RouteAlternativeMode = (typeof ROUTE_ALTERNATIVE_MODES)[number];

export const ROUTE_ALTERNATIVE_LABELS: Record<
  RouteAlternativeMode,
  { title: string; comment: string }
> = {
  fastest: {
    title: 'Greičiausias',
    comment: 'Mažiausias vairavimo laikas — kuo greičiau baigti važiavimą.',
  },
  shortest: {
    title: 'Trumpiausias',
    comment: 'Mažiausias kilometražas — taupo kelią, net jei užtrunka ilgiau.',
  },
  with_time_windows: {
    title: 'Pagal laiką',
    comment: 'Atsižvelgia į pristatymo langus — stengiasi spėti į sutartus laikus.',
  },
  ignore_time_windows: {
    title: 'Ne pagal laiką',
    comment: 'Langų nepaiso — geografiškai tvarkingas eiliškumas be laukimo dėl langų.',
  },
};

export type LabeledRouteAlternative = {
  mode: RouteAlternativeMode;
  title: string;
  comment: string;
  candidate: RouteCandidate;
};

export type FourObjectiveAlternatives = {
  labeled: LabeledRouteAlternative[];
  result: RouteOptimizationResult;
  /** Request used for map labels / manual reorder (windows off — schedules already baked into candidates). */
  request: RouteOptimizationRequest;
};

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

export function selectFourObjectiveAlternatives(
  timed: RouteOptimizationResult,
  geo: RouteOptimizationResult,
): LabeledRouteAlternative[] {
  const timedPick =
    timed.recommended ?? timed.diagnosticCandidate ?? firstFeasible(timed.candidates) ?? timed.candidates[0];
  const geoPick =
    geo.recommended ?? geo.diagnosticCandidate ?? firstFeasible(geo.candidates) ?? geo.candidates[0];
  if (!timedPick || !geoPick) {
    throw new Error('Nepavyko sudaryti keturių maršruto variantų.');
  }

  const geoPool = poolForObjective(geo);

  const withTime = stampMode(timedPick, 'with_time_windows');
  const ignoreTime = stampMode(geoPick, 'ignore_time_windows');

  const fastestRaw = pickBest(
    geoPool,
    (left, right) =>
      left.drivingMinutes - right.drivingMinutes
      || left.totalWorkMinutes - right.totalWorkMinutes
      || left.totalDistanceKm - right.totalDistanceKm,
  ) ?? geoPick;

  const shortestRaw = pickBest(
    geoPool,
    (left, right) =>
      left.totalDistanceKm - right.totalDistanceKm
      || left.drivingMinutes - right.drivingMinutes
      || left.totalWorkMinutes - right.totalWorkMinutes,
  ) ?? geoPick;

  return [
    {
      mode: 'fastest',
      ...ROUTE_ALTERNATIVE_LABELS.fastest,
      candidate: stampMode(fastestRaw, 'fastest'),
    },
    {
      mode: 'shortest',
      ...ROUTE_ALTERNATIVE_LABELS.shortest,
      candidate: stampMode(shortestRaw, 'shortest'),
    },
    {
      mode: 'with_time_windows',
      ...ROUTE_ALTERNATIVE_LABELS.with_time_windows,
      candidate: withTime,
    },
    {
      mode: 'ignore_time_windows',
      ...ROUTE_ALTERNATIVE_LABELS.ignore_time_windows,
      candidate: ignoreTime,
    },
  ];
}

/**
 * Runs the engine twice (honour windows vs ignore) and returns four labeled,
 * clearly different objective picks ready for the alternatives screen.
 */
export async function buildFourObjectiveAlternatives(
  engine: RouteOptimizer,
  request: RouteOptimizationRequest,
): Promise<FourObjectiveAlternatives> {
  const timedRequest = requestForPlanningMode(request, 'with_time_windows');
  const geoRequest = requestForPlanningMode(request, 'ignore_time_windows');
  const [timed, geo] = await Promise.all([
    engine.optimize(timedRequest),
    engine.optimize(geoRequest),
  ]);
  const labeled = selectFourObjectiveAlternatives(timed, geo);
  const candidates = labeled.map((item) => item.candidate);
  const defaultMode: RouteAlternativeMode =
    request.planningMode === 'with_time_windows'
    || request.stops.some((stop) => Boolean(stop.requiredTimeWindow || stop.informationalTimeWindow))
      ? 'with_time_windows'
      : 'fastest';
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

function stampMode(candidate: RouteCandidate, mode: RouteAlternativeMode): RouteCandidate {
  const label = ROUTE_ALTERNATIVE_LABELS[mode];
  const explanation: ExplanationEvidence = {
    code: mode === 'with_time_windows'
      ? 'REQUIRED_WINDOW'
      : mode === 'shortest'
        ? 'LOWER_TONNE_KM'
        : mode === 'fastest'
          ? 'LONGER_BUT_FASTER'
          : 'LESS_BACKTRACKING',
    text: label.comment,
    criterion: mode === 'with_time_windows'
      ? 'feasibility'
      : mode === 'shortest'
        ? 'distance'
        : mode === 'fastest'
          ? 'drivingTime'
          : 'directionality',
    baselineValue: null,
    selectedValue: label.title,
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
