import type { RouteCandidate, TravelMatrix } from '../../src/domain/routing/models';

export type MatrixComparison = {
  comparablePairs: number;
  reachabilityDisagreements: number;
  medianDurationDifferencePercent: number | null;
  p90DurationDifferencePercent: number | null;
  medianDistanceDifferencePercent: number | null;
  asymmetricPairsA: number;
  asymmetricPairsB: number;
  largestDurationDifferences: Array<{
    fromId: string;
    toId: string;
    differencePercent: number;
    durationA: number;
    durationB: number;
  }>;
};

export function compareMatrices(
  left: TravelMatrix,
  right: TravelMatrix,
): MatrixComparison {
  if (left.nodeIds.join('|') !== right.nodeIds.join('|')) {
    throw new Error('Matricų nodeIds nesutampa.');
  }
  const durationDifferences: number[] = [];
  const distanceDifferences: number[] = [];
  const largest: MatrixComparison['largestDurationDifferences'] = [];
  let reachabilityDisagreements = 0;
  for (let origin = 0; origin < left.nodeIds.length; origin += 1) {
    for (let destination = 0; destination < left.nodeIds.length; destination += 1) {
      if (origin === destination) continue;
      const a = left.cells[origin][destination];
      const b = right.cells[origin][destination];
      if (a.reachable !== b.reachable) reachabilityDisagreements += 1;
      if (
        a.durationMinutes !== null &&
        b.durationMinutes !== null &&
        a.reachable &&
        b.reachable
      ) {
        const durationDifference = relativeDifference(
          a.durationMinutes,
          b.durationMinutes,
        );
        durationDifferences.push(durationDifference);
        largest.push({
          fromId: left.nodeIds[origin],
          toId: left.nodeIds[destination],
          differencePercent: round(durationDifference),
          durationA: round(a.durationMinutes),
          durationB: round(b.durationMinutes),
        });
      }
      if (
        a.distanceKm !== null &&
        b.distanceKm !== null &&
        a.reachable &&
        b.reachable
      ) {
        distanceDifferences.push(relativeDifference(a.distanceKm, b.distanceKm));
      }
    }
  }
  return {
    comparablePairs: durationDifferences.length,
    reachabilityDisagreements,
    medianDurationDifferencePercent: percentile(durationDifferences, 0.5),
    p90DurationDifferencePercent: percentile(durationDifferences, 0.9),
    medianDistanceDifferencePercent: percentile(distanceDifferences, 0.5),
    asymmetricPairsA: asymmetricPairCount(left),
    asymmetricPairsB: asymmetricPairCount(right),
    largestDurationDifferences: largest
      .sort((a, b) => b.differencePercent - a.differencePercent)
      .slice(0, 5),
  };
}

export function compareSequences(
  left: RouteCandidate | null,
  right: RouteCandidate | null,
  heavyStopId: string,
) {
  if (!left || !right) {
    return {
      similarity: null,
      classification: 'not_comparable' as const,
      identical: false,
      firstChanged: null,
      lastChanged: null,
      heavyStopPositionDelta: null,
    };
  }
  const edges = (sequence: string[]) =>
    new Set(sequence.slice(0, -1).map((id, index) => `${id}>${sequence[index + 1]}`));
  const leftEdges = edges(left.stopSequence);
  const rightEdges = edges(right.stopSequence);
  const union = new Set([...leftEdges, ...rightEdges]);
  const intersection = [...leftEdges].filter((edge) => rightEdges.has(edge)).length;
  const similarity = union.size === 0 ? 1 : intersection / union.size;
  return {
    similarity: round(similarity),
    classification:
      similarity === 1
        ? ('identical' as const)
        : similarity >= 0.75
          ? ('minor' as const)
          : ('significant' as const),
    identical: similarity === 1,
    firstChanged: left.stopSequence[0] !== right.stopSequence[0],
    lastChanged:
      left.stopSequence.at(-1) !== right.stopSequence.at(-1),
    heavyStopPositionDelta:
      right.stopSequence.indexOf(heavyStopId) -
      left.stopSequence.indexOf(heavyStopId),
  };
}

function asymmetricPairCount(matrix: TravelMatrix): number {
  let count = 0;
  for (let a = 0; a < matrix.nodeIds.length; a += 1) {
    for (let b = a + 1; b < matrix.nodeIds.length; b += 1) {
      const forward = matrix.cells[a][b].durationMinutes;
      const reverse = matrix.cells[b][a].durationMinutes;
      if (
        forward !== null &&
        reverse !== null &&
        relativeDifference(forward, reverse) >= 5
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function relativeDifference(left: number, right: number): number {
  const denominator = (Math.abs(left) + Math.abs(right)) / 2;
  return denominator === 0 ? 0 : (Math.abs(left - right) / denominator) * 100;
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.ceil(quantile * sorted.length) - 1]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

