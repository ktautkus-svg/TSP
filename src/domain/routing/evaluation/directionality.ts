import type { RouteOptimizationRequest } from '../models';
import { haversineKm, segmentsIntersect, turnAngleDegrees } from './geo';

export type DirectionalityResult = {
  penalty: number;
  backtrackingKm: number;
  zigzagPoints: number;
  crossingCount: number;
  endRegressionKm: number;
};

/**
 * Heuristinis, deterministinis rodiklis. Jis matuoja geografinį grįžimą,
 * didelius krypties pokyčius, segmentų susikirtimus ir nutolimą nuo pabaigos
 * paskutinėje maršruto dalyje; tai nėra realaus vairavimo kokybės tiesa.
 */
export function evaluateDirectionality(
  stopSequence: string[],
  request: RouteOptimizationRequest,
): DirectionalityResult {
  const byId = new Map(request.stops.map((stop) => [stop.id, stop.location]));
  const locations = [
    request.startLocation,
    ...stopSequence.map((id) => byId.get(id)).filter((item) => item !== undefined),
    request.endLocation,
  ];

  let zigzagPoints = 0;
  for (let index = 1; index < locations.length - 1; index += 1) {
    const angle = turnAngleDegrees(
      locations[index - 1],
      locations[index],
      locations[index + 1],
    );
    if (angle > 100) zigzagPoints += (angle - 100) / 20;
  }

  let crossingCount = 0;
  for (let left = 0; left < locations.length - 1; left += 1) {
    for (let right = left + 2; right < locations.length - 1; right += 1) {
      if (left === 0 && right === locations.length - 2) continue;
      if (
        segmentsIntersect(
          locations[left],
          locations[left + 1],
          locations[right],
          locations[right + 1],
        )
      ) {
        crossingCount += 1;
      }
    }
  }

  const axisLat = request.endLocation.latitude - request.startLocation.latitude;
  const axisLng = request.endLocation.longitude - request.startLocation.longitude;
  const axisLengthSquared = axisLat ** 2 + axisLng ** 2;
  let backtrackingKm = 0;
  if (axisLengthSquared > 0) {
    let previousProjection = 0;
    for (const location of locations.slice(1)) {
      const projection =
        ((location.latitude - request.startLocation.latitude) * axisLat +
          (location.longitude - request.startLocation.longitude) * axisLng) /
        axisLengthSquared;
      if (projection < previousProjection) {
        backtrackingKm +=
          (previousProjection - projection) *
          haversineKm(request.startLocation, request.endLocation);
      }
      previousProjection = projection;
    }
  }

  let endRegressionKm = 0;
  const finalThirdStart = Math.max(1, Math.floor((locations.length * 2) / 3));
  let previousEndDistance = haversineKm(
    locations[finalThirdStart - 1],
    request.endLocation,
  );
  for (const location of locations.slice(finalThirdStart)) {
    const distance = haversineKm(location, request.endLocation);
    if (distance > previousEndDistance) endRegressionKm += distance - previousEndDistance;
    previousEndDistance = distance;
  }

  return {
    penalty: backtrackingKm + zigzagPoints * 2 + crossingCount * 4 + endRegressionKm * 2,
    backtrackingKm,
    zigzagPoints,
    crossingCount,
    endRegressionKm,
  };
}
