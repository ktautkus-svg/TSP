import type { DeliveryStop } from '@/domain/route';

type LoadingStopState = Pick<DeliveryStop, 'loadingStatus' | 'deliveryStatus'>;

export function partitionLoadingStops<T extends LoadingStopState>(stops: T[]): {
  active: T[];
  processed: T[];
} {
  const active: T[] = [];
  const processed: T[] = [];
  for (const stop of stops) {
    if (stop.loadingStatus === 'loaded' || stop.deliveryStatus === 'failed') {
      processed.push(stop);
    } else {
      active.push(stop);
    }
  }
  return { active, processed };
}
