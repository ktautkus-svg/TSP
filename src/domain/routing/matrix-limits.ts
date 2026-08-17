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
 * Above 25 nodes the grid has to be split, and the split is quadratic: 26 nodes
 * is already 4 requests. The ceiling is set at 50x50 so a real driver's day
 * (comfortably under 48 stops) still plans, while a runaway import cannot
 * quietly spend thousands of elements. Crossing it is an error, never a silent
 * fan-out.
 */
export const MAX_MATRIX_ELEMENTS_PER_PLAN = 2_500;

export type MatrixRequestPlan = {
  /** Unique places going into the grid, including start and end. */
  nodes: number;
  /** Real HTTP calls to computeRouteMatrix this will cost. */
  httpRequests: number;
  /** Elements Google bills, summed over every chunk. */
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

/** Largest delivery-stop count that still fits in one request, start and end included. */
export const MAX_STOPS_IN_SINGLE_REQUEST = MATRIX_CHUNK_SIZE - 2;
