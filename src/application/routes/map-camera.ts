/** Whether an automatic fitBounds is allowed. User pan/zoom wins until they ask. */
export function shouldRefitMap(input: {
  previousSignature: string | null;
  nextSignature: string;
  userAdjusted: boolean;
  explicit: boolean;
}): boolean {
  if (!input.nextSignature) return false;
  if (input.explicit) return true;
  if (input.previousSignature === null) return true;
  if (input.previousSignature !== input.nextSignature && !input.userAdjusted) return true;
  return false;
}

export function mapGeometrySignature(points: readonly (readonly [number, number])[]): string {
  return points
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    .map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .join('|');
}
