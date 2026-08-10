import { bearingDegrees, haversineKm } from '../evaluation/geo';
import type {
  OptimizationStop,
  RouteOptimizationRequest,
  TravelMatrix,
} from '../models';
import { numericWeightKg } from '../weights';

export type HeuristicSeed = {
  sequence: string[];
  generatedBy: string;
};

export function generateHeuristicSeeds(
  request: RouteOptimizationRequest,
  matrix: TravelMatrix,
): HeuristicSeed[] {
  const stops = request.stops;
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const distance = matrixDistance(matrix);
  const base: HeuristicSeed[] = [
    { generatedBy: 'original_order', sequence: stops.map((stop) => stop.id) },
    {
      generatedBy: 'nearest_neighbor',
      sequence: greedy(request.startLocation.id, stops, (from, stop) => distance(from, stop.id)),
    },
    {
      generatedBy: 'farthest_first',
      sequence: [
        ...stops,
      ]
        .sort(
          (left, right) =>
            distance(request.startLocation.id, right.id) -
              distance(request.startLocation.id, left.id) ||
            left.id.localeCompare(right.id),
        )
        .map((stop) => stop.id),
    },
    {
      generatedBy: 'earliest_required_window_first',
      sequence: windowBucketedGeographicOrder(request, distance),
    },
    {
      generatedBy: 'window_aware_nearest_neighbor',
      sequence: windowAwareGreedy(request, matrix, distance),
    },
    {
      generatedBy: 'heaviest_first',
      sequence: [...stops]
        .sort((left, right) => {
          return (
            numericWeightKg(right.weightKg) - numericWeightKg(left.weightKg) ||
            left.id.localeCompare(right.id)
          );
        })
        .map((stop) => stop.id),
    },
    {
      generatedBy: 'end_location_guided',
      sequence: [...stops]
        .sort(
          (left, right) =>
            haversineKm(right.location, request.endLocation) -
              haversineKm(left.location, request.endLocation) ||
            left.id.localeCompare(right.id),
        )
        .map((stop) => stop.id),
    },
    {
      generatedBy: 'directional_sweep',
      sequence: [...stops]
        .sort(
          (left, right) =>
            bearingDegrees(request.startLocation, left.location) -
              bearingDegrees(request.startLocation, right.location) ||
            haversineKm(request.startLocation, left.location) -
              haversineKm(request.startLocation, right.location) ||
            left.id.localeCompare(right.id),
        )
        .map((stop) => stop.id),
    },
    {
      generatedBy: 'cluster_then_route',
      sequence: clusterThenRoute(request, distance),
    },
    {
      generatedBy: 'mirror_reverse',
      sequence: [...stops].map((stop) => stop.id).reverse(),
    },
    {
      generatedBy: 'directional_sweep_mirror',
      sequence: [...stops]
        .sort(
          (left, right) =>
            bearingDegrees(request.startLocation, right.location) -
              bearingDegrees(request.startLocation, left.location) ||
            haversineKm(request.startLocation, left.location) -
              haversineKm(request.startLocation, right.location) ||
            left.id.localeCompare(right.id),
        )
        .map((stop) => stop.id),
    },
  ];

  for (const seed of request.randomSeeds) {
    base.push({
      generatedBy: `random_seeded:${seed}`,
      sequence: seededShuffle(stops.map((stop) => stop.id), seed),
    });
  }
  return base.map((item) => ({
    ...item,
    sequence: repairHardOrdering(item.sequence, byId),
  }));
}

export function repairHardOrdering(
  sequence: string[],
  stopById: Map<string, OptimizationStop>,
): string[] {
  const result = [...new Set(sequence)].filter((id) => stopById.has(id));
  const fixed = [...stopById.values()]
    .filter((stop) => stop.lockedPosition !== undefined)
    .sort((a, b) => a.lockedPosition! - b.lockedPosition!);

  moveTo(result, [...stopById.values()].find((stop) => stop.mustBeFirst)?.id, 0);
  moveTo(
    result,
    [...stopById.values()].find((stop) => stop.mustBeLast)?.id,
    result.length - 1,
  );
  for (const stop of fixed) moveTo(result, stop.id, stop.lockedPosition! - 1);

  for (let pass = 0; pass < result.length; pass += 1) {
    for (const stop of stopById.values()) {
      for (const afterId of stop.deliverBeforeStopIds) {
        ensureBefore(result, stop.id, afterId);
      }
      for (const beforeId of stop.deliverAfterStopIds) {
        ensureBefore(result, beforeId, stop.id);
      }
    }
  }
  for (const stop of fixed) moveTo(result, stop.id, stop.lockedPosition! - 1);
  return result;
}

function greedy(
  startId: string,
  stops: OptimizationStop[],
  cost: (fromId: string, stop: OptimizationStop) => number,
): string[] {
  const remaining = [...stops];
  const result: string[] = [];
  let current = startId;
  while (remaining.length > 0) {
    remaining.sort(
      (left, right) => cost(current, left) - cost(current, right) || left.id.localeCompare(right.id),
    );
    const next = remaining.shift()!;
    result.push(next.id);
    current = next.id;
  }
  return result;
}

// Sorting purely by clock time scatters the route across the map, because two
// stops that open at the same hour can sit in opposite corners of the country.
// Stops are therefore grouped into opening-time bands and each band is chained
// geographically, so the run still starts with the earliest windows but drives
// them in a sensible order.
const WINDOW_BUCKET_MINUTES = 60;

