import { lithuanianDateTimeToIso, lithuanianWallClockNow } from '@/domain/lithuanian-time';

export type RouteCompletionClock = {
  date: string;
  hour: string;
  minute: string;
};

export type RouteCompletionFuelChoice = 'yes' | 'no' | null;

export type RouteCompletionFuelRequest = {
  filledAt: string;
  odometer: number;
  liters: number;
  receiptNumber: string | null;
};

export const ROUTE_COMPLETION_HOURS = Object.freeze(
  Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')),
);

export const ROUTE_COMPLETION_MINUTES = Object.freeze(
  Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0')),
);

/** Defaults shown whenever the completion sheet is opened on a fresh mount. */
export function currentRouteCompletionClock(now: Date = new Date()): RouteCompletionClock {
  const current = lithuanianWallClockNow(now);
  const [hour, minute] = current.time.split(':');
  return { date: current.date, hour, minute };
}

/**
 * Keeps edits made while the screen is mounted, but fills every missing value
 * on a restored/reopened completion flow so it can never resume half-empty.
 */
export function resumeRouteCompletionClock(
  current: Partial<RouteCompletionClock>,
  now: Date = new Date(),
): RouteCompletionClock {
  const defaults = currentRouteCompletionClock(now);
  return {
    date: current.date?.trim() || defaults.date,
    hour: current.hour?.trim() || defaults.hour,
    minute: current.minute?.trim() || defaults.minute,
  };
}

export function routeCompletionTimestamp(clock: RouteCompletionClock): string | null {
  if (!ROUTE_COMPLETION_HOURS.includes(clock.hour) || !ROUTE_COMPLETION_MINUTES.includes(clock.minute)) return null;
  return lithuanianDateTimeToIso(clock.date, `${clock.hour}:${clock.minute}`);
}

export function buildRouteCompletionFuelRequest(input: {
  choice: RouteCompletionFuelChoice;
  filledAt: string;
  odometer: number;
  litersText: string;
  receiptNumber: string;
}): RouteCompletionFuelRequest | null {
  if (input.choice === null) throw new Error('Pasirinkite, ar pylėte kuro.');
  if (input.choice === 'no') return null;
  const liters = Number(input.litersText.replace(',', '.'));
  if (!Number.isFinite(liters) || liters <= 0 || liters > 1_000) {
    throw new Error('Įpilto kuro kiekis turi būti nuo 0,1 iki 1000 litrų.');
  }
  return {
    filledAt: input.filledAt,
    odometer: input.odometer,
    liters: Math.round(liters * 100) / 100,
    receiptNumber: input.receiptNumber.trim() || null,
  };
}

export async function persistRouteCompletionFuel(
  request: RouteCompletionFuelRequest | null,
  alreadySaved: boolean,
  save: (payload: RouteCompletionFuelRequest) => Promise<void>,
): Promise<boolean> {
  if (!request || alreadySaved) return alreadySaved;
  await save(request);
  return true;
}

/** A synchronous guard around async submission; two taps share one operation. */
export class RouteCompletionSingleFlight {
  private active: Promise<unknown> | null = null;

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) return this.active as Promise<T>;
    const active = Promise.resolve().then(operation);
    this.active = active;
    void active.finally(() => {
      if (this.active === active) this.active = null;
    }).catch(() => undefined);
    return active;
  }
}
