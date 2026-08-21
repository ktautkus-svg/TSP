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

/** Wall-clock "HH:MM" for a planned timestamp, or null when there is nothing to show. */
export function clockLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('lt-LT', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
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
  const prefix = 'Pristatymo laikas';
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

/**
 * Window-urgency status: how close the stop's own delivery deadline
 * (`deliveryTimeTo`, the client's own promised window) is to the current
 * real clock — not a comparison against our route plan like scheduleDotColor.
 * green: more than 60 min of slack left; warning: 60 min or less; danger:
 * deadline already passed. Returns null when the stop has no window set.
 */
export function windowUrgencyColor(
  stop: DeliveryStop | null | undefined,
  routeDate: string | null | undefined,
  now: number = Date.now(),
): 'success' | 'warning' | 'danger' | null {
  if (!stop || !stop.deliveryTimeTo || !routeDate) return null;
  const deadline = new Date(`${routeDate}T${stop.deliveryTimeTo}:00`).getTime();
  if (!Number.isFinite(deadline)) return null;
  const minutesRemaining = (deadline - now) / 60_000;
  if (minutesRemaining < 0) return 'danger';
  if (minutesRemaining <= 60) return 'warning';
  return 'success';
}

export type ArrivalWindowState = 'on_time' | 'at_risk' | 'early' | 'late' | 'unavailable';

function clockMinutes(value: string): number | null {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function localEtaMinutes(value: string): number | null {
  const eta = new Date(value);
  if (!Number.isFinite(eta.getTime())) return null;
  return eta.getHours() * 60 + eta.getMinutes();
}

export function arrivalWindowStatus(
  stop: DeliveryStop | null | undefined,
  _routeDate: string | null | undefined,
): { state: ArrivalWindowState; label: string; color: 'success' | 'warning' | 'danger' | 'textMuted' } {
  if (!stop?.deliveryTimeFrom && !stop?.deliveryTimeTo) {
    return { state: 'unavailable', label: 'Pristatymo laikas nenurodytas', color: 'textMuted' };
  }

  const etaValue = stop.latestEstimatedArrivalAt ?? stop.plannedArrivalAt;
  if (!etaValue) {
    return { state: 'unavailable', label: 'Atvykimo prognozė dar neparuošta', color: 'textMuted' };
  }

  const eta = localEtaMinutes(etaValue);
  const from = stop.deliveryTimeFrom ? clockMinutes(stop.deliveryTimeFrom) : null;
  const to = stop.deliveryTimeTo ? clockMinutes(stop.deliveryTimeTo) : null;

  if (eta === null || (stop.deliveryTimeFrom && from === null) || (stop.deliveryTimeTo && to === null)) {
    return { state: 'unavailable', label: 'Atvykimo prognozė dar neparuošta', color: 'textMuted' };
  }

  const overnight = from !== null && to !== null && from > to;
  const outsideOvernightWindow = overnight && eta > to! && eta < from!;
  const arrivesEarly = overnight
    ? outsideOvernightWindow && from! - eta <= eta - to!
    : from !== null && eta < from;
  const arrivesLate = overnight
    ? outsideOvernightWindow && !arrivesEarly
    : to !== null && eta > to;

  if (arrivesEarly) {
    return { state: 'early', label: 'Atvyksime per anksti', color: 'warning' };
  }
  if (arrivesLate) {
    return { state: 'late', label: 'Į laiko langą nespėsime', color: 'danger' };
  }
  if (to !== null && ((to - eta + 1440) % 1440) <= 15) {
    return { state: 'at_risk', label: 'Galimas vėlavimas', color: 'warning' };
  }
  return { state: 'on_time', label: 'Spėsime į laiko langą', color: 'success' };
}

export function deliveryWindowValue(stop?: DeliveryStop | null): string {
  if (!stop?.deliveryTimeFrom && !stop?.deliveryTimeTo) return 'Nenurodytas';
  if (stop.deliveryTimeFrom && stop.deliveryTimeTo && stop.deliveryTimeFrom !== stop.deliveryTimeTo) {
    return `${stop.deliveryTimeFrom}–${stop.deliveryTimeTo}`;
  }
  return stop.deliveryTimeFrom ?? stop.deliveryTimeTo ?? 'Nenurodytas';
}
