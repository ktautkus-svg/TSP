import type { ParsedDelivery, ResolvedAddressCandidate } from '@/domain/import/models';

export interface AddressLookupProvider {
  resolve(address: string): Promise<ResolvedAddressCandidate[]>;
}

/** Accepts "54.6872, 25.2797" style input so a stop can be pinned directly
 * when geocoding repeatedly fails or the driver already knows the coordinates. */
const COORDINATE_PATTERN = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
/** Google Maps URLs carry the pin location in one of a few query shapes:
 * "/@lat,lng,15z", "?q=lat,lng" or the internal "!3dlat!4dlng" place param.
 * Maps.lt is intentionally not handled here — its share links use the
 * LKS-94 grid (metres, not degrees), and converting that wrongly would send
 * the driver to the wrong address, which is worse than not recognising it. */
const GOOGLE_MAPS_URL_PATTERNS = [
  /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
];

export function parseCoordinateInput(value: string): { latitude: number; longitude: number } | null {
  const direct = COORDINATE_PATTERN.exec(value);
  const fromUrl = direct ? null : GOOGLE_MAPS_URL_PATTERNS.map((pattern) => pattern.exec(value)).find(Boolean) ?? null;
  const match = direct ?? fromUrl;
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export async function resolveDeliveryAddresses(
  deliveries: ParsedDelivery[],
  provider: AddressLookupProvider,
): Promise<ParsedDelivery[]> {
  const resolved: ParsedDelivery[] = [];
  const queries = applyDominantCityContext(deliveries.map((delivery) => delivery.address.value ?? ''));
  for (const [index, delivery] of deliveries.entries()) {
    if (!delivery.address.value) {
      resolved.push({ ...delivery, validationState: 'invalid', addressConfidence: 0 });
      continue;
    }
    // Already confirmed for this exact text — skip the paid lookup. Without
    // this, re-running validation (now automatic on blur) would re-geocode
    // every already-approved stop again on each edit.
    if (delivery.validationState === 'valid' && delivery.selectedAddress && delivery.addressQuery === (delivery.address.value ?? '')) {
      resolved.push(delivery);
      continue;
    }
    const coordinates = parseCoordinateInput(delivery.address.value);
    if (coordinates) {
      const candidate: ResolvedAddressCandidate = {
        normalizedAddress: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)} (koordinatės)`,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        placeId: null,
        confidence: 1,
      };
      resolved.push({
        ...delivery,
        addressQuery: delivery.address.value,
        addressCandidates: [candidate],
        selectedAddress: candidate,
        addressConfidence: 1,
        importConfidence: (delivery.parserConfidence + 1) / 2,
        validationState: 'valid',
      });
      continue;
    }
    const addressQuery = queries[index] ?? delivery.address.value;
    let candidates: ResolvedAddressCandidate[] = [];
    try {
      candidates = await provider.resolve(addressQuery);
    } catch {
      candidates = delivery.addressCandidates ?? [];
    }
    const selected = candidates.length === 1 ? candidates[0] : null;
    const addressConfidence = selected?.confidence ?? candidates[0]?.confidence ?? 0;
    resolved.push({
      ...delivery,
      addressQuery,
      addressCandidates: candidates,
      selectedAddress: selected,
      addressConfidence,
      importConfidence: (delivery.parserConfidence + addressConfidence) / 2,
      validationState: candidates.length === 0 ? 'invalid' : candidates.length === 1 ? 'valid' : 'ambiguous',
    });
  }
  return resolved;
}

function applyDominantCityContext(addresses: string[]): string[] {
  const cities = addresses.map(extractLikelyCity).filter((city): city is string => Boolean(city));
  const counts = new Map<string, number>();
  for (const city of cities) counts.set(city, (counts.get(city) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!dominant) return addresses;
  return addresses.map((address) => extractLikelyCity(address) ? address : `${address}, ${dominant}`);
}

function extractLikelyCity(address: string): string | null {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = parts.at(-1)!.replace(/^(?:LT-?)?\d{5}\s+/iu, '').trim();
  return /^[\p{L} .'-]{2,}$/u.test(candidate) ? candidate : null;
}
