import { evaluateCandidate } from '../evaluation/candidate-evaluator';
import type {
  LocalSearchStats,
  RouteCandidate,
  RouteOptimizationRequest,
  TravelMatrix,
} from '../models';
import { cappedObjective, compareCriticalRank } from '../scoring/scoring';
import { repairHardOrdering } from './generators';

export function improveWithLocalSearch(input: {
  sequence: string[];
  generatedBy: string;
  request: RouteOptimizationRequest;
  matrix: TravelMatrix;
}): RouteCandidate {
  const { generatedBy, request, matrix } = input;
  const stopById = new Map(request.stops.map((stop) => [stop.id, stop]));
  const startedAt = performance.now();
  let best = evaluateCandidate({
    stopSequence: input.sequence,
    generatedBy: [generatedBy],
    request,
    matrix,
  });
  const initialObjective = cappedObjective(best.rawScoreComponents, request.scoring);
  let iterations = 0;
  let stoppedBy: LocalSearchStats['stoppedBy'] = 'no_improvement';

  while (iterations < request.maxIterations) {
    if (performance.now() - startedAt >= request.maxCalculationMs) {
      stoppedBy = 'time_limit';
      break;
    }
    iterations += 1;
    let improved: RouteCandidate | null = null;
    let neighborEvaluations = 0;
    const deterministicEvaluationLimit = Math.min(
      300,
      Math.max(30, best.stopSequence.length ** 2),
    );
    for (const sequence of neighborhoods(best.stopSequence)) {
      if (neighborEvaluations >= deterministicEvaluationLimit) break;
      neighborEvaluations += 1;
      const repaired = repairHardOrdering(sequence, stopById);
      const candidate = evaluateCandidate({
        stopSequence: repaired,
        generatedBy: [generatedBy, 'local_search'],
        request,
        matrix,
      });
      if (isBetter(candidate, improved ?? best, request)) improved = candidate;
      if (performance.now() - startedAt >= request.maxCalculationMs) break;
    }
    if (!improved || !isBetter(improved, best, request)) break;
    best = improved;
    if (iterations === request.maxIterations) stoppedBy = 'iteration_limit';
  }
  const finalObjective = cappedObjective(best.rawScoreComponents, request.scoring);
  return {
    ...best,
    localSearch: {
      iterations,
      initialSequence: [...input.sequence],
      initialObjective,
      finalObjective,
      improvementPercent:
        initialObjective === 0 ? 0 : ((initialObjective - finalObjective) / initialObjective) * 100,
      stoppedBy,
    },
  };
}

function isBetter(
  candidate: RouteCandidate,
  reference: RouteCandidate,
  request: RouteOptimizationRequest,
): boolean {
  if (candidate.feasible !== reference.feasible) return candidate.feasible;
  const critical = compareCriticalRank(candidate.criticalRank, reference.criticalRank);
  if (critical !== 0) return critical < 0;
  const left = cappedObjective(candidate.rawScoreComponents, request.scoring);
  const right = cappedObjective(reference.rawScoreComponents, request.scoring);
  return left < right - 1e-9;
}

function* neighborhoods(sequence: string[]): Generator<string[]> {
  const length = sequence.length;
  for (let left = 0; left < length - 1; left += 1) {
    for (let right = left + 1; right < length; right += 1) {
      const swapped = [...sequence];
      [swapped[left], swapped[right]] = [swapped[right], swapped[left]];
      yield swapped;
    }
  }
  for (let left = 0; left < length - 1; left += 1) {
    for (let right = left + 1; right < length; right += 1) {
      yield [
        ...sequence.slice(0, left),
        ...sequence.slice(left, right + 1).reverse(),
        ...sequence.slice(right + 1),
      ];
    }
  }
  for (let from = 0; from < length; from += 1) {
    for (let to = 0; to < length; to += 1) {
      if (from === to) continue;
      const relocated = [...sequence];
      const [item] = relocated.splice(from, 1);
      relocated.splice(to, 0, item);
      yield relocated;
    }
  }
}
