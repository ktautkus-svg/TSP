import { etaScheduleState } from '@/application/routes/route-eta';
import type { DeliveryStop, PlanningMode } from '@/domain/route';

export function etaLabel(stop?: DeliveryStop | null): string {
  if (!stop) return 'Atvykimo laikas dar neapskaičiuotas';
  const value = stop.latestEstimatedArrivalAt ?? stop.plannedArrivalAt;
  if (!value) return 'Atvykimo laikas dar neapskaičiuotas';
  return `Atvykimas apie ${new Intl.DateTimeFormat('lt-LT', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))}`;
}

/** Formats a minute count as "X val. Y min." once it reaches an hour, instead of e.g. "170 min." */
export function durationLabel(totalMinutes: number): string {
  const abs = Math.round(Math.abs(totalMinutes));
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (hours === 0) return `${minutes} min.`;
  return minutes === 0 ? `${hours} val.` : `${hours} val. ${minutes} min.`;
}

export function legLabel(stop?: DeliveryStop | null): string {
  if (!stop) return 'Iki taško — km · — min.';
  const distance = stop.legDistanceKm === null || stop.legDistanceKm === undefined
    ? '— km'
    : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(stop.legDistanceKm)} km`;
  const minutes = stop.legDurationMinutes === null || stop.legDurationMinutes === undefined ? '— min.' : durationLabel(stop.legDurationMinutes);
  return `Iki taško ${distance} · ${minutes}`;
}

export function windowLabel(stop?: DeliveryStop | null, planningMode?: PlanningMode | null): string | null {
  if (!stop || (!stop.deliveryTimeFrom && !stop.deliveryTimeTo)) return null;
  const from = stop.deliveryTimeFrom;
  const to = stop.deliveryTimeTo;
  const isRange = Boolean(from && to && from !== to);
  const value = isRange ? `${from}–${to}` : (from || to);
  const prefix = isRange ? 'Pristatymo langas' : 'Pageidaujamas laikas';
  return planningMode === 'ignore_time_windows'
    ? `${prefix}: ${value} · tik informacijai`
    : `${prefix}: ${value}`;
}

export function scheduleLabel(stop?: DeliveryStop | null): string {
  if (!stop) return 'Plano palyginimas dar negalimas';
  const result = etaScheduleState(stop);
  if (result.state === 'on_time') return 'Pagal planą';
  if (result.state === 'late') return `Apie ${durationLabel(result.differenceMinutes ?? 0)} vėliau`;
  if (result.state === 'early') return `Apie ${durationLabel(result.differenceMinutes ?? 0)} anksčiau`;
  return 'Plano palyginimas dar negalimas';
}

export function offlineEtaLabel(stop?: DeliveryStop | null): string | null {
  if (!stop) return null;
  return stop.etaApproximate ? 'Apytikslis laikas · eismas neatnaujintas' : null;
}

/**
 * Green/orange status dot color for the ETA shown next to a stop, reusing
 * etaScheduleState's existing on_time/late/early soft-warning comparison
 * (the same one behind scheduleLabel) rather than a new calculation.
 */
export function scheduleDotColor(stop?: DeliveryStop | null): 'success' | 'warning' | null {
  if (!stop) return null;
  const result = etaScheduleState(stop);
  if (result.state === 'late') return 'warning';
  if (result.state === 'on_time' || result.state === 'early') return 'success';
  return null;
}
