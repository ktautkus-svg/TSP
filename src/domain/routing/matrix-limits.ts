/**
 * What Google's ComputeRouteMatrix will accept in ONE request, and what this
 * app is willing to buy for one planning run.
 *
 * Kept in one module because the client-side guard and the gateway adapter both
 * reason about it; if they drifted apart the estimate shown before a request
 * would stop matching the requests actually sent.
 */

/** Google's documented ceiling: origins x destinations per request. */
export const GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST = 625;

/**
 * Locations per chunk side. 25 x 25 is exactly the 625-element ceiling, so a
 * plan with 25 or fewer nodes is a single request.
 */
export const MATRIX_CHUNK_SIZE = 25;

/**
 * Elements one planning run may buy in total, across every chunk.
 *
 * 729 is 27x27: 25 delivery stops plus a start and an end. That covers a full
 * ordinary route, and stops there on purpose. Past 25 stops the answer is not a
 * bigger matrix but a different shape - two trips, or a split route - so the
 * ceiling refuses rather than quietly buying a grid several times the size.
 *
 * Note on what this actually controls. Google bills computeRouteMatrix PER
 * ELEMENT, not per request. Crossing 25 nodes forces the grid to be split into
 * more HTTP requests, but that split is close to cost-neutral: 23 stops is 625
 * elements in 1 request, 24 stops is 676 elements in 4 requests - four times the
 * requests for roughly eight percent more money. So this ceiling is about total
 * elements, which is the thing that costs, and the request count is reported
 * only so the fan-out is never a surprise.
 */
export const MAX_MATRIX_ELEMENTS_PER_PLAN = 729;

/** Delivery stops that fit under the per-plan ceiling, start and end included. */
export const MAX_STOPS_PER_PLAN = 25;

export type MatrixRequestPlan = {
  /** Unique places going into the grid, including start and end. */
  nodes: number;
  /**
   * Real HTTP calls to computeRouteMatrix. Reported so the fan-out past 25 nodes
   * is visible - NOT a cost multiplier: billing is per element.
   */
  httpRequests: number;
  /** What Google actually charges for: elements, summed over every chunk. */
  billableElements: number;
  /** True when the whole grid fits in one request. */
  singleRequest: boolean;
  withinPlanLimit: boolean;
};

/**
 * What a grid of this size will actually cost, worked out BEFORE anything is
 * sent. `nodes` counts unique locations, so duplicate delivery addresses must
 * already have been collapsed.
 */
export function planMatrixRequests(nodes: number): MatrixRequestPlan {
  const chunks = Math.max(1, Math.ceil(nodes / MATRIX_CHUNK_SIZE));
  const httpRequests = nodes === 0 ? 0 : chunks * chunks;
  const billableElements = nodes * nodes;
  return {
    nodes,
    httpRequests,
    billableElements,
    singleRequest: httpRequests <= 1,
    withinPlanLimit: billableElements <= MAX_MATRIX_ELEMENTS_PER_PLAN,
  };
}

/**
 * Largest delivery-stop count that still fits in ONE request, start and end
 * included. Going past it costs more requests, not meaningfully more money.
 */
export const MAX_STOPS_IN_SINGLE_REQUEST = MATRIX_CHUNK_SIZE - 2;
