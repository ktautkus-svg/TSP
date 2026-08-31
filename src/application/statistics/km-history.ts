import type { StatsPeriod, StatsRouteRow } from '@/domain/statistics';

export type KmHistoryRoute = {
  id: string;
  label: string;
  direction: string | null;
  km: number;
  actual: boolean;
  stops: number;
  driverName: string | null;
  vehicleRegistration: string | null;
};

export type KmHistoryDay = {
  date: string;
  totalKm: number;
  allActual: boolean;
  routes: KmHistoryRoute[];
};

/** Turns raw statistics rows into the driver-facing answer to “where were these kilometres driven?”. */
export function buildKmHistory(rows: readonly StatsRouteRow[], period: StatsPeriod): KmHistoryDay[] {
  const days = new Map<string, KmHistoryDay>();
  rows
    .filter((row) => row.date >= period.fromKey && row.date <= period.toKey)
    .forEach((row, index) => {
      const actual = row.actualDistanceKm !== null;
      const km = actual ? row.actualDistanceKm : row.estimatedDistanceKm;
      if (km === null) return;
      const day = days.get(row.date) ?? { date: row.date, totalKm: 0, allActual: true, routes: [] };
      day.totalKm += km;
      day.allActual = day.allActual && actual;
      day.routes.push({
        id: row.routeId ?? `${row.date}-${index}`,
        label: row.routeLabel || 'Maršrutas',
        direction: directionLabel(row.startAddress, row.endAddress),
        km,
        actual,
        stops: row.totalStops,
        driverName: row.driverName ?? null,
        vehicleRegistration: row.vehicleRegistration ?? null,
      });
      days.set(row.date, day);
    });
  return [...days.values()]
    .map((day) => ({ ...day, routes: day.routes.sort((left, right) => right.km - left.km) }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function directionLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  const from = start?.trim();
  const to = end?.trim();
  if (from && to && from !== to) return `${from} → ${to}`;
  return from || to || null;
}
