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
 * Keeps edits made while the screen is mounted, but fills every missing or
 * out-of-range value on a restored/reopened completion flow so it can never
 * resume half-empty or with a free-text time that selectors do not offer.
 */
export function resumeRouteCompletionClock(
  current: Partial<RouteCompletionClock>,
  now: Date = new Date(),
): RouteCompletionClock {
  const defaults = currentRouteCompletionClock(now);
  const date = current.date?.trim() || '';
  const hour = current.hour?.trim() || '';
  const minute = current.minute?.trim() || '';
  return {
    date: date || defaults.date,
    hour: ROUTE_COMPLETION_HOURS.includes(hour) ? hour : defaults.hour,
    minute: ROUTE_COMPLETION_MINUTES.includes(minute) ? minute : defaults.minute,
  };
}

/**
 * Fresh "Baigti maršrutą" always starts from the live Lithuanian wall clock.
 * "Tęsti užbaigimą" / reopen keeps prior edits and only fills blanks.
 */
export function routeCompletionClockForOpen(
  alreadyCompleting: boolean,
  current: Partial<RouteCompletionClock>,
  now: Date = new Date(),
): RouteCompletionClock {
  return alreadyCompleting
    ? resumeRouteCompletionClock(current, now)
    : currentRouteCompletionClock(now);
}

export function routeCompletionTimestamp(clock: RouteCompletionClock): string | null {
  if (!ROUTE_COMPLETION_HOURS.includes(clock.hour) || !ROUTE_COMPLETION_MINUTES.includes(clock.minute)) return null;
  return lithuanianDateTimeToIso(clock.date, `${clock.hour}:${clock.minute}`);
}

/** Reports the first missing or invalid fuel field, before odometer or network work. */
export function routeCompletionFuelFieldError(
  choice: RouteCompletionFuelChoice,
  litersText: string,
): string | null {
  if (choice === null) return 'Pasirinkite, ar buvo pilti degalai.';
  if (choice === 'no') return null;
  if (!litersText.trim()) return 'Įveskite įpilto kuro kiekį litrais.';
  const liters = Number(litersText.trim().replace(',', '.'));
  if (!Number.isFinite(liters) || liters < 0.1 || liters > 1_000) {
    return 'Įpilto kuro kiekis turi būti nuo 0,1 iki 1000 litrų.';
  }
  return null;
}

export function buildRouteCompletionFuelRequest(input: {
  choice: RouteCompletionFuelChoice;
  filledAt: string;
  odometer: number;
  litersText: string;
  receiptNumber: string;
}): RouteCompletionFuelRequest | null {
  const fieldError = routeCompletionFuelFieldError(input.choice, input.litersText);
  if (fieldError) throw new Error(fieldError);
  if (input.choice !== 'yes') return null;
  const liters = Number(input.litersText.trim().replace(',', '.'));
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
