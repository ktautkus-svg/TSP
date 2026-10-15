/** A completed route, or any stop already delivered or refused, must stay in history. */
export function assignmentHasDeliveryHistory(
  status: string,
  stops: readonly { delivery_status?: unknown; deliveryStatus?: unknown }[],
): boolean {
  if (status === 'completed') return true;
  return stops.some((stop) => {
    const value = stop.delivery_status ?? stop.deliveryStatus;
    return value === 'delivered' || value === 'failed';
  });
}
