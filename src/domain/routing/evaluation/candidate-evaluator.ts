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
import { numericWeightKg, summarizeStopWeights } from '../weights';

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
  const schedules: CandidateStopSchedule[] = [];
  const legs: CandidateLeg[] = [];
  const warnings = [...matrix.warnings];
  const weightSummary = summarizeStopWeights(request.stops);
  if (weightSummary.unknownStopCount > 0) {
    warnings.push(
      `${weightSummary.unknownStopCount} taško(-ų) svoris nežinomas; svorio rodikliai skaičiuojami tik iš žinomų svorių.`,
    );
  }
  let cursor = Date.parse(request.plannedDepartureAt);
  let previousId = request.startLocation.id;
  let remainingLoadKg =
    request.initialLoadKg ??
    weightSummary.knownTotalKg;

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
      request.planningMode === 'with_time_windows'
        ? stop.requiredTimeWindow
        : undefined;
    const serviceStart = required
      ? Math.max(cursor, Date.parse(required.from))
      : cursor;
    const waiting = Math.max(0, (serviceStart - cursor) / 60_000);
    const late = required ? Math.max(0, (cursor - Date.parse(required.to)) / 60_000) : 0;
    const informationalMismatch = request.planningMode === 'with_time_windows'
      ? timeWindowMismatch(cursor, stop.informationalTimeWindow)
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

function preferencePenalty(sequence: string[], stops: OptimizationStop[]): number {
  const divisor = Math.max(1, sequence.length - 1);
  return sequence.reduce((sum, id, index) => {
    const stop = stops.find((item) => item.id === id);
    if (!stop) return sum;
    const normalizedPosition = index / divisor;
    const early = stop.preferEarly ? normalizedPosition * 10 * Math.max(1, stop.priority) : 0;
    const late = stop.preferLate ? (1 - normalizedPosition) * 10 * Math.max(1, stop.priority) : 0;
    return sum + early + late;
  }, 0);
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
