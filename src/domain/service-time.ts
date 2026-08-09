/**
 * How long a driver spends at one stop.
 *
 * Handling time scales with the load: heavier drops take longer to move off the
 * truck. The floor covers parking, paperwork and the walk to the door, which a
 * one-parcel stop still costs. Tune the model here - it is the only place these
 * numbers live.
 */
export const SERVICE_TIME_MODEL = {
  /** Kilograms a driver can unload per minute. */
  kilogramsPerMinute: 5,
  /** Never shorter than this, however light the drop. */
  minimumMinutes: 5,
  /** Guards against one absurd row swallowing the whole workday. */
  maximumMinutes: 45,
  /** Used when the file gave no weight at all. */
  unknownWeightMinutes: 10,
} as const;

export function serviceMinutesForWeight(weightKg: number | null | undefined): number {
  if (weightKg === null || weightKg === undefined || !Number.isFinite(weightKg)) {
    return SERVICE_TIME_MODEL.unknownWeightMinutes;
  }
  const handling = Math.round(Math.max(0, weightKg) / SERVICE_TIME_MODEL.kilogramsPerMinute);
  return Math.min(
    SERVICE_TIME_MODEL.maximumMinutes,
    Math.max(SERVICE_TIME_MODEL.minimumMinutes, handling),
  );
}