import type { ParsedDelivery, ResolvedAddressCandidate } from '@/domain/import/models';

export interface AddressLookupProvider {
  resolve(address: string): Promise<ResolvedAddressCandidate[]>;
}

/** Accepts "54.6872, 25.2797" style input so a stop can be pinned directly
 * when geocoding repeatedly fails or the driver already knows the coordinates. */
const COORDINATE_PATTERN = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
/** Google Maps URLs carry the pin location in one of a few query shapes:
 * "/@lat,lng,15z", "?q=lat,lng" or the internal "!3dlat!4dlng" place param. */
const GOOGLE_MAPS_URL_PATTERNS = [
  /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  /[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
];

export function parseCoordinateInput(value: string): { latitude: number; longitude: number } | null {
  const direct = COORDINATE_PATTERN.exec(value);
  const fromUrl = direct ? null : GOOGLE_MAPS_URL_PATTERNS.map((pattern) => pattern.exec(value)).find(Boolean) ?? null;
  const match = direct ?? fromUrl;
  if (!match) return parseMapsLtCoordinate(value);
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function parseMapsLtCoordinate(value: string): { latitude: number; longitude: number } | null {
  if (!/https?:\/\/(?:www\.)?maps\.lt\//i.test(value)) return null;
  const decoded = safeDecode(value);
  const coordinateMatch = /(?:[?#&]|\b)xy=([\d.]+)[,;]([\d.]+)/i.exec(decoded);
  if (!coordinateMatch) return null;
  const first = Number(coordinateMatch[1]);
  const second = Number(coordinateMatch[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  // Older maps.lt links use LKS-94 (EPSG:3346): easting, northing in metres.
  if (first >= 200_000 && first <= 900_000 && second >= 5_900_000 && second <= 6_300_000) {
    return lks94ToWgs84(first, second);
  }
  // Newer ArcGIS views may expose Web Mercator coordinates.
  if (Math.abs(first) > 1_000_000 && Math.abs(second) > 1_000_000) {
    const longitude = first / 20_037_508.34 * 180;
    const latitude = 180 / Math.PI * (2 * Math.atan(Math.exp(second / 20_037_508.34 * Math.PI)) - Math.PI / 2);
    if (latitude >= 53 && latitude <= 57 && longitude >= 20 && longitude <= 27) return { latitude, longitude };
  }
  return null;
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Inverse Transverse Mercator for Lithuania's LKS-94 / EPSG:3346 grid. */
function lks94ToWgs84(easting: number, northing: number): { latitude: number; longitude: number } | null {
  const a = 6_378_137;
  const e2 = 0.00669438002290;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9998;
  const centralMeridian = 24 * Math.PI / 180;
  const meridionalArc = northing / k0;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu = meridionalArc / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const sinPhi = Math.sin(phi1);
  const cosPhi = Math.cos(phi1);
  const tanPhi = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * sinPhi ** 2);
  const r1 = a * (1 - e2) / (1 - e2 * sinPhi ** 2) ** 1.5;
  const t1 = tanPhi ** 2;
  const c1 = ep2 * cosPhi ** 2;
  const d = (easting - 500_000) / (n1 * k0);
  const latitudeRadians = phi1 - (n1 * tanPhi / r1) * (
    d ** 2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720
  );
  const longitudeRadians = centralMeridian + (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120
  ) / cosPhi;
  const latitude = latitudeRadians * 180 / Math.PI;
  const longitude = longitudeRadians * 180 / Math.PI;
  if (latitude < 53 || latitude > 57 || longitude < 20 || longitude > 27) return null;
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
