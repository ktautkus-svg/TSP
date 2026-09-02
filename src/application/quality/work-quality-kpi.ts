import { classifyDeliveryWindow } from '@/domain/delivery-window-timing';

export type WorkQualityStop = {
  status: 'pending' | 'delivered' | 'failed';
  deliveredAt: string | null;
  deliveryTimeFrom: string | null;
  deliveryTimeTo: string | null;
};

/** Delivered inside the promised window. Early, late, failed, pending, and unknown are not. */
export function isDeliveredOnTime(stop: WorkQualityStop): boolean {
  if (stop.status !== 'delivered' || !stop.deliveredAt) return false;
  return classifyDeliveryWindow(stop.deliveredAt, stop.deliveryTimeFrom, stop.deliveryTimeTo) === 'on_time';
}

/**
 * Darbo kokybė: on-time delivered stops / all visible stops, rounded like the
 * other quality-control tiles. Late, failed, pending, and early all lower it.
 */
export function workQualityPercent(stops: readonly WorkQualityStop[]): number {
  if (stops.length === 0) return 0;
  const onTime = stops.filter(isDeliveredOnTime).length;
  return Math.round((onTime / stops.length) * 100);
}

export function lateDeliveredStops<T extends WorkQualityStop>(stops: readonly T[]): T[] {
  return stops.filter((stop) =>
    stop.status !== 'failed'
    && Boolean(stop.deliveredAt)
    && classifyDeliveryWindow(stop.deliveredAt, stop.deliveryTimeFrom, stop.deliveryTimeTo) === 'late');
}
