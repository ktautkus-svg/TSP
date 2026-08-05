import { evaluateCandidate } from '@/domain/routing/evaluation/candidate-evaluator';
import type {
  ManualRouteEvaluation,
  RouteCandidate,
  RouteOptimizationRequest,
  TravelMatrix,
} from '@/domain/routing/models';

export function evaluateManualRoute(input: {
  stopSequence: string[];
  baseline: RouteCandidate;
  request: RouteOptimizationRequest;
  matrix: TravelMatrix;
}): ManualRouteEvaluation {
  const candidate = evaluateCandidate({
    stopSequence: input.stopSequence,
    generatedBy: ['manual_edit'],
    request: input.request,
    matrix: input.matrix,
  });
  const timeDeltaMinutes = candidate.totalWorkMinutes - input.baseline.totalWorkMinutes;
  const distanceDeltaKm = candidate.totalDistanceKm - input.baseline.totalDistanceKm;
  const tonneKilometerDelta = candidate.tonneKilometers - input.baseline.tonneKilometers;
  const lateMinuteDelta = candidate.totalLateMinutes - input.baseline.totalLateMinutes;
  const impact =
    !candidate.feasible || lateMinuteDelta > 0
      ? 'critical'
      : timeDeltaMinutes > 15 || distanceDeltaKm > 10
        ? 'significant'
        : 'minor';
  return {
    candidate,
    timeDeltaMinutes,
    distanceDeltaKm,
    tonneKilometerDelta,
    lateMinuteDelta,
    impact,
  };
}
