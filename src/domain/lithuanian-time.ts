export const LITHUANIA_TIME_ZONE = 'Europe/Vilnius' as const;
export const PUNCTUALITY_TOLERANCE_MINUTES = 15;

export type DeliveryTimingState = 'on_time' | 'late' | 'early' | 'unknown';

export type DeliveryTiming = {
  state: DeliveryTimingState;
  /** Positive after the deadline/ETA, negative before the window start/ETA. */
  differenceMinutes: number | null;
  referenceAt: string | null;
  referenceKind: 'window_end' | 'window_start' | 'planned_arrival' | null;
};

type DeliveryTimingInput = {
  deliveredAt: string | null | undefined;
  deliveryTimeFrom?: string | null;
  deliveryTimeTo?: string | null;
  latestEstimatedArrivalAt?: string | null;
  plannedArrivalAt?: string | null;
};

const lithuanianDateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: LITHUANIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Converts a Lithuanian wall-clock value (HH:mm) on the same Lithuanian
 * calendar day as `reference` to an epoch timestamp. The calculation uses
 * IANA timezone rules, so summer time (+03) and winter time (+02) work on
 * devices and servers regardless of their own process timezone.
 */
export function lithuanianClockOnReferenceDay(reference: string, clock: string): number | null {
  const referenceMs = Date.parse(reference);
  const clockMatch = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!Number.isFinite(referenceMs) || !clockMatch) return null;
  const hours = Number(clockMatch[1]);
  const minutes = Number(clockMatch[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;

  const parts = dateParts(new Date(referenceMs));
  if (!parts) return null;
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hours, minutes, 0, 0);

  // Resolve twice because the first UTC-shaped guess can sit on the other
  // side of a daylight-saving transition from the final instant.
  let candidate = wallClockAsUtc - timeZoneOffsetMs(new Date(wallClockAsUtc));
  candidate = wallClockAsUtc - timeZoneOffsetMs(new Date(candidate));
  return candidate;
}

/** Calendar date in Lithuania for an absolute timestamp, independent of host TZ. */
export function lithuanianDateKey(reference: string): string | null {
  const referenceMs = Date.parse(reference);
  if (!Number.isFinite(referenceMs)) return null;
  const parts = dateParts(new Date(referenceMs));
  if (!parts) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function assessDeliveryTiming(input: DeliveryTimingInput): DeliveryTiming {
  const deliveredAt = input.deliveredAt?.trim();
  if (!deliveredAt) return unknownTiming();
  const deliveredMs = Date.parse(deliveredAt);
  if (!Number.isFinite(deliveredMs)) return unknownTiming();

  const windowEnd = input.deliveryTimeTo
    ? lithuanianClockOnReferenceDay(deliveredAt, input.deliveryTimeTo)
    : null;
  if (windowEnd !== null) {
    const lateMinutes = Math.round((deliveredMs - windowEnd) / 60_000);
    if (lateMinutes > PUNCTUALITY_TOLERANCE_MINUTES) {
      return timing('late', lateMinutes, windowEnd, 'window_end');
    }
    const windowStart = input.deliveryTimeFrom
      ? lithuanianClockOnReferenceDay(deliveredAt, input.deliveryTimeFrom)
      : null;
    if (windowStart !== null) {
      const earlyMinutes = Math.round((deliveredMs - windowStart) / 60_000);
      if (earlyMinutes < -PUNCTUALITY_TOLERANCE_MINUTES) {
        return timing('early', earlyMinutes, windowStart, 'window_start');
      }
    }
    return timing('on_time', lateMinutes, windowEnd, 'window_end');
  }

  const plannedArrivalAt = input.latestEstimatedArrivalAt ?? input.plannedArrivalAt;
  if (!plannedArrivalAt) return unknownTiming();
  const plannedMs = Date.parse(plannedArrivalAt);
  if (!Number.isFinite(plannedMs)) return unknownTiming();
  const differenceMinutes = Math.round((deliveredMs - plannedMs) / 60_000);
  const state: DeliveryTimingState = differenceMinutes > PUNCTUALITY_TOLERANCE_MINUTES
    ? 'late'
    : differenceMinutes < -PUNCTUALITY_TOLERANCE_MINUTES ? 'early' : 'on_time';
  return timing(state, differenceMinutes, plannedMs, 'planned_arrival');
}

/** Backward-compatible completion summary state: early is also outside the promised window. */
export function completionPunctuality(input: DeliveryTimingInput): 'on_time' | 'late' | 'unknown' {
  const state = assessDeliveryTiming(input).state;
  if (state === 'unknown') return 'unknown';
  return state === 'on_time' ? 'on_time' : 'late';
}

function dateParts(date: Date): { year: number; month: number; day: number } | null {
  const parts = new Map(lithuanianDateParts.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));
  return [year, month, day].every(Number.isInteger) ? { year, month, day } : null;
}

function timeZoneOffsetMs(date: Date): number {
  const parts = new Map(lithuanianDateParts.formatToParts(date).map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(parts.get('year')),
    Number(parts.get('month')) - 1,
    Number(parts.get('day')),
    Number(parts.get('hour')),
    Number(parts.get('minute')),
    Number(parts.get('second')),
  );
  return localAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function timing(
  state: DeliveryTimingState,
  differenceMinutes: number,
  referenceMs: number,
  referenceKind: DeliveryTiming['referenceKind'],
): DeliveryTiming {
  return { state, differenceMinutes, referenceAt: new Date(referenceMs).toISOString(), referenceKind };
}

function unknownTiming(): DeliveryTiming {
  return { state: 'unknown', differenceMinutes: null, referenceAt: null, referenceKind: null };
}
