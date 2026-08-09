import type { RoutingScoringConfig } from './models';

export const DEFAULT_ROUTING_SCORING: RoutingScoringConfig = {
  weights: {
    drivingTime: 0.18,
    totalWorkTime: 0.19,
    distance: 0.13,
    tonneKilometers: 0.1,
    waitingTime: 0.07,
    informationalTimeMismatch: 0.05,
    // Raised so backtracking and criss-crossing outweigh small clock wins; a
    // route that zigzags across the region is never the better answer.
    directionality: 0.14,
    endLocationConvenience: 0.05,
    maneuvers: 0.03,
    userPreferences: 0.06,
  },
  normalizationCaps: {
    drivingTime: 600,
    totalWorkTime: 720,
    distance: 500,
    tonneKilometers: 1_000,
    waitingTime: 180,
    informationalTimeMismatch: 240,
    directionality: 100,
    endLocationConvenience: 100,
    maneuvers: 100,
    userPreferences: 100,
  },
  tolerances: {
    durationMinutes: 2,
    distanceKm: 1,
    // A few minutes past a window is normal delivery practice and must not
    // disqualify an otherwise sensible route.
    requiredWindowMinutes: 10,
  },
};
