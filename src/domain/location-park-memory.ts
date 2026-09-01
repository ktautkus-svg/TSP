import { haversineKm } from '@/domain/routing/evaluation/geo';

/** Ignore a GPS fix worse than this — rooftop geocode is then more honest. */
export const PARK_PIN_MAX_ACCURACY_M = 65;
/** Reject a sample that is clearly not at this stop (courtyard vs next street). */
export const PARK_PIN_MAX_DISTANCE_M = 320;
/** ATLIKTA only learns from a fix captured this recently. */
export const PARK_PIN_MAX_AGE_MS = 90_000;

export type GpsSample = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  heading: number | null;
  capturedAtMs: number;
};

export type LearnedParkPin = {
  latitude: number;
  longitude: number;
  heading: number | null;
  accuracyM: number | null;
  sampleCount: number;
  lastSampledAt: string;
};

export type ParkSampleRejection = 'missing_fix' | 'stale' | 'inaccurate' | 'too_far';

export type ParkSampleDecision =
  | { accepted: false; reason: ParkSampleRejection }
  | { accepted: true; pin: LearnedParkPin };

export type GeoPoint = {
  latitude: number | null;
  longitude: number | null;
};

/**
 * Customer-facing geocode stays on `latitude`/`longitude`. Navigation and the
 * routing engine use the learned courtyard pin when one exists.
 */
export function routingCoordinates(point: GeoPoint & {
  parkLatitude?: number | null;
  parkLongitude?: number | null;
}): { latitude: number; longitude: number } | null {
  if (Number.isFinite(point.parkLatitude) && Number.isFinite(point.parkLongitude)) {
    return { latitude: point.parkLatitude as number, longitude: point.parkLongitude as number };
  }
  if (Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
    return { latitude: point.latitude as number, longitude: point.longitude as number };
  }
  return null;
}

export function evaluateParkSample(input: {
  sample: GpsSample | null | undefined;
  geocode: GeoPoint;
  previous: LearnedParkPin | null;
  nowMs?: number;
}): ParkSampleDecision {
  const sample = input.sample;
  if (!sample || !Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude)) {
    return { accepted: false, reason: 'missing_fix' };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(sample.capturedAtMs) || nowMs - sample.capturedAtMs > PARK_PIN_MAX_AGE_MS) {
    return { accepted: false, reason: 'stale' };
  }
  if (sample.accuracyM !== null && (!Number.isFinite(sample.accuracyM) || sample.accuracyM > PARK_PIN_MAX_ACCURACY_M)) {
    return { accepted: false, reason: 'inaccurate' };
  }
  const anchors = [input.previous, finitePoint(input.geocode)].filter((point): point is { latitude: number; longitude: number } => point !== null);
  if (anchors.length > 0) {
    const nearestM = Math.min(...anchors.map((anchor) => haversineKm(anchor, sample) * 1_000));
    if (nearestM > PARK_PIN_MAX_DISTANCE_M) return { accepted: false, reason: 'too_far' };
  }
  return { accepted: true, pin: mergeParkPin(input.previous, sample) };
}

export function mergeParkPin(previous: LearnedParkPin | null, sample: GpsSample): LearnedParkPin {
  const lastSampledAt = new Date(sample.capturedAtMs).toISOString();
  const heading = finiteHeading(sample.heading);
  if (!previous) {
    return {
      latitude: sample.latitude,
      longitude: sample.longitude,
      heading,
      accuracyM: finiteOrNull(sample.accuracyM),
      sampleCount: 1,
      lastSampledAt,
    };
  }
  const nextCount = previous.sampleCount + 1;
  const weight = 1 / nextCount;
  return {
    latitude: previous.latitude * (1 - weight) + sample.latitude * weight,
    longitude: previous.longitude * (1 - weight) + sample.longitude * weight,
    heading: heading ?? previous.heading,
    accuracyM: finiteOrNull(sample.accuracyM) ?? previous.accuracyM,
    sampleCount: nextCount,
    lastSampledAt,
  };
}

function finitePoint(point: GeoPoint): { latitude: number; longitude: number } | null {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  return { latitude: point.latitude as number, longitude: point.longitude as number };
}

function finiteHeading(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return ((value % 360) + 360) % 360;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}
