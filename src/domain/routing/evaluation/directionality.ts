import type { Coordinates, RouteOptimizationRequest } from '../models';
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

  // Backtracking is measured by projecting every node onto the route's main
  // axis. Taking that axis as start -> end collapses to zero length whenever the
  // driver returns to where he set off, which is the normal case here — and a
  // zero-length axis silently switched the whole term off, leaving the most
  // driver-legible part of the penalty at 0 for every round trip. When start and
  // end coincide, use start -> farthest stop instead: for an out-and-back run
  // that is the axis a human reads off the map anyway.
  const axis = directionAxis(locations, request.startLocation, request.endLocation);
  let backtrackingKm = 0;
  if (axis) {
    let previousProjection = 0;
    for (const location of locations.slice(1)) {
      const projection =
        ((location.latitude - request.startLocation.latitude) * axis.lat +
          (location.longitude - request.startLocation.longitude) * axis.lng) /
        axis.lengthSquared;
      if (projection < previousProjection) {
        backtrackingKm += (previousProjection - projection) * axis.lengthKm;
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

type DirectionAxis = { lat: number; lng: number; lengthSquared: number; lengthKm: number };

/**
 * The line the route is meant to run along. Normally start -> end; for a round
 * trip (end within a few hundred metres of start) that vector is degenerate, so
 * the farthest node on the route stands in for the far end.
 */
function directionAxis(
  locations: Coordinates[],
  startLocation: Coordinates,
  endLocation: Coordinates,
): DirectionAxis | null {
  const direct = axisFrom(startLocation, endLocation);
  if (direct) return direct;

  const farthest = locations.reduce<{ location: Coordinates; km: number } | null>(
    (best, location) => {
      const km = haversineKm(startLocation, location);
      return best === null || km > best.km ? { location, km } : best;
    },
    null,
  );
  return farthest ? axisFrom(startLocation, farthest.location) : null;
}

function axisFrom(from: Coordinates, to: Coordinates): DirectionAxis | null {
  const lat = to.latitude - from.latitude;
  const lng = to.longitude - from.longitude;
  const lengthSquared = lat ** 2 + lng ** 2;
  if (lengthSquared <= 0) return null;
  return { lat, lng, lengthSquared, lengthKm: haversineKm(from, to) };
}
