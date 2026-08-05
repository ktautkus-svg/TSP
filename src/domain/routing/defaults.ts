import type { RoutingScoringConfig } from './models';

export const DEFAULT_ROUTING_SCORING: RoutingScoringConfig = {
  weights: {
    drivingTime: 0.18,
    totalWorkTime: 0.2,
    distance: 0.11,
    tonneKilometers: 0.13,
    waitingTime: 0.07,
    informationalTimeMismatch: 0.06,
    directionality: 0.09,
    endLocationConvenience: 0.05,
    maneuvers: 0.04,
    userPreferences: 0.07,
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
    requiredWindowMinutes: 0,
  },
};
