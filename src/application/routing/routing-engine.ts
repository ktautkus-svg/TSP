import { buildExplanations, routeDiversity } from './route-comparison';
import { generateHeuristicSeeds } from '@/domain/routing/heuristics/generators';
import { improveWithLocalSearch } from '@/domain/routing/heuristics/local-search';
import {
  compareCandidates,
  normalizeAndScoreCandidates,
} from '@/domain/routing/scoring/scoring';
import type {
  ConstraintViolation,
  RouteCandidate,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  RouteOptimizer,
  TravelCostProvider,
} from '@/domain/routing/models';
import { summarizeStopWeights } from '@/domain/routing/weights';

export class RoutingEngine implements RouteOptimizer {
  constructor(private readonly travelCostProvider: TravelCostProvider) {}

  async optimize(request: RouteOptimizationRequest): Promise<RouteOptimizationResult> {
    validateRequest(request);
    const matrix = await this.travelCostProvider.getMatrix({
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: request.trafficMode,
      timeoutMs: Math.max(1_000, request.maxCalculationMs * 2),
    });
    const seeds = generateHeuristicSeeds(request, matrix);
    // One shared wall-clock budget for all seeds. Without it the cost is
    // seedCount x maxCalculationMs of blocked JS thread, which on a phone means
    // the driver watches a frozen screen while a route is planned.
    const deadlineAt =
      performance.now() + (request.maxTotalCalculationMs ?? request.maxCalculationMs * 3);
    const improved = seeds.map((seed) =>
      improveWithLocalSearch({
        sequence: seed.sequence,
        generatedBy: seed.generatedBy,
        request,
        matrix,
        deadlineAt,
      }),
    );
    const deduplicated = refinedOnly(deduplicate(improved, request));
    const scored = normalizeAndScoreCandidates(deduplicated, request.scoring).sort((a, b) =>
      compareCandidates(a, b, request.scoring),
    );
    const baseline =
      scored.find((candidate) => candidate.generatedBy.includes('original_order')) ?? scored[0];
    const explained = scored.map((candidate) => ({
      ...candidate,
      explanations: candidate.feasible && baseline
        ? buildExplanations(candidate, baseline, request)
        : [],
    }));
    const recommended = explained.find((candidate) => candidate.feasible) ?? null;
    const alternatives = recommended
      ? selectMeaningfulAlternatives(recommended, explained, 2)
      : [];
    const diagnosticCandidate = recommended
      ? null
      : explained[0]
        ? {
            ...explained[0],
            explanations: [
              {
                code: 'NO_FEASIBLE_ROUTE' as const,
                text: 'Nerastas visus privalomus apribojimus atitinkantis variantas.',
                criterion: 'feasibility' as const,
                baselineValue: null,
                selectedValue: explained[0].violations.length,
                difference: null,
                dataSource: 'hard apribojimų vertinimas',
                relatedStopIds: explained[0].violations
                  .map((violation) => violation.stopId)
                  .filter((id): id is string => id !== null),
              },
            ],
          }
        : null;
    const conflictingConstraints = uniqueViolations(
      diagnosticCandidate?.violations ?? [],
    );

    const generatedAt = new Date().toISOString();
    return {
      requestId: `${request.routeId}-${generatedAt}`,
      provider: matrix.provider,
      executionMode: matrix.executionMode,
      generatedAt,
      matrixFetchedAt: matrix.fetchedAt,
      matrix,
      feasibleRouteFound: recommended !== null,
      recommended,
      alternatives,
      diagnosticCandidate,
      candidates: explained,
      conflictingConstraints,
      suggestions: recommended
        ? []
        : suggestionsFor(conflictingConstraints),
      warnings: [...new Set(matrix.warnings)],
    };
  }
}

function deduplicate(
  candidates: RouteCandidate[],
  request: RouteOptimizationRequest,
): RouteCandidate[] {
  const map = new Map<string, RouteCandidate>();
  for (const candidate of candidates) {
    const key = [
      request.startLocation.id,
      ...candidate.stopSequence,
      request.endLocation.id,
    ].join('>');
    const current = map.get(key);
    if (!current) {
      map.set(key, candidate);
      continue;
    }
    // Identical sequences score identically, so the winner is decided by the
    // sequence tie-break and can be the copy that never ran local search.
    // Keep the search stats of whichever copy actually did the work, so
    // refinedOnly() below does not discard a sequence that was refined.
    const searched =
      candidate.localSearch.iterations >= current.localSearch.iterations
        ? candidate.localSearch
        : current.localSearch;
    map.set(key, {
      ...(compareCandidates(candidate, current, request.scoring) < 0 ? candidate : current),
      localSearch: searched,
      generatedBy: [...new Set([...current.generatedBy, ...candidate.generatedBy])],
    });
  }
  return [...map.values()];
}

