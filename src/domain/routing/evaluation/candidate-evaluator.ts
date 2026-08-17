import { evaluateConstraints } from '../constraints/constraint-evaluator';
import { evaluateDirectionality } from './directionality';
import { haversineKm } from './geo';
import { calculateLoadDistance } from './load-distance';
import { cappedObjective, zeroComponents } from '../scoring/scoring';
import type {
  CandidateLeg,
  CandidateStopSchedule,
  LocalSearchStats,
  MatrixCell,
  OptimizationStop,
  RouteCandidate,
  RouteOptimizationRequest,
  TravelMatrix,
} from '../models';
import { isPriorityStop, numericWeightKg, summarizeStopWeights } from '../weights';

const PRIORITY_LATENESS_MULTIPLIER = 4;

export function evaluateCandidate(input: {
  stopSequence: string[];
  generatedBy: string[];
  request: RouteOptimizationRequest;
  matrix: TravelMatrix;
  localSearch?: LocalSearchStats;
}): RouteCandidate {
  const { stopSequence, generatedBy, request, matrix } = input;
  const stopById = new Map(request.stops.map((stop) => [stop.id, stop]));
  const matrixIndex = new Map(matrix.nodeIds.map((id, index) => [id, index]));
  const warnings = [...matrix.warnings];
  const weightSummary = summarizeStopWeights(request.stops);
  if (weightSummary.unknownStopCount > 0) {
    warnings.push(
      `${weightSummary.unknownStopCount} taško(-ų) svoris nežinomas; svorio rodikliai skaičiuojami tik iš žinomų svorių.`,
    );
  }
  const context: SimulationContext = {
    stopSequence,
    stopById,
    request,
    matrix,
    matrixIndex,
    initialLoadKg: request.initialLoadKg ?? weightSummary.knownTotalKg,
  };

  // Waiting at the FIRST stop is the one wait a driver can delete outright, by
  // leaving the depot later — every later arrival stays exactly where it was.
  // Absorb it by re-running the whole schedule from the later departure, so
  // every time the driver is shown is a time he will actually drive, and record
  // how far the departure moved. The shift is bounded: past the tolerance the
  // truck genuinely is standing somewhere, and that waiting is priced like any
  // other waiting.
  //
  // The previous version zeroed the first wait in place without moving the
  // departure. That handed any sequence beginning on a late-opening stop a free
  // discount on totalWorkTime (measured: 179 minutes on a 6-stop route) while
  // still telling the driver to leave at the original hour.
  const plannedDepartureMs = Date.parse(request.plannedDepartureAt);
  const plannedRun = simulateStops(context, plannedDepartureMs);
  const departureShiftMinutes = Math.min(
    plannedRun.schedules[0]?.waitingMinutes ?? 0,
    request.scoring.tolerances.maxDepartureShiftMinutes,
  );
  const effectiveDepartureMs = plannedDepartureMs + departureShiftMinutes * 60_000;
  const run =
    departureShiftMinutes > 0 ? simulateStops(context, effectiveDepartureMs) : plannedRun;
  const { schedules, legs } = run;
  const previousId = run.lastId;
  const remainingLoadKg = run.remainingLoadKg;
  let cursor = run.cursorMs;

  const endCell = getCell(matrix, matrixIndex, previousId, request.endLocation.id);
  const endDuration = usable(endCell?.durationMinutes);
  const endDistance = usable(endCell?.distanceKm);
  const endDeparture = new Date(cursor).toISOString();
  cursor += endDuration * 60_000;
  legs.push({
    fromId: previousId,
    toId: request.endLocation.id,
    departureAt: endDeparture,
    arrivalAt: new Date(cursor).toISOString(),
    distanceKm: endDistance,
    durationMinutes: endDuration,
    carriedLoadKg: remainingLoadKg,
    remainingLoadKgAfterArrival: remainingLoadKg,
    tonneKilometers: (remainingLoadKg / 1000) * endDistance,
    maneuverPenalty: endCell?.maneuverPenalty ?? 0,
    reachable: endCell?.reachable ?? false,
    restrictionWarnings: endCell?.restrictionWarnings ?? [],
  });

  const totalDistanceKm = sum(legs.map((leg) => leg.distanceKm));
  const drivingMinutes = sum(legs.map((leg) => leg.durationMinutes));
  const serviceMinutes = sum(
    stopSequence.map((id) => stopById.get(id)?.serviceDurationMinutes ?? 0),
  );
  const waitingMinutes = sum(schedules.map((schedule) => schedule.waitingMinutes));
  const totalWorkMinutes = drivingMinutes + serviceMinutes + waitingMinutes;
  const loadDistance = calculateLoadDistance(
    legs.map((leg) => ({
      fromId: leg.fromId,
      toId: leg.toId,
      distanceKm: leg.distanceKm,
      carriedLoadKg: leg.carriedLoadKg,
    })),
  );
  const orderedLocations = stopSequence
    .map((id) => stopById.get(id)?.location)
    .filter((location): location is NonNullable<typeof location> => Boolean(location));
  const direction = evaluateDirectionality(stopSequence, request);
  const userPreferences = preferencePenalty(stopSequence, request.stops);
  const endLocationConvenience =
    orderedLocations.length === 0
      ? 0
      : haversineKm(orderedLocations.at(-1)!, request.endLocation);
  // Charged on minutes BEYOND the stop's tolerance, exactly like criticalRank
  // does (constraint-evaluator.ts). Pricing tolerated minutes here as well
  // contradicted the tolerance we publish: with a 15-minute grace period, an
  // 8-minute overrun still cost enough to lose against a 45 km detour that
  // arrived on time. Within tolerance is within tolerance.
  //
  // A priority stop running late costs the same driver time as an ordinary one,
  // but matters more to the business, so its excess minutes count x4.
  const lateness = sum(
    schedules.map((schedule) => {
      const stop = stopById.get(schedule.stopId);
      const priority = Boolean(stop && isPriorityStop(stop));
      const tolerance = priority
        ? request.scoring.tolerances.priorityLatenessToleranceMinutes
        : request.scoring.tolerances.latenessToleranceMinutes;
      const excess = Math.max(0, schedule.lateMinutes - tolerance);
      return excess * (priority ? PRIORITY_LATENESS_MULTIPLIER : 1);
    }),
  );
  const rawScoreComponents = {
    drivingTime: drivingMinutes,
    totalWorkTime: totalWorkMinutes,
    distance: totalDistanceKm,
    tonneKilometers: loadDistance.totalTonneKilometers,
    waitingTime: waitingMinutes,
    informationalTimeMismatch: sum(
      schedules.map((schedule) => schedule.informationalMismatchMinutes),
    ),
    directionality: direction.penalty,
    endLocationConvenience,
    maneuvers: sum(legs.map((leg) => leg.maneuverPenalty)),
    userPreferences,
    lateness,
  };
  const constraintResult = evaluateConstraints({
    stopSequence,
    schedules,
    legs,
    request,
    matrixNodeIds: matrix.nodeIds,
  });
  if (legs.some((leg) => !leg.reachable)) warnings.push('Matricoje yra nepasiekiamų atkarpų.');
  const initialObjective = cappedObjective(rawScoreComponents, request.scoring);
  const localSearch = input.localSearch ?? {
    iterations: 0,
    initialSequence: [...stopSequence],
    initialObjective,
    finalObjective: initialObjective,
    improvementPercent: 0,
    stoppedBy: 'no_improvement',
  };

  return {
    id: candidateId(stopSequence),
    provider: matrix.provider,
    stopSequence,
    generatedBy: [...new Set(generatedBy)],
    effectiveDepartureAt: new Date(effectiveDepartureMs).toISOString(),
    departureShiftMinutes,
    schedules,
    legs,
    totalDistanceKm,
    drivingMinutes,
    serviceMinutes,
    waitingMinutes,
    totalWorkMinutes,
    totalLateMinutes: sum(schedules.map((schedule) => schedule.lateMinutes)),
    maximumSingleStopLateMinutes: Math.max(0, ...schedules.map((schedule) => schedule.lateMinutes)),
    tonneKilometers: loadDistance.totalTonneKilometers,
    directionalityPenalty: direction.penalty,
    maneuverPenalty: rawScoreComponents.maneuvers,
    violations: constraintResult.violations,
    feasible: !constraintResult.violations.some((item) => item.type === 'hard'),
    criticalRank: constraintResult.criticalRank,
    rawScoreComponents,
    normalizedScoreComponents: zeroComponents(),
    totalScore: null,
    localSearch,
    warnings: [...new Set(warnings)],
    explanations: [],
  };
}

