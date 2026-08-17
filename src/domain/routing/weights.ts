import type { OptimizationStop } from './models';

export type StopWeightSummary = {
  knownTotalKg: number;
  unknownStopCount: number;
  explicitZeroStopCount: number;
};

export function numericWeightKg(weightKg: number | null): number {
  return weightKg ?? 0;
}

// Matches the convention set by buildOptimizationStop (route-request-builder.ts):
// priorityFirst stops get priority > 1, everything else defaults to 1.
export function isPriorityStop(stop: OptimizationStop): boolean {
  return stop.priority > 1;
}

export function summarizeStopWeights(stops: OptimizationStop[]): StopWeightSummary {
  return stops.reduce<StopWeightSummary>(
    (summary, stop) => ({
      knownTotalKg: summary.knownTotalKg + numericWeightKg(stop.weightKg),
      unknownStopCount: summary.unknownStopCount + (stop.weightKg === null ? 1 : 0),
      explicitZeroStopCount:
        summary.explicitZeroStopCount + (stop.weightKg === 0 ? 1 : 0),
    }),
    { knownTotalKg: 0, unknownStopCount: 0, explicitZeroStopCount: 0 },
  );
}
