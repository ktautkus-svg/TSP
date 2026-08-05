import type { ParsedDelivery } from '@/domain/import/models';
import type { ConfirmedGeocodedPoint, ParsedTimeWindow } from '@/application/parsing/text-parser';

export function deliveriesToRoutePoints(deliveries: ParsedDelivery[]): ConfirmedGeocodedPoint[] {
  return deliveries.map((delivery) => {
    if (!delivery.address.value || !delivery.selectedAddress) {
      throw new Error(`Pristatymas ${delivery.id} neturi patvirtinto adreso.`);
    }
    return {
      street: delivery.address.value,
      city: inferCity(delivery.selectedAddress.normalizedAddress),
      timeWindow: parseDeliveryTime(delivery.deliveryTime.value),
      weightKg: delivery.weightKg.value,
      orderNumber: delivery.orderNumber.value,
      company: delivery.recipient.value ?? '',
      fullAddress: delivery.selectedAddress.normalizedAddress,
      rawText: delivery.rawText,
      geocode: {
        normalizedAddress: delivery.selectedAddress.normalizedAddress,
        latitude: delivery.selectedAddress.latitude,
        longitude: delivery.selectedAddress.longitude,
        placeId: delivery.selectedAddress.placeId,
        locationType: 'OCR_RESOLVED',
        resultTypes: ['street_address'],
      },
    };
  });
}

export function parseDeliveryTime(value: string | null): ParsedTimeWindow | null {
  if (!value) return null;
  const times = value.match(/(?:[01]?\d|2[0-3]):[0-5]\d/gu) ?? [];
  if (times.length === 0) return null;
  const from = normalizeTime(times[0]!);
  const to = normalizeTime(times[1] ?? times[0]);
  return { from, to, raw: value };
}

function normalizeTime(value: string): string {
  const [hours, minutes] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes}`;
}

function inferCity(address: string): string {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.at(-2)! : '';
}
