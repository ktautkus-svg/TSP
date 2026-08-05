import type { DeliveryStatus } from './route';

export type StopMetricInput = {
  weightKg: number;
  deliveryStatus: DeliveryStatus;
};

export type RouteMetrics = {
  totalStops: number;
  remainingStops: number;
  deliveredStops: number;
  failedStops: number;
  totalWeightKg: number;
  remainingWeightKg: number;
  deliveredWeightKg: number;
  progressPercent: number;
};

export function calculateRouteMetrics(stops: StopMetricInput[]): RouteMetrics {
  const totalStops = stops.length;
  const deliveredStops = stops.filter((stop) => stop.deliveryStatus === 'delivered').length;
  const failedStops = stops.filter((stop) => stop.deliveryStatus === 'failed').length;
  const totalWeightKg = stops.reduce((sum, stop) => sum + stop.weightKg, 0);
  const remaining = stops.filter((stop) => stop.deliveryStatus === 'pending');
  const remainingWeightKg = remaining.reduce((sum, stop) => sum + stop.weightKg, 0);
  const deliveredWeightKg = stops
    .filter((stop) => stop.deliveryStatus === 'delivered')
    .reduce((sum, stop) => sum + stop.weightKg, 0);

  return {
    totalStops,
    remainingStops: remaining.length,
    deliveredStops,
    failedStops,
    totalWeightKg,
    remainingWeightKg,
    deliveredWeightKg,
    progressPercent: totalStops === 0 ? 0 : (deliveredStops / totalStops) * 100,
  };
}