/**
 * A seed whose local search never ran — the shared wall-clock budget was
 * already spent when its turn came — is a raw heuristic or, for the random
 * seeds, an unshuffled guess. Measured on a 16-stop route those came out at
 * ~183 km against ~92 km for the refined ones, yet they stayed in the pool as
 * fully-fledged "feasible" candidates and could be handed to the driver as an
 * alternative. Keep them out of the ranking, unless the budget was so tight
 * that nothing at all got refined and they are all we have.
 */
function refinedOnly(candidates: RouteCandidate[]): RouteCandidate[] {
  const refined = candidates.filter((candidate) => candidate.localSearch.iterations > 0);
  return refined.length > 0 ? refined : candidates;
}

function selectMeaningfulAlternatives(
  recommended: RouteCandidate,
  candidates: RouteCandidate[],
  limit: number,
): RouteCandidate[] {
  const selected: RouteCandidate[] = [];
  const feasible = candidates.filter((candidate) => candidate.feasible);
  const mirror = feasible.find((candidate) =>
    candidate.generatedBy.some((tag) => tag.includes('mirror')),
  );
  const objectiveLeaders = [
    mirror,
    [...feasible].sort((a, b) => a.drivingMinutes - b.drivingMinutes)[0],
    [...feasible].sort((a, b) => a.totalDistanceKm - b.totalDistanceKm)[0],
    [...feasible].sort((a, b) => a.tonneKilometers - b.tonneKilometers)[0],
    [...feasible].sort(
      (a, b) =>
        a.rawScoreComponents.endLocationConvenience -
        b.rawScoreComponents.endLocationConvenience,
    )[0],
  ].filter((candidate): candidate is RouteCandidate => Boolean(candidate));
  const pool = [
    ...objectiveLeaders,
    ...candidates,
  ].filter(
    (candidate, index, values) =>
      values.findIndex((item) => item.id === candidate.id) === index,
  );
  for (const candidate of pool) {
    if (
      candidate.id === recommended.id ||
      !candidate.feasible ||
      candidate.totalScore === null ||
      routeDiversity(recommended, candidate) < 0.18
    ) {
      continue;
    }
    if (selected.every((item) => routeDiversity(item, candidate) >= 0.15)) {
      selected.push(candidate);
    }
    if (selected.length === limit) break;
  }
  // Prefer a mirror/reverse when diversity is otherwise too low.
  if (selected.length < limit && mirror && mirror.id !== recommended.id
    && !selected.some((item) => item.id === mirror.id)
    && routeDiversity(recommended, mirror) >= 0.12) {
    selected.push(mirror);
  }
  return selected.slice(0, limit);
}

function uniqueViolations(violations: ConstraintViolation[]): ConstraintViolation[] {
  const map = new Map(
    violations.map((violation) => [
      `${violation.code}:${violation.stopId}:${violation.actualValue}`,
      violation,
    ]),
  );
  return [...map.values()];
}

function suggestionsFor(violations: ConstraintViolation[]): string[] {
  const codes = new Set(violations.map((violation) => violation.code));
  const suggestions: string[] = [];
  if (codes.has('REQUIRED_TIME_WINDOW')) {
    suggestions.push('Patikrinkite arba atlaisvinkite privalomus pristatymo laiko langus.');
  }
  if (codes.has('MAX_PAYLOAD')) {
    suggestions.push('Sumažinkite krovinį arba pasirinkite didesnės keliamosios galios transportą.');
  }
  if (codes.has('LOCKED_POSITION') || codes.has('DELIVER_BEFORE') || codes.has('DELIVER_AFTER')) {
    suggestions.push('Patikrinkite tarpusavyje konfliktuojančias eiliškumo taisykles.');
  }
  if (codes.has('UNREACHABLE_LEG')) {
    suggestions.push('Patikrinkite adresus, transporto profilį arba kelių apribojimus.');
  }
  return suggestions.length > 0 ? suggestions : ['Patikrinkite privalomus apribojimus.'];
}

function validateRequest(request: RouteOptimizationRequest): void {
  if (request.stops.length === 0) throw new Error('Optimizavimui reikia bent vieno taško.');
  if (new Set(request.stops.map((stop) => stop.id)).size !== request.stops.length) {
    throw new Error('Pristatymo taškų ID turi būti unikalūs.');
  }
  const nodeIds = [
    request.startLocation.id,
    ...request.stops.map((stop) => stop.location.id),
    request.endLocation.id,
  ];
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new Error('Starto, pristatymų ir pabaigos node ID turi būti unikalūs.');
  }
  if (request.maxIterations < 1 || request.maxCalculationMs < 1) {
    throw new Error('Skaičiavimo ribos turi būti teigiamos.');
  }
  if (request.maxTotalCalculationMs !== undefined && request.maxTotalCalculationMs < request.maxCalculationMs) {
    throw new Error('Bendras skaičiavimo biudžetas negali būti mažesnis už vieno seed biudžetą.');
  }
  const stopWeight = summarizeStopWeights(request.stops).knownTotalKg;
  if (request.initialLoadKg !== undefined && request.initialLoadKg < stopWeight) {
    throw new Error('Esamas krovinio likutis negali būti mažesnis už likusių taškų svorį.');
  }
}
