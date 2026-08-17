import type {
  MatrixCell,
  MatrixRequest,
  RoutingLocation,
  TravelCostProvider,
  TravelMatrix,
} from '@/domain/routing/models';

import {
  MAX_MATRIX_ELEMENTS_PER_PLAN,
  MAX_STOPS_PER_PLAN,
  planMatrixRequests,
} from '@/domain/routing/matrix-limits';

/** One planning action may buy at most this many matrices from a provider. */
export const MAX_MATRIX_CALLS_PER_PLAN = 1;

/** Coordinates closer than this count as the same physical stop (~1 m). */
const COORDINATE_PRECISION = 5;

export type PlanningRunStats = {
  planningRunId: string;
  matrixCalls: number;
  requestedLocations: number;
  uniqueLocations: number;
  billedElements: number;
  savedElements: number;
  blockedCalls: number;
  /**
   * Real computeRouteMatrix HTTP calls this run will cost. One logical matrix is
   * NOT one request: Google caps a request at 625 elements, so anything past 25
   * nodes is split into ceil(n/25)^2 chunks.
   *
   * This is a visibility figure, not a cost multiplier - billing is per element,
   * so four requests for 676 elements cost about eight percent more than one
   * request for 625, not four times as much.
   */
  httpRequests: number;
};

/**
 * Buys exactly one travel matrix per planning run and hands the same one to
 * everything that asks for it.
 *
 * Two things used to make a single "plan this route" action expensive:
 *
 * 1. buildRouteAlternatives runs the engine twice - windows honoured and windows
 *    ignored - and each run fetched its own matrix. They start concurrently, so
 *    a plain result cache never helped: both missed and both paid. This shares
 *    the in-flight promise, not just the finished value.
 *
 * 2. The matrix is an all-pairs grid, so a stop entered twice (two orders to the
 *    same shop) added a whole row AND a whole column. 25 order rows over 15
 *    addresses cost 27x27 = 729 elements instead of 17x17 = 289.
 *
 * Duplicates are collapsed before the provider is called and the answer is
 * expanded back to the full node list afterwards, so callers still see every
 * stop id they asked about and keep their own weights and time windows.
 *
 * Nothing is stored beyond the life of this object: it is created per planning
 * run and thrown away with it, which keeps Google's content out of any
 * persistent cache.
 */
export class PlanningRunTravelCostProvider implements TravelCostProvider {
  readonly name: string;

  private inFlight: Promise<TravelMatrix> | null = null;
  private firstKey: string | null = null;
  private collapsed: RoutingLocation[] = [];
  private readonly stats: PlanningRunStats;

  constructor(
    private readonly provider: TravelCostProvider,
    readonly planningRunId: string = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    private readonly onStats: (stats: PlanningRunStats) => void = defaultStatsLog,
  ) {
    this.name = provider.name;
    this.stats = {
      planningRunId: this.planningRunId,
      matrixCalls: 0,
      requestedLocations: 0,
      uniqueLocations: 0,
      billedElements: 0,
      savedElements: 0,
      blockedCalls: 0,
      httpRequests: 0,
    };
  }

  getStats(): PlanningRunStats {
    return { ...this.stats };
  }

  async getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    const key = requestKey(request);

    if (this.inFlight && this.firstKey === key) {
      // Same set of places: reuse, and do not count it as a purchase.
      return this.expandTo(request.locations, await this.inFlight);
    }

    if (this.inFlight) {
      // A different set of places inside one planning run means something asked
      // for stops the run was not built for - a double submit, or a variant
      // generator quietly changing the list. Serve the matrix already bought
      // rather than buying a second one; any node it lacks stays unreachable and
      // the candidate is rejected by the constraint evaluator.
      this.stats.blockedCalls += 1;
      this.onStats(this.getStats());
      return this.expandTo(request.locations, await this.inFlight);
    }

    if (this.stats.matrixCalls >= MAX_MATRIX_CALLS_PER_PLAN) {
      throw new Error('Šiam planavimui matricos limitas jau išnaudotas.');
    }

    const unique = collapseDuplicates(request.locations);
    // Worked out BEFORE anything is sent, so the true cost of this run - real
    // HTTP calls, not just the one logical matrix - is known and logged first.
    const plan = planMatrixRequests(unique.locations.length);
    if (!plan.withinPlanLimit) {
      throw new Error(
        `Šis maršrutas pareikalautų ${plan.billableElements} matricos elementų, `
        + `o vienam planavimui leidžiama ${MAX_MATRIX_ELEMENTS_PER_PLAN} `
        + `(iki ${MAX_STOPS_PER_PLAN} pristatymo taškų). `
        + 'Didesnį maršrutą reikia skaidyti į kelis reisus.',
      );
    }

