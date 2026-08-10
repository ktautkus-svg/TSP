const FALLBACK_START_TIME = '04:00';
/** Leave this many minutes before the earliest door opens, so the first stop is reachable without a long kerbside wait. */
const DEPARTURE_LEAD_MINUTES = 30;

export function defaultPlanningDate(now = new Date()): string {
  const candidate = new Date(now);
  candidate.setHours(12, 0, 0, 0);
  candidate.setDate(candidate.getDate() + 1);
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return localDateValue(candidate);
}

export function defaultPlanningTime(): string {
  return FALLBACK_START_TIME;
}

/**
 * Suggests a depot departure from delivery windows. Leaving at 04:00 when every
 * door opens at 06:00 just invents two hours of waiting; the suggestion tracks
 * the earliest opening minus a short travel buffer instead.
 */
export function suggestPlanningTimeFromWindows(
  windows: Array<{ from: string | null | undefined } | null | undefined>,
): string {
  let earliestMinutes: number | null = null;
  for (const window of windows) {
    const parsed = parseHhMm(window?.from);
    if (parsed === null) continue;
    earliestMinutes = earliestMinutes === null ? parsed : Math.min(earliestMinutes, parsed);
  }
  if (earliestMinutes === null) return FALLBACK_START_TIME;
  const suggested = Math.max(0, earliestMinutes - DEPARTURE_LEAD_MINUTES);
  return formatHhMm(suggested);
}

export function planningDepartureIso(dateValue: string, timeValue: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  const local = new Date(year!, month! - 1, day, hours, minutes, 0, 0);
  if (
    local.getFullYear() !== year || local.getMonth() !== month! - 1 || local.getDate() !== day ||
    local.getHours() !== hours || local.getMinutes() !== minutes
  ) return null;
  return local.toISOString();
}

export function localDateValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseHhMm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatHhMm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
