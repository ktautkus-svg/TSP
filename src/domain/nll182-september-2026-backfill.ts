import { KAROLIS_TAUTKUS_DRIVER_ID } from './trip-sheet-august-2026-vehicle-fix';

/**
 * Authoritative NLL182 backfill for 2026-09-01 … 2026-09-03 (Karolis, 2026-09-04).
 *
 * One-shot production migration, gated by its own Firestore `tsp_settings`
 * flag. Re-running is a no-op — every write is keyed on a deterministic id and
 * skipped when it already exists, so a second Cloud Run boot adds nothing.
 *
 * Facts (Europe/Vilnius calendar days, odometer chain continues 2026-08-31 →
 * 283165, which this migration never rewrites):
 *
 *   09-01  283165 → 283256  (91 km)   BE VAIRUOTOJO, no routes, no fill
 *   09-02  283256 → 283671  (415 km)  Karolis, R11;R19;R54, +78 L
 *   09-03  283671 → 283829  (158 km)  Karolis, M11,          +79 L
 *
 * Day-start tank on 09-01 is 21 L (real), seeded as an approved admin
 * correction so the September ledger opens on 21 L, not a fictitious 30 L.
 *
 * The fuel norm is left untouched — NLL182 already carries 13.9 L/100km live.
 */

export const NLL182_SEPTEMBER_2026_BACKFILL_ID = 'nll182-september-2026-backfill-v1';

export const NLL182_REGISTRATION = 'NLL182';

/** Real tank reading at the start of 2026-09-01, per Karolis. */
export const NLL182_SEPTEMBER_2026_OPENING = {
  reportId: 'open-NLL182-20260901',
  liters: 21,
  effectiveAt: '2026-09-01',
  note: 'Rugsėjo 1 d. dienos pradžios bako likutis pagal administratoriaus nurodymą (2026-09-04).',
} as const;

export type Nll182SeptemberFill = {
  /** Deterministic fuel-entry id — stable across re-runs. */
  id: string;
  liters: number;
};

export type Nll182SeptemberDay = {
  date: string;
  startOdometer: number;
  endOdometer: number;
  /** null → the vehicle-day has no driver (BE VAIRUOTOJO). */
  driverId: string | null;
  driverName: string | null;
  /** Region codes shown as "Kur važiuota"; empty → odometer-only stub day. */
  routeCodes: readonly string[];
  /** Deterministic route id for the completed assignment; null → no assignment. */
  routeId: string | null;
  fill: Nll182SeptemberFill | null;
};

export const NLL182_SEPTEMBER_2026_DAYS: readonly Nll182SeptemberDay[] = [
  {
    date: '2026-09-01',
    startOdometer: 283165,
    endOdometer: 283256,
    driverId: null,
    driverName: null,
    routeCodes: [],
    routeId: null,
    fill: null,
  },
  {
    date: '2026-09-02',
    startOdometer: 283256,
    endOdometer: 283671,
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    driverName: 'Karolis Tautkus',
    routeCodes: ['R11', 'R19', 'R54'],
    routeId: 'route-sep2026-nll182-0902',
    fill: { id: 'seed-NLL182-20260902-78', liters: 78 },
  },
  {
    date: '2026-09-03',
    startOdometer: 283671,
    endOdometer: 283829,
    driverId: KAROLIS_TAUTKUS_DRIVER_ID,
    driverName: 'Karolis Tautkus',
    routeCodes: ['M11'],
    routeId: 'route-sep2026-nll182-0903',
    fill: { id: 'seed-NLL182-20260903-79', liters: 79 },
  },
];

export const NLL182_SEPTEMBER_2026_FILL_IDS = NLL182_SEPTEMBER_2026_DAYS
  .map((day) => day.fill?.id)
  .filter((id): id is string => Boolean(id));

/** Km driven that day — always end − start, never a sum of route sheets. */
export function nll182SeptemberDayDistanceKm(
  day: Pick<Nll182SeptemberDay, 'startOdometer' | 'endOdometer'>,
): number {
  return Math.round((day.endOdometer - day.startOdometer) * 10) / 10;
}

/** True for a fuel entry this migration owns — used to keep re-runs idempotent. */
export function isNll182September2026FuelEntry(entry: {
  id?: string | null;
  registrationNumber?: string | null;
}): boolean {
  return Boolean(entry.id)
    && NLL182_SEPTEMBER_2026_FILL_IDS.includes(entry.id as string)
    && (entry.registrationNumber ?? '').toUpperCase() === NLL182_REGISTRATION;
}

/** Shipment lines that make `uniqueRegionCodes` return the day's route codes. */
export function nll182SeptemberShipmentLines(day: Pick<Nll182SeptemberDay, 'routeCodes'>): { route_code: string }[] {
  return day.routeCodes.map((code) => ({ route_code: code }));
}