type SimulationContext = {
  stopSequence: string[];
  stopById: Map<string, OptimizationStop>;
  request: RouteOptimizationRequest;
  matrix: TravelMatrix;
  matrixIndex: Map<string, number>;
  initialLoadKg: number;
};

type Simulation = {
  schedules: CandidateStopSchedule[];
  legs: CandidateLeg[];
  cursorMs: number;
  lastId: string;
  remainingLoadKg: number;
};

/**
 * Drives the sequence forward from a given departure time and records what
 * happens. Pure and repeatable, so `evaluateCandidate` can run it twice: once
 * from the planned departure to discover how long the truck would stand at the
 * first door, then again from the departure that removes that wait.
 */
function simulateStops(context: SimulationContext, departureAtMs: number): Simulation {
  const { stopSequence, stopById, request, matrix, matrixIndex } = context;
  const schedules: CandidateStopSchedule[] = [];
  const legs: CandidateLeg[] = [];
  let cursor = departureAtMs;
  let previousId = request.startLocation.id;
  let remainingLoadKg = context.initialLoadKg;

  for (const [index, stopId] of stopSequence.entries()) {
    const stop = stopById.get(stopId);
    if (!stop) continue;
    const cell = getCell(matrix, matrixIndex, previousId, stopId);
    const duration = usable(cell?.durationMinutes);
    const distance = usable(cell?.distanceKm);
    const departureAt = new Date(cursor).toISOString();
    cursor += duration * 60_000;
    const arrivalAt = new Date(cursor).toISOString();
    const required =
      request.planningMode === 'with_time_windows' ? stop.requiredTimeWindow : undefined;
    // A driver who arrives before the door opens waits at the kerb; he does not
    // drive laps to burn the clock. Modelling the wait for every known window
    // stops early arrival from looking more expensive than extra kilometres.
    const honouredWindow =
      request.planningMode === 'with_time_windows'
        ? required ?? stop.informationalTimeWindow
        : undefined;
    const opensAt = honouredWindow ? Date.parse(honouredWindow.from) : Number.NaN;
    const serviceStart = Number.isFinite(opensAt) ? Math.max(cursor, opensAt) : cursor;
    const waiting = Math.max(0, (serviceStart - cursor) / 60_000);
    const late = required ? Math.max(0, (cursor - Date.parse(required.to)) / 60_000) : 0;
    // Measured at the moment of handover, so waiting for the window to open is
    // not counted a second time as a mismatch.
    const informationalMismatch =
      request.planningMode === 'with_time_windows'
        ? timeWindowMismatch(serviceStart, stop.informationalTimeWindow)
        : 0;
    cursor = serviceStart + stop.serviceDurationMinutes * 60_000;
    const loadAfter = Math.max(0, remainingLoadKg - numericWeightKg(stop.weightKg));
    legs.push({
      fromId: previousId,
      toId: stopId,
      departureAt,
      arrivalAt,
      distanceKm: distance,
      durationMinutes: duration,
      carriedLoadKg: remainingLoadKg,
      remainingLoadKgAfterArrival: loadAfter,
      tonneKilometers: (remainingLoadKg / 1000) * distance,
      maneuverPenalty: cell?.maneuverPenalty ?? 0,
      reachable: cell?.reachable ?? false,
      restrictionWarnings: cell?.restrictionWarnings ?? [],
    });
    schedules.push({
      stopId,
      order: index + 1,
      arrivalAt,
      serviceStartAt: new Date(serviceStart).toISOString(),
      departureAt: new Date(cursor).toISOString(),
      waitingMinutes: waiting,
      lateMinutes: late,
      informationalMismatchMinutes: informationalMismatch,
    });
    remainingLoadKg = loadAfter;
    previousId = stopId;
  }

  return { schedules, legs, cursorMs: cursor, lastId: previousId, remainingLoadKg };
}

