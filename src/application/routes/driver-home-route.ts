export type HomeRouteCandidate = {
  id: string;
  date: string;
  status: string;
};

const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  loaded: 1,
  loading: 2,
  planned: 3,
};

/**
 * The driver tab must show today's Lithuanian route when one is assigned.
 * A future assignment must not hide today, and a past unfinished copy must
 * not be presented as the current day.
 */
export function selectDriverHomeRoute<T extends HomeRouteCandidate>(routes: readonly T[], todayKey: string): T | null {
  const open = routes.filter((route) => route.status !== 'completed' && route.status !== 'cancelled');
  const byWork = (left: T, right: T) => (STATUS_RANK[left.status] ?? 9) - (STATUS_RANK[right.status] ?? 9);
  const today = open.filter((route) => route.date === todayKey).sort(byWork);
  if (today[0]) return today[0];
  const past = open.filter((route) => route.date < todayKey).sort((left, right) => right.date.localeCompare(left.date) || byWork(left, right));
  if (past[0]) return past[0];
  return open.filter((route) => route.date > todayKey).sort((left, right) => left.date.localeCompare(right.date) || byWork(left, right))[0] ?? null;
}

export function routeDayLabel(dateKey: string, todayKey: string, formatted: string): string {
  if (dateKey > todayKey) return `${formatted} · rytojaus maršrutas`;
  if (dateKey < todayKey) return `${formatted} · ankstesnė diena`;
  return formatted;
}
