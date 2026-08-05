import type { DeliveryFilter, DeliveryStatus } from './route';

export const DELIVERY_FAILURE_REASONS = [
  'Nedirba',
  'Liko sandėlyje',
  'Netilpo',
  'Netinka produkcija',
  'Kita',
] as const;

export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

export function isDeliveryFailureReason(value: string): value is DeliveryFailureReason {
  return (DELIVERY_FAILURE_REASONS as readonly string[]).includes(value);
}

export function deliveryMatchesFilter(filter: DeliveryFilter, status: DeliveryStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'undelivered') return status === 'pending';
  return status === filter;
}
