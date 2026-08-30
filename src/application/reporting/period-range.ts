/**
 * One period selector shared by every reporting screen — quality control and
 * trip sheets alike. Both used to answer "which days am I looking at?" and the
 * answer must not drift between them: a week is Monday to Sunday in both, and
 * a day key is the local calendar day, never a UTC slice of an ISO timestamp.
 */

export type PeriodMode = 'day' | 'week' | 'month' | 'custom';

export type PeriodRange = { from: string; to: string };

export type CalendarPeriodPresetKey = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'year';
export type CalendarPeriodPreset = { key: CalendarPeriodPresetKey; label: string };

export const CALENDAR_PERIOD_PRESETS: readonly CalendarPeriodPreset[] = [
  { key: 'today', label: 'Šiandien' },
  { key: 'yesterday', label: 'Vakar' },
  { key: 'thisWeek', label: 'Ši savaitė' },
  { key: 'lastWeek', label: 'Praėjusi savaitė' },
  { key: 'thisMonth', label: 'Šis mėnuo' },
  { key: 'lastMonth', label: 'Praėjęs mėnuo' },
  { key: 'year', label: '12 mėn.' },
];

export const PERIOD_OPTIONS: readonly { key: PeriodMode; label: string }[] = [
  { key: 'day', label: 'Diena' },
  { key: 'week', label: 'Savaitė' },
  { key: 'month', label: 'Mėnuo' },
  { key: 'custom', label: 'Laikotarpis' },
];

/** Local calendar day as YYYY-MM-DD. Never `toISOString().slice(0, 10)`, which shifts the day for anyone east of UTC. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Midday so daylight-saving transitions cannot push the date onto a neighbouring day. */
export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dateFromKey(value);
  return !Number.isNaN(parsed.getTime()) && localDateKey(parsed) === value;
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function monthKey(value: string): string {
  return validDateKey(value) ? value.slice(0, 7) : localDateKey(new Date()).slice(0, 7);
}

export function shiftMonth(value: string, amount: number): string {
  const [year, month] = value.split('-').map(Number);
  const shifted = new Date(year, month - 1 + amount, 1, 12);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

export function calendarMonthDays(value: string): { key: string; day: number; inMonth: boolean }[] {
  const [year, month] = value.split('-').map(Number);
  const first = new Date(year, month - 1, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return { key: localDateKey(date), day: date.getDate(), inMonth: date.getMonth() === month - 1 };
  });
}

export function calendarPresetRange(key: CalendarPeriodPresetKey, reference: Date = new Date()): PeriodRange {
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
  if (key === 'today') {
    const value = localDateKey(today);
    return { from: value, to: value };
  }
  if (key === 'yesterday') {
    const value = localDateKey(addDays(today, -1));
    return { from: value, to: value };
  }
  if (key === 'thisWeek' || key === 'lastWeek') {
    const mondayOffset = (today.getDay() + 6) % 7;
    const fromDate = addDays(today, -mondayOffset - (key === 'lastWeek' ? 7 : 0));
    return { from: localDateKey(fromDate), to: localDateKey(addDays(fromDate, 6)) };
  }
  if (key === 'thisMonth' || key === 'lastMonth') {
    const offset = key === 'lastMonth' ? -1 : 0;
    const fromDate = new Date(today.getFullYear(), today.getMonth() + offset, 1, 12);
    const toDate = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0, 12);
    return { from: localDateKey(fromDate), to: localDateKey(toDate) };
  }
  return { from: localDateKey(addDays(today, -364)), to: localDateKey(today) };
}

/**
 * Turns the chosen mode plus its anchor date into an inclusive from/to pair.
 * A reversed custom range is swapped rather than rejected, so a mistyped
 * "from" later than "to" still shows data instead of an empty screen.
 */
export function periodRange(mode: PeriodMode, anchor: string, customFrom: string, customTo: string): PeriodRange {
  const fallback = localDateKey(new Date());
  if (mode === 'custom') {
    const first = validDateKey(customFrom) ? customFrom : fallback;
    const second = validDateKey(customTo) ? customTo : first;
    return first <= second ? { from: first, to: second } : { from: second, to: first };
  }
  const date = dateFromKey(validDateKey(anchor) ? anchor : fallback);
  if (mode === 'week') {
    const mondayOffset = (date.getDay() + 6) % 7;
    const from = addDays(date, -mondayOffset);
    return { from: localDateKey(from), to: localDateKey(addDays(from, 6)) };
  }
  if (mode === 'month') {
    const from = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
    return { from: localDateKey(from), to: localDateKey(to) };
  }
  const key = localDateKey(date);
  return { from: key, to: key };
}

export function withinPeriod(dateKey: string, range: PeriodRange): boolean {
  return dateKey >= range.from && dateKey <= range.to;
}

/** Label for the date field, which changes meaning with the mode. */
export function anchorFieldLabel(mode: PeriodMode): string {
  if (mode === 'day') return 'Data';
  if (mode === 'week') return 'Pasirinkite savaitės dieną';
  return 'Pasirinkite mėnesio dieną';
}

export function formatDateKey(value: string, includeYear = true): string {
  return new Intl.DateTimeFormat('lt-LT', { year: includeYear ? 'numeric' : undefined, month: 'short', day: 'numeric' })
    .format(dateFromKey(value));
}

export function formatDateRange(from: string, to: string): string {
  return from === to ? formatDateKey(from) : `${formatDateKey(from)} – ${formatDateKey(to)}`;
}

export function formatDayTitle(value: Date): string {
  const text = new Intl.DateTimeFormat('lt-LT', { weekday: 'long', month: 'long', day: 'numeric' }).format(value);
  return capitalize(text);
}

export function formatMonthTitle(value: string): string {
  const text = new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(dateFromKey(value));
  return capitalize(text);
}

export function formatPeriodTitle(mode: PeriodMode, from: string, to: string): string {
  if (mode === 'day') return formatDayTitle(dateFromKey(from));
  if (mode === 'month') return formatMonthTitle(from);
  return formatDateRange(from, to);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
