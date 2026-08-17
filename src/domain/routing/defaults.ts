import type { RoutingScoringConfig } from './models';

// All ten pre-existing weights summed to exactly 1.0. Introducing `lateness`
// at 0.12 without touching the relative balance between the others means
// scaling every one of them by (1 - 0.12) = 0.88, so the total still sums to 1.
const PRE_LATENESS_SCALE = 0.88;

export const DEFAULT_ROUTING_SCORING: RoutingScoringConfig = {
  weights: {
    drivingTime: 0.18 * PRE_LATENESS_SCALE,
    totalWorkTime: 0.19 * PRE_LATENESS_SCALE,
    distance: 0.16 * PRE_LATENESS_SCALE,
    tonneKilometers: 0.1 * PRE_LATENESS_SCALE,
    // Waiting is already inside totalWorkTime, so this stays token-sized. Price
    // it twice and the optimizer buys its way out of a wait by adding kilometres,
    // which is exactly the zigzag drivers complained about.
    waitingTime: 0.02 * PRE_LATENESS_SCALE,
    informationalTimeMismatch: 0.05 * PRE_LATENESS_SCALE,
    // Raised so backtracking and criss-crossing outweigh small clock wins; a
    // route that zigzags across the region is never the better answer.
    directionality: 0.16 * PRE_LATENESS_SCALE,
    endLocationConvenience: 0.05 * PRE_LATENESS_SCALE,
    maneuvers: 0.03 * PRE_LATENESS_SCALE,
    userPreferences: 0.06 * PRE_LATENESS_SCALE,
    // Sits in the weighted objective (unlike the criticalRank bands below) so
    // a route that is merely a little late can still be chosen over one that
    // burns many extra kilometres to be exactly on time. Priority stops
    // (stop.priority > 1) count each late minute x4 here — see
    // candidate-evaluator.ts's `lateness` component.
    lateness: 0.12,
  },
  normalizationCaps: {
    drivingTime: 600,
    totalWorkTime: 720,
    distance: 500,
    tonneKilometers: 1_000,
    // A full morning of waiting is normal when windows open late, so the cap
    // must not saturate and flatten the gradient.
    waitingTime: 600,
    informationalTimeMismatch: 240,
    directionality: 100,
    endLocationConvenience: 100,
    maneuvers: 100,
    // Matches the worst case preferencePenalty can now produce (a rank-1
    // priority stop, weight 11, parked at the very end), so the criterion uses
    // its whole 0..1 range instead of clipping.
    userPreferences: 110,
    lateness: 120,
  },
  tolerances: {
    durationMinutes: 2,
    distanceKm: 1,
    // A few minutes past a window is normal delivery practice and must not
    // disqualify an otherwise sensible route.
    requiredWindowMinutes: 10,
    // Below this, lateness never touches criticalRank (band 0) — its cost is
    // carried only by the `lateness` objective component above. Above it,
    // banding kicks in in 30-minute steps (see scoring.ts's latenessBand).
    latenessToleranceMinutes: 15,
    priorityLatenessToleranceMinutes: 5,
    // Leaving up to an hour later than planned to avoid standing at a closed
    // door is normal; waiting out a window that opens three hours later is not,
    // so past this the wait stays on the books.
    maxDepartureShiftMinutes: 60,
  },
};
