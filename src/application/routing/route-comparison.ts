import type {
  ExplanationEvidence,
  RouteCandidate,
  RouteOptimizationRequest,
} from '@/domain/routing/models';
import { numericWeightKg } from '@/domain/routing/weights';

export function routeDiversity(left: RouteCandidate, right: RouteCandidate): number {
  const leftEdges = edges(left.stopSequence);
  const rightEdges = edges(right.stopSequence);
  const intersection = [...leftEdges].filter((edge) => rightEdges.has(edge)).length;
  const union = new Set([...leftEdges, ...rightEdges]).size;
  const edgeDiversity = union === 0 ? 0 : 1 - intersection / union;
  const positionChanges = left.stopSequence.filter(
    (id, index) => right.stopSequence[index] !== id,
  ).length;
  return Math.max(edgeDiversity, positionChanges / Math.max(1, left.stopSequence.length));
}

export function buildExplanations(
  selected: RouteCandidate,
  baseline: RouteCandidate,
  request: RouteOptimizationRequest,
): ExplanationEvidence[] {
  const evidence: ExplanationEvidence[] = [];
  const add = (item: ExplanationEvidence) => {
    if (evidence.length < 4) evidence.push(item);
  };
  const heaviest = [...request.stops].sort(
    (left, right) => numericWeightKg(right.weightKg) - numericWeightKg(left.weightKg),
  )[0];
  const selectedHeavyIndex = selected.stopSequence.indexOf(heaviest.id);
  const baselineHeavyIndex = baseline.stopSequence.indexOf(heaviest.id);
  if (
    numericWeightKg(heaviest.weightKg) > 0 &&
    selectedHeavyIndex >= 0 &&
    baselineHeavyIndex >= 0 &&
    selectedHeavyIndex < baselineHeavyIndex
  ) {
    add({
      code: 'HEAVY_STOP_EARLIER',
      text: `${Math.round(numericWeightKg(heaviest.weightKg))} kg krovinys perkeltas ${
        baselineHeavyIndex - selectedHeavyIndex
      } pozicijomis anksčiau.`,
      criterion: 'tonneKilometers',
      baselineValue: baselineHeavyIndex + 1,
      selectedValue: selectedHeavyIndex + 1,
      difference: selectedHeavyIndex - baselineHeavyIndex,
      dataSource: 'taško svoris ir kandidatų sekos',
      relatedStopIds: [heaviest.id],
    });
  }

  if (selected.tonneKilometers + 0.01 < baseline.tonneKilometers) {
    add({
      code: 'LOWER_TONNE_KM',
      text: `Krovinio vežimo rodiklis sumažintas ${round(
        baseline.tonneKilometers - selected.tonneKilometers,
      )} t·km.`,
      criterion: 'tonneKilometers',
      baselineValue: round(baseline.tonneKilometers),
      selectedValue: round(selected.tonneKilometers),
      difference: round(selected.tonneKilometers - baseline.tonneKilometers),
      dataSource: 'kelionės matrica ir taškų svoriai',
      relatedStopIds: selected.stopSequence,
    });
  }
  if (
    selected.totalDistanceKm > baseline.totalDistanceKm + 1 &&
    selected.drivingMinutes + 2 < baseline.drivingMinutes
  ) {
    add({
      code: 'LONGER_BUT_FASTER',
      text: `Pasirinkta ${round(
        selected.totalDistanceKm - baseline.totalDistanceKm,
      )} km ilgesnė, bet ${round(
        baseline.drivingMinutes - selected.drivingMinutes,
      )} min greitesnė seka.`,
      criterion: 'drivingTime',
      baselineValue: round(baseline.drivingMinutes),
      selectedValue: round(selected.drivingMinutes),
      difference: round(selected.drivingMinutes - baseline.drivingMinutes),
      dataSource: 'tiekėjo kelionės matrica',
      relatedStopIds: [],
    });
  }
  const requiredStops = request.stops.filter((stop) => stop.requiredTimeWindow);
  if (requiredStops.length > 0 && selected.criticalRank.requiredWindowViolations === 0) {
    add({
      code: 'REQUIRED_WINDOW',
      text: `Išlaikyti ${requiredStops.length} privalomi pristatymo laiko langai.`,
      criterion: 'feasibility',
      baselineValue: baseline.criticalRank.requiredWindowViolations,
      selectedValue: 0,
      difference: -baseline.criticalRank.requiredWindowViolations,
      dataSource: 'privalomi taškų laiko langai',
      relatedStopIds: requiredStops.map((stop) => stop.id),
    });
  }
  if (selected.directionalityPenalty + 1 < baseline.directionalityPenalty) {
    add({
      code: 'LESS_BACKTRACKING',
      text: 'Seka turi mažiau geografinio grįžimo ir zigzagų.',
      criterion: 'directionality',
      baselineValue: round(baseline.directionalityPenalty),
      selectedValue: round(selected.directionalityPenalty),
      difference: round(selected.directionalityPenalty - baseline.directionalityPenalty),
      dataSource: 'deterministinė kryptingumo heuristika',
      relatedStopIds: [],
    });
  }
  if (
    selected.rawScoreComponents.endLocationConvenience + 0.5 <
    baseline.rawScoreComponents.endLocationConvenience
  ) {
    add({
      code: 'BETTER_END_LOCATION',
      text: 'Paskutinis pristatymas palieka trumpesnę atkarpą iki pasirinktos pabaigos.',
      criterion: 'endLocationConvenience',
      baselineValue: round(baseline.rawScoreComponents.endLocationConvenience),
      selectedValue: round(selected.rawScoreComponents.endLocationConvenience),
      difference: round(
        selected.rawScoreComponents.endLocationConvenience -
          baseline.rawScoreComponents.endLocationConvenience,
      ),
      dataSource: 'paskutinio taško ir pabaigos vietos koordinatės',
      relatedStopIds: selected.stopSequence.at(-1) ? [selected.stopSequence.at(-1)!] : [],
    });
  }
  if (request.stops.some((stop) => stop.lockedPosition !== undefined || stop.mustBeFirst || stop.mustBeLast)) {
    add({
      code: 'MANUAL_CONSTRAINT',
      text: 'Išlaikytos naudotojo užrakintos pozicijos ir eiliškumo taisyklės.',
      criterion: 'userPreferences',
      baselineValue: null,
      selectedValue: 'išlaikyta',
      difference: null,
      dataSource: 'naudotojo apribojimai',
      relatedStopIds: request.stops
        .filter((stop) => stop.lockedPosition !== undefined || stop.mustBeFirst || stop.mustBeLast)
        .map((stop) => stop.id),
    });
  }
  return evidence;
}

function edges(sequence: string[]): Set<string> {
  return new Set(sequence.slice(1).map((id, index) => `${sequence[index]}>${id}`));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