    this.collapsed = unique.locations;
    this.stats.requestedLocations = request.locations.length;
    this.stats.uniqueLocations = unique.locations.length;
    this.stats.billedElements = plan.billableElements;
    this.stats.savedElements = request.locations.length ** 2 - plan.billableElements;
    this.stats.httpRequests = plan.httpRequests;
    this.stats.matrixCalls += 1;
    this.firstKey = key;
    // Logged before the purchase, not after it.
    this.onStats(this.getStats());

    this.inFlight = this.provider.getMatrix({ ...request, locations: unique.locations });
    try {
      const matrix = await this.inFlight;
      this.onStats(this.getStats());
      return this.expandTo(request.locations, matrix);
    } catch (error) {
      // A failed purchase must not lock the run out of retrying once.
      this.inFlight = null;
      this.firstKey = null;
      this.stats.matrixCalls -= 1;
      throw error;
    }
  }

  private expandTo(locations: RoutingLocation[], matrix: TravelMatrix): TravelMatrix {
    return expandMatrix(locations, this.collapsed, matrix);
  }
}

/**
 * Rebuilds a full node-by-node matrix from one that only holds unique places.
 *
 * Every id the caller asked about appears again; two orders on the same address
 * simply point at the same row and column, which is exactly right - the drive
 * between them is zero.
 */
export function expandMatrix(
  locations: RoutingLocation[],
  collapsed: RoutingLocation[],
  matrix: TravelMatrix,
): TravelMatrix {
  const indexByCoordinate = new Map(collapsed.map((location, index) => [coordinateKey(location), index]));
  const sourceIndex = locations.map((location) => indexByCoordinate.get(coordinateKey(location)));
  const size = locations.length;
  const cells: MatrixCell[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => {
      const from = sourceIndex[row];
      const to = sourceIndex[column];
      if (from === undefined || to === undefined) return unreachable();
      return matrix.cells[from]?.[to] ?? unreachable();
    }),
  );
  return { ...matrix, nodeIds: locations.map((location) => location.id), cells };
}

export type CollapsedLocations = {
  locations: RoutingLocation[];
  /** Original id -> id of the location that represents it in the matrix. */
  representativeById: Map<string, string>;
};

/** Same coordinates means the same physical stop, however many orders sit on it. */
export function collapseDuplicates(locations: RoutingLocation[]): CollapsedLocations {
  const byCoordinate = new Map<string, RoutingLocation>();
  const representativeById = new Map<string, string>();
  for (const location of locations) {
    const key = coordinateKey(location);
    const existing = byCoordinate.get(key);
    if (existing) {
      representativeById.set(location.id, existing.id);
      continue;
    }
    byCoordinate.set(key, location);
    representativeById.set(location.id, location.id);
  }
  return { locations: [...byCoordinate.values()], representativeById };
}

function coordinateKey(location: RoutingLocation): string {
  return `${round(location.latitude)},${round(location.longitude)}`;
}

function round(value: number): number {
  const multiplier = 10 ** COORDINATE_PRECISION;
  return Math.round(value * multiplier) / multiplier;
}

function requestKey(request: MatrixRequest): string {
  return JSON.stringify({
    trafficMode: request.trafficMode,
    departureAt: request.departureAt,
    vehicle: request.vehicle.id,
    locations: [...request.locations]
      .map((location) => coordinateKey(location))
      .sort(),
  });
}

function unreachable(): MatrixCell {
  return {
    distanceKm: null,
    durationMinutes: null,
    reachable: false,
    maneuverPenalty: 0,
    restrictionWarnings: [],
  };
}

/**
 * The three numbers are deliberately separate: how many matrices the run asked
 * for, how many HTTP calls that turned into, and how many elements Google will
 * charge for. Only the last one is money.
 */
function defaultStatsLog(stats: PlanningRunStats): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    event: 'planning_run_matrix',
    planning_run_id: stats.planningRunId,
    logical_matrix_calls: stats.matrixCalls,
    actual_http_requests: stats.httpRequests,
    billable_elements: stats.billedElements,
    requested_locations: stats.requestedLocations,
    unique_locations: stats.uniqueLocations,
    elements_saved_by_deduplication: stats.savedElements,
    blocked_calls: stats.blockedCalls,
  }));
}
