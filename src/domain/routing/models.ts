import type { PlanningMode } from '@/domain/route';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type RoutingLocation = Coordinates & {
  id: string;
  label: string;
  address?: string;
};

export type VehicleRoutingProfile = {
  id: string;
  type: 'car' | 'van' | 'truck';
  maximumPayloadKg: number;
  heightM?: number;
  widthM?: number;
  lengthM?: number;
  grossWeightKg?: number;
  useRoadRestrictions: boolean;
  startLocation: RoutingLocation;
  defaultEndLocation: RoutingLocation;
};

export type StopTimeWindow = {
  from: string;
  to: string;
};

export type OptimizationStop = {
  id: string;
  location: RoutingLocation;
  /** null means that the document did not provide a weight; 0 is an explicit zero. */
  weightKg: number | null;
  serviceDurationMinutes: number;
  informationalTimeWindow?: StopTimeWindow;
  requiredTimeWindow?: StopTimeWindow;
  priority: number;
  lockedPosition?: number;
  deliverBeforeStopIds: string[];
  deliverAfterStopIds: string[];
  preferEarly: boolean;
  preferLate: boolean;
  mustBeFirst: boolean;
  mustBeLast: boolean;
};

export type TrafficMode = 'none' | 'historical' | 'live' | 'synthetic';
export type ProviderExecutionMode = 'real' | 'stub' | 'synthetic' | 'cache';

export type RoutingScoreKey =
  | 'drivingTime'
  | 'totalWorkTime'
  | 'distance'
  | 'tonneKilometers'
  | 'waitingTime'
  | 'informationalTimeMismatch'
  | 'directionality'
  | 'endLocationConvenience'
  | 'maneuvers'
  | 'userPreferences';

export type RoutingScoringConfig = {
  weights: Record<RoutingScoreKey, number>;
  normalizationCaps: Record<RoutingScoreKey, number>;
  tolerances: {
    durationMinutes: number;
    distanceKm: number;
    requiredWindowMinutes: number;
  };
};

export type RouteOptimizationRequest = {
  routeId: string;
  startLocation: RoutingLocation;
  endLocation: RoutingLocation;
  plannedDepartureAt: string;
  vehicle: VehicleRoutingProfile;
  stops: OptimizationStop[];
  initialLoadKg?: number;
  planningMode: PlanningMode;
  scoring: RoutingScoringConfig;
  trafficMode: TrafficMode;
  workdayEndAt?: string;
  maxIterations: number;
  maxCalculationMs: number;
  randomSeeds: number[];
};

export type MatrixCell = {
  distanceKm: number | null;
  durationMinutes: number | null;
  reachable: boolean;
  maneuverPenalty: number;
  restrictionWarnings: string[];
};

export type TravelMatrix = {
  provider: string;
  executionMode: ProviderExecutionMode;
  nodeIds: string[];
  cells: MatrixCell[][];
  fetchedAt: string;
  trafficMode: TrafficMode;
  departureAt: string;
  warnings: string[];
  version: string;
};

export type ConstraintViolationCode =
  | 'MAX_PAYLOAD'
  | 'REQUIRED_TIME_WINDOW'
  | 'LOCKED_POSITION'
  | 'DELIVER_BEFORE'
  | 'DELIVER_AFTER'
  | 'MUST_BE_FIRST'
  | 'MUST_BE_LAST'
  | 'UNREACHABLE_LEG'
  | 'ROAD_RESTRICTION'
  | 'INVALID_START'
  | 'INVALID_END'
  | 'WORKDAY_END'
  | 'MISSING_STOP'
  | 'DUPLICATE_STOP'
  | 'UNKNOWN_STOP';

export type ConstraintViolation = {
  code: ConstraintViolationCode;
  /** 'hard' violations make a candidate infeasible; 'soft' ones are surfaced as a warning but never block selection. */
  type: 'hard' | 'soft';
  stopId: string | null;
  explanation: string;
  actualValue: string | number | null;
  allowedValue: string | number | null;
  severity: 'critical' | 'error' | 'warning';
};

export type CandidateLeg = {
  fromId: string;
  toId: string;
  departureAt: string;
  arrivalAt: string;
  distanceKm: number;
  durationMinutes: number;
  carriedLoadKg: number;
  remainingLoadKgAfterArrival: number;
  tonneKilometers: number;
  maneuverPenalty: number;
  reachable: boolean;
  restrictionWarnings: string[];
};

export type CandidateStopSchedule = {
  stopId: string;
  order: number;
  arrivalAt: string;
  serviceStartAt: string;
  departureAt: string;
  waitingMinutes: number;
  lateMinutes: number;
  informationalMismatchMinutes: number;
};

