import { parseDeliveryTime } from '@/application/import/route-import-mapper';
import type { ParsedDelivery } from '@/domain/import/models';
import type { DeliveryStop, RouteEndpoint } from '@/domain/route';
import type { DraftStopInput } from './route-commands';

export function importedDeliveriesToDraftStops(deliveries: ParsedDelivery[]): DraftStopInput[] {
  const originalAddresses = deliveries.map((delivery) => delivery.address.value ?? '');
  const queries = applyDominantCityContext(originalAddresses);
  return deliveries.map((delivery, index) => {
    if (!delivery.address.value) throw new Error(`Pristatymas ${index + 1} neturi adreso.`);
    const selected = delivery.selectedAddress;
    const window = parseDeliveryTime(delivery.deliveryTime.value);
    return {
      sourceStopId: delivery.id,
      originalOrder: index + 1,
      orderNumber: delivery.orderNumber.value,
      recipient: delivery.recipient.value,
      originalAddress: delivery.address.value,
      geocodingQuery: delivery.addressQuery ?? queries[index] ?? delivery.address.value,
      normalizedAddress: selected?.normalizedAddress ?? null,
      addressValidationState: selected ? 'auto_confirmed' : 'unconfirmed',
      geocodingError: null,
      latitude: selected?.latitude ?? null,
      longitude: selected?.longitude ?? null,
      deliveryTimeFrom: window?.from ?? null,
      deliveryTimeTo: window?.to ?? null,
      requiredTimeWindow: false,
      weightKg: delivery.weightKg.value,
      phone: delivery.phone.value,
      notes: delivery.notes.value,
    };
  });
}

export function manualAddressesToDraftStops(addresses: string[]): DraftStopInput[] {
  const queries = applyDominantCityContext(addresses);
  return addresses.map((address, index) => ({
    originalOrder: index + 1,
    orderNumber: null,
    recipient: null,
    originalAddress: address,
    geocodingQuery: queries[index]!,
    normalizedAddress: null,
    addressValidationState: 'unconfirmed',
    latitude: null,
    longitude: null,
    deliveryTimeFrom: null,
    deliveryTimeTo: null,
    requiredTimeWindow: false,
    weightKg: null,
    phone: null,
    notes: null,
  }));
}

export function routeEndpointFromGeocode(
  originalAddress: string,
  result: { normalizedAddress: string; latitude: number; longitude: number },
  geocodingQuery = originalAddress,
): RouteEndpoint {
  return {
    originalAddress,
    geocodingQuery,
    normalizedAddress: result.normalizedAddress,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

export function applyDominantCityContext(addresses: string[]): string[] {
  const cities = addresses.map(extractLikelyCity).filter((city): city is string => Boolean(city));
  const counts = new Map<string, number>();
  for (const city of cities) counts.set(city, (counts.get(city) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!dominant) return addresses.map((address) => address.trim());
  return addresses.map((address) =>
    extractLikelyCity(address) ? address.trim() : `${address.trim()}, ${dominant}`,
  );
}

export function draftStopFromPersisted(stop: DeliveryStop): DraftStopInput {
  return {
    sourceStopId: stop.sourceStopId,
    originalOrder: stop.originalOrder,
    orderNumber: stop.orderNumber,
    recipient: stop.recipient,
    originalAddress: stop.originalAddress,
    geocodingQuery: stop.geocodingQuery,
    normalizedAddress: stop.normalizedAddress,
    addressValidationState: stop.addressValidationState,
    geocodingError: stop.geocodingError,
    latitude: stop.latitude,
    longitude: stop.longitude,
    deliveryTimeFrom: stop.deliveryTimeFrom,
    deliveryTimeTo: stop.deliveryTimeTo,
    requiredTimeWindow: stop.requiredTimeWindow,
    weightKg: stop.weightKg,
    phone: stop.phone,
    notes: stop.notes,
  };
}

function extractLikelyCity(address: string): string | null {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = parts.at(-1)!;
  if (/^LT-?\d{5}$/iu.test(candidate) || /^\d{5}$/u.test(candidate)) return null;
  const withoutPostcode = candidate.replace(/^(?:LT-?)?\d{5}\s+/iu, '').trim();
  return /^[\p{L} .'-]{2,}$/u.test(withoutPostcode) ? withoutPostcode : null;
}
