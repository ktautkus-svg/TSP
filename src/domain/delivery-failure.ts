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

/**
 * Marker written to a stop's `failure_reason` when it was delivered but the
 * customer returned part of the load or something was short. The stop still
 * counts as delivered; `failure_comment` holds what came back / was missing.
 */
export const DELIVERY_RETURN_REASON = 'Grąžinimas / trūkumas';

export function isDeliveryReturnReason(value: string | null | undefined): boolean {
  return (value ?? '').trim() === DELIVERY_RETURN_REASON;
}

export function deliveryMatchesFilter(filter: DeliveryFilter, status: DeliveryStatus): boolean {
  if (filter === 'all') return true;
  if (filter === 'undelivered') return status === 'pending';
  return status === filter;
}
