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
  /**
   * Absolute `performance.now()` value shared by every seed of one optimize()
   * call. The seed still gets its own `maxCalculationMs`, but never outlives
   * the shared budget. Omitted means "per-seed budget only".
   */
  deadlineAt?: number;
}): RouteCandidate {
  const { generatedBy, request, matrix } = input;
  const stopById = new Map(request.stops.map((stop) => [stop.id, stop]));
  const startedAt = performance.now();
  const stopSearchingAt = Math.min(
    startedAt + request.maxCalculationMs,
    input.deadlineAt ?? Number.POSITIVE_INFINITY,
  );
  const original = evaluateCandidate({
    stopSequence: input.sequence,
    generatedBy: [generatedBy],
    request,
    matrix,
  });
  // The full objective is expensive (every neighbour re-simulates the whole
  // day), so on a phone the budget ran out after a handful of moves and the
  // driver got a route that loops around the city. A pure road-distance
  // 2-opt / Or-opt pass costs a few milliseconds and untangles the geography
  // first; the full search then only has to fine-tune. The polished order is
  // kept only if the full objective agrees it is at least as good.
  const polishedSequence = repairHardOrdering(
    polishByDistance(input.sequence, request, matrix, stopSearchingAt),
    stopById,
  );
  let best = original;
  if (polishedSequence.join('|') !== input.sequence.join('|')) {
    const polished = evaluateCandidate({
      stopSequence: polishedSequence,
      generatedBy: [generatedBy, 'distance_polish'],
      request,
      matrix,
    });
    if (!isBetter(original, polished, request)) best = polished;
  }
  const initialObjective = cappedObjective(original.rawScoreComponents, request.scoring);
  let iterations = 0;
  let stoppedBy: LocalSearchStats['stoppedBy'] = 'no_improvement';

  while (iterations < request.maxIterations) {
    if (performance.now() >= stopSearchingAt) {
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
      if (performance.now() >= stopSearchingAt) break;
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

/**
 * Road-distance-only 2-opt + Or-opt (segments of 1–3 stops) on the open path
 * start -> stops -> end. First-improvement, repeated until nothing improves or
 * the time limit is hit. Uses the matrix directly, so it is orders of
 * magnitude cheaper than evaluateCandidate.
 */
export function polishByDistance(
  sequence: string[],
  request: RouteOptimizationRequest,
  matrix: TravelMatrix,
  stopAt: number = Number.POSITIVE_INFINITY,
): string[] {
  const index = new Map(matrix.nodeIds.map((id, position) => [id, position]));
  const startIdx = index.get(request.startLocation.id);
  const endIdx = index.get(request.endLocation.id);
  const nodes = sequence.map((id) => index.get(id));
  if (startIdx === undefined || endIdx === undefined || nodes.some((n) => n === undefined)) {
    return sequence;
  }
  const d = (from: number, to: number): number => {
    const value = matrix.cells[from]?.[to]?.distanceKm;
    return value !== null && value !== undefined && Number.isFinite(value) ? value : 1e6;
  };
  const cost = (path: number[]): number => {
    if (path.length === 0) return d(startIdx, endIdx);
    let total = d(startIdx, path[0]);
    for (let i = 1; i < path.length; i += 1) total += d(path[i - 1], path[i]);
    return total + d(path[path.length - 1], endIdx);
  };
  let path = nodes as number[];
  let bestCost = cost(path);
  let improved = true;
  let guard = 0;
  while (improved && guard < 200) {
    guard += 1;
    improved = false;
    if (performance.now() >= stopAt) break;
    for (let i = 0; i < path.length - 1; i += 1) {
      for (let j = i + 1; j < path.length; j += 1) {
        const next = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        const nextCost = cost(next);
        if (nextCost < bestCost - 1e-9) {
          path = next;
          bestCost = nextCost;
          improved = true;
        }
      }
    }
    for (let length = 1; length <= 3; length += 1) {
      for (let i = 0; i + length <= path.length; i += 1) {
        const segment = path.slice(i, i + length);
        const rest = [...path.slice(0, i), ...path.slice(i + length)];
        for (let k = 0; k <= rest.length; k += 1) {
          if (k === i) continue;
          for (const piece of length > 1 ? [segment, [...segment].reverse()] : [segment]) {
            const next = [...rest.slice(0, k), ...piece, ...rest.slice(k)];
            const nextCost = cost(next);
            if (nextCost < bestCost - 1e-9) {
              path = next;
              bestCost = nextCost;
              improved = true;
              break;
            }
          }
          if (improved && path.length !== rest.length + length) break;
        }
      }
    }
  }
  const idByIndex = new Map(matrix.nodeIds.map((id, position) => [position, id]));
  return path.map((n) => idByIndex.get(n)!);
}
