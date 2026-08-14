export type DeliveryWindowTiming = 'early' | 'on_time' | 'late' | 'unknown';

const MINUTES_PER_DAY = 24 * 60;

export function classifyDeliveryWindow(
  arrivalAt: string | null,
  deliveryTimeFrom: string | null,
  deliveryTimeTo: string | null,
): DeliveryWindowTiming {
  const arrival = localClockMinutes(arrivalAt);
  const from = clockMinutes(deliveryTimeFrom);
  const to = clockMinutes(deliveryTimeTo);

  if (arrival === null || (from === null && to === null)) return 'unknown';

  if (from !== null && to !== null && from > to) {
    if (arrival >= from || arrival <= to) return 'on_time';

    const minutesBeforeStart = from - arrival;
    const minutesAfterEnd = arrival - to;
    return minutesBeforeStart <= minutesAfterEnd ? 'early' : 'late';
  }

  if (from !== null && arrival < from) return 'early';
  if (to !== null && arrival > to) return 'late';
  return 'on_time';
}

export function minutesLate(
  arrivalAt: string | null,
  deliveryTimeTo: string | null,
): number | null {
  const arrival = localClockMinutes(arrivalAt);
  const to = clockMinutes(deliveryTimeTo);
  if (arrival === null || to === null) return null;

  const difference = (arrival - to + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return difference === 0 ? 0 : difference;
}

function localClockMinutes(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clockMinutes(value);
  return date.getHours() * 60 + date.getMinutes();
}

function clockMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /(?:^|T)(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
