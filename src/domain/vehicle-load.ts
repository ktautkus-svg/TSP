/**
 * Cargo load against the vehicle payload (tonnage) norm:
 * routeWeightKg / maximumPayloadKg * 100.
 */
export function vehicleLoadPercent(weightKg: number, payloadKg: number): number | null {
  if (!Number.isFinite(weightKg) || weightKg < 0) return null;
  if (!Number.isFinite(payloadKg) || payloadKg <= 0) return null;
  return (weightKg / payloadKg) * 100;
}