function getCell(
  matrix: TravelMatrix,
  index: Map<string, number>,
  fromId: string,
  toId: string,
): MatrixCell | undefined {
  const from = index.get(fromId);
  const to = index.get(toId);
  return from === undefined || to === undefined ? undefined : matrix.cells[from]?.[to];
}

function usable(value: number | null | undefined): number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function timeWindowMismatch(
  arrivalMs: number,
  window: OptimizationStop['informationalTimeWindow'],
): number {
  if (!window) return 0;
  if (arrivalMs < Date.parse(window.from)) return (Date.parse(window.from) - arrivalMs) / 60_000;
  if (arrivalMs > Date.parse(window.to)) return (arrivalMs - Date.parse(window.to)) / 60_000;
  return 0;
}

/**
 * Averaged over the stops that actually express a preference, not summed.
 *
 * Summing made the raw value grow with the number of priority stops: three of
 * them at the wrong end of the route scored ~269 against a cap of 100, so every
 * badly-ordered variant clipped to the same 100 and the optimizer could no
 * longer tell "third from last" from "dead last". The mean keeps the value in
 * 0..110 whatever the stop count, which is exactly the cap, so the gradient
 * survives all the way to the worst case.
 */
function preferencePenalty(sequence: string[], stops: OptimizationStop[]): number {
  const positionDivisor = Math.max(1, sequence.length - 1);
  const stopById = new Map(stops.map((stop) => [stop.id, stop]));
  let total = 0;
  let expressed = 0;
  for (const [index, id] of sequence.entries()) {
    const stop = stopById.get(id);
    if (!stop || (!stop.preferEarly && !stop.preferLate)) continue;
    expressed += 1;
    const normalizedPosition = index / positionDivisor;
    const rankWeight = 10 * Math.max(1, stop.priority);
    if (stop.preferEarly) total += normalizedPosition * rankWeight;
    if (stop.preferLate) total += (1 - normalizedPosition) * rankWeight;
  }
  return expressed === 0 ? 0 : total / expressed;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function candidateId(sequence: string[]): string {
  let hash = 2166136261;
  for (const character of sequence.join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `candidate-${(hash >>> 0).toString(16)}`;
}