function windowBucketedGeographicOrder(
  request: RouteOptimizationRequest,
  distance: (fromId: string, toId: string) => number,
): string[] {
  const buckets = new Map<number, OptimizationStop[]>();
  for (const stop of request.stops) {
    const opensAt = Date.parse(stop.requiredTimeWindow?.from ?? '');
    // Stops without a window are flexible, so they ride along with whichever
    // band they are closest to in time rather than being pushed to the end.
    const bucket = Number.isFinite(opensAt)
      ? Math.floor(opensAt / (WINDOW_BUCKET_MINUTES * 60_000))
      : Number.NEGATIVE_INFINITY;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), stop]);
  }

  const flexible = buckets.get(Number.NEGATIVE_INFINITY) ?? [];
  buckets.delete(Number.NEGATIVE_INFINITY);
  const ordered = [...buckets.entries()].sort(([left], [right]) => left - right);
  if (ordered.length === 0) {
    return greedy(request.startLocation.id, flexible, (from, stop) => distance(from, stop.id));
  }

  const result: string[] = [];
  let cursor = request.startLocation.id;
  for (const [, bucket] of ordered) {
    const chained = greedy(cursor, bucket, (from, stop) => distance(from, stop.id));
    result.push(...chained);
    cursor = chained[chained.length - 1] ?? cursor;
  }
  // Flexible stops are appended by proximity to wherever the timed work ends.
  result.push(...greedy(cursor, flexible, (from, stop) => distance(from, stop.id)));
  return result;
}

// Distance-equivalent bias applied to time pressure. Windows steer the greedy
// choice but can never outrank geography outright, which keeps the sequence
// drivable even when the windows themselves are impossible to satisfy.
const URGENCY_BIAS_KM = 45;
const URGENCY_HORIZON_MINUTES = 150;
const WAITING_PENALTY_KM_PER_MINUTE = 0.25;

function windowAwareGreedy(
  request: RouteOptimizationRequest,
  matrix: TravelMatrix,
  distance: (fromId: string, toId: string) => number,
): string[] {
  const duration = matrixDuration(matrix);
  const remaining = [...request.stops];
  const result: string[] = [];
  let current = request.startLocation.id;
  let clock = Date.parse(request.plannedDepartureAt);
  if (!Number.isFinite(clock)) clock = Date.now();

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const [index, stop] of remaining.entries()) {
      const travelMinutes = duration(current, stop.id);
      const arrival = clock + travelMinutes * 60_000;
      const opensAt = Date.parse(stop.requiredTimeWindow?.from ?? '');
      const closesAt = Date.parse(stop.requiredTimeWindow?.to ?? '');

      const waitingMinutes = Number.isFinite(opensAt)
        ? Math.max(0, (opensAt - arrival) / 60_000)
        : 0;
      const slackMinutes = Number.isFinite(closesAt)
        ? (closesAt - arrival) / 60_000
        : Number.POSITIVE_INFINITY;
      const urgency = Number.isFinite(slackMinutes)
        ? Math.max(0, Math.min(1, 1 - slackMinutes / URGENCY_HORIZON_MINUTES))
        : 0;

      const cost = distance(current, stop.id)
        + waitingMinutes * WAITING_PENALTY_KM_PER_MINUTE
        - urgency * URGENCY_BIAS_KM;
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    const travelMinutes = duration(current, next.id);
    const opensAt = Date.parse(next.requiredTimeWindow?.from ?? '');
    const arrival = clock + travelMinutes * 60_000;
    const serviceStart = Number.isFinite(opensAt) ? Math.max(arrival, opensAt) : arrival;
    clock = serviceStart + next.serviceDurationMinutes * 60_000;
    result.push(next.id);
    current = next.id;
  }
  return result;
}

function clusterThenRoute(
  request: RouteOptimizationRequest,
  distance: (fromId: string, toId: string) => number,
): string[] {
  const clusters = new Map<number, OptimizationStop[]>();
  for (const stop of request.stops) {
    const quadrant = Math.floor(bearingDegrees(request.startLocation, stop.location) / 90);
    clusters.set(quadrant, [...(clusters.get(quadrant) ?? []), stop]);
  }
  return [...clusters.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, cluster]) =>
      greedy(request.startLocation.id, cluster, (from, stop) => distance(from, stop.id)),
    );
}

function matrixDistance(matrix: TravelMatrix): (fromId: string, toId: string) => number {
  const index = new Map(matrix.nodeIds.map((id, position) => [id, position]));
  return (fromId, toId) => {
    const from = index.get(fromId);
    const to = index.get(toId);
    if (from === undefined || to === undefined) return Number.MAX_SAFE_INTEGER;
    return matrix.cells[from]?.[to]?.distanceKm ?? Number.MAX_SAFE_INTEGER;
  };
}

function matrixDuration(matrix: TravelMatrix): (fromId: string, toId: string) => number {
  const index = new Map(matrix.nodeIds.map((id, position) => [id, position]));
  return (fromId, toId) => {
    const from = index.get(fromId);
    const to = index.get(toId);
    if (from === undefined || to === undefined) return 0;
    const cell = matrix.cells[from]?.[to];
    if (cell?.durationMinutes !== null && cell?.durationMinutes !== undefined) return cell.durationMinutes;
    // Fall back to a coarse road-speed estimate so the clock still advances.
    const distanceKm = cell?.distanceKm ?? 0;
    return (distanceKm / 60) * 60;
  };
}

function moveTo(sequence: string[], id: string | undefined, index: number): void {
  if (!id) return;
  const current = sequence.indexOf(id);
  if (current < 0) return;
  sequence.splice(current, 1);
  sequence.splice(Math.max(0, Math.min(index, sequence.length)), 0, id);
}

function ensureBefore(sequence: string[], first: string, second: string): void {
  const firstIndex = sequence.indexOf(first);
  const secondIndex = sequence.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex < secondIndex) return;
  sequence.splice(firstIndex, 1);
  sequence.splice(sequence.indexOf(second), 0, first);
}

function seededShuffle(values: string[], seed: number): string[] {
  const result = [...values];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