export type RawScoreComponents = Record<RoutingScoreKey, number>;
export type NormalizedScoreComponents = Record<RoutingScoreKey, number>;

export type CriticalRank = {
  unservedRequiredStops: number;
  requiredWindowViolations: number;
  totalLateMinutes: number;
  maximumSingleStopLateMinutes: number;
  workdayOverrunMinutes: number;
  criticalRoadOrVehicleViolations: number;
};

export type ExplanationEvidence = {
  code:
    | 'HEAVY_STOP_EARLIER'
    | 'LOWER_TONNE_KM'
    | 'REQUIRED_WINDOW'
    | 'LONGER_BUT_FASTER'
    | 'BETTER_END_LOCATION'
    | 'LESS_BACKTRACKING'
    | 'MANUAL_CONSTRAINT'
    | 'NO_FEASIBLE_ROUTE';
  text: string;
  criterion: RoutingScoreKey | 'feasibility';
  baselineValue: number | string | null;
  selectedValue: number | string | null;
  difference: number | null;
  dataSource: string;
  relatedStopIds: string[];
};

export type LocalSearchStats = {
  iterations: number;
  initialSequence: string[];
  initialObjective: number;
  finalObjective: number;
  improvementPercent: number;
  stoppedBy: 'no_improvement' | 'iteration_limit' | 'time_limit';
};

export type RouteCandidate = {
  id: string;
  provider: string;
  stopSequence: string[];
  generatedBy: string[];
  schedules: CandidateStopSchedule[];
  legs: CandidateLeg[];
  totalDistanceKm: number;
  drivingMinutes: number;
  serviceMinutes: number;
  waitingMinutes: number;
  totalWorkMinutes: number;
  totalLateMinutes: number;
  maximumSingleStopLateMinutes: number;
  tonneKilometers: number;
  directionalityPenalty: number;
  maneuverPenalty: number;
  violations: ConstraintViolation[];
  feasible: boolean;
  criticalRank: CriticalRank;
  rawScoreComponents: RawScoreComponents;
  normalizedScoreComponents: NormalizedScoreComponents;
  totalScore: number | null;
  localSearch: LocalSearchStats;
  warnings: string[];
  explanations: ExplanationEvidence[];
};

export type RouteOptimizationResult = {
  requestId: string;
  provider: string;
  executionMode: ProviderExecutionMode;
  generatedAt: string;
  matrixFetchedAt: string;
  feasibleRouteFound: boolean;
  recommended: RouteCandidate | null;
  alternatives: RouteCandidate[];
  diagnosticCandidate: RouteCandidate | null;
  candidates: RouteCandidate[];
  conflictingConstraints: ConstraintViolation[];
  suggestions: string[];
  warnings: string[];
};

export type RoutePolylineLeg = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  startLocation?: unknown;
  endLocation?: unknown;
};

export type RoutePolylineResult = {
  provider: string;
  executionMode: ProviderExecutionMode;
  encodedPolyline: string;
  distanceMeters: number;
  durationSeconds: number;
  legs: RoutePolylineLeg[];
  warnings: string[];
  fetchedAt: string;
  version: string;
};

export interface RouteOptimizer {
  optimize(request: RouteOptimizationRequest): Promise<RouteOptimizationResult>;
}

export type MatrixRequest = {
  locations: RoutingLocation[];
  vehicle: VehicleRoutingProfile;
  departureAt: string;
  trafficMode: TrafficMode;
  timeoutMs: number;
};

export interface TravelCostProvider {
  readonly name: string;
  getMatrix(request: MatrixRequest): Promise<TravelMatrix>;
}

export type RecalculationRequest = {
  originalRequest: RouteOptimizationRequest;
  completedStopIds: string[];
  currentLocation: RoutingLocation;
  currentTime: string;
  remainingLoadKg: number;
  previousRemainingCandidate: RouteCandidate;
  addedOrFailedStop?: OptimizationStop;
};

export type RecalculationResult = {
  optimization: RouteOptimizationResult;
  preservedCompletedStopIds: string[];
  timeDeltaMinutes: number | null;
  distanceDeltaKm: number | null;
  changedStopIds: string[];
};

export type ManualRouteEvaluation = {
  candidate: RouteCandidate;
  timeDeltaMinutes: number;
  distanceDeltaKm: number;
  tonneKilometerDelta: number;
  lateMinuteDelta: number;
  impact: 'minor' | 'significant' | 'critical';
};
