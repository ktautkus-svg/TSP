import type {
  OptimizationStop,
  RouteOptimizationRequest,
} from '@/domain/routing/models';
import { createBaseRequest } from '@/domain/routing/scenarios';
import { parseDeliveries } from '@/application/import/delivery-parser';

export interface ParsedTimeWindow {
  from: string;
  to: string;
  raw: string;
}

export interface ParsedDeliveryPoint {
  street: string;
  city: string;
  timeWindow: ParsedTimeWindow | null;
  company: string;
  fullAddress: string;
  rawText: string;
}

export interface ConfirmedGeocodedPoint extends ParsedDeliveryPoint {
  weightKg?: number | null;
  orderNumber?: string | null;
  geocode: {
    normalizedAddress: string;
    latitude: number;
    longitude: number;
    placeId: string | null;
    locationType: string;
    resultTypes: string[];
  };
}

export type BuildOptimizationRequestOptions = {
  departureAt: string;
  startLocation: {
    normalizedAddress: string;
    latitude: number;
    longitude: number;
    placeId: string | null;
    locationType: string;
    resultTypes: string[];
  };
};

export interface ParseResult {
  points: ParsedDeliveryPoint[];
  unparsedLines: string[];
}

const PROVIDER_DEPARTURE_LEAD_MS = 60_000;

export function normalizeProviderDepartureAt(
  departureAt: string,
  nowMs: number = Date.now(),
): string {
  const requestedMs = new Date(departureAt).getTime();
  if (!Number.isFinite(requestedMs)) {
    throw new Error('Neteisingas planuojamo išvykimo laikas.');
  }
  return new Date(
    Math.max(requestedMs, nowMs + PROVIDER_DEPARTURE_LEAD_MS),
  ).toISOString();
}

const LITHUANIAN_CITIES = new Set([
  'Pasvalys',
  'Vilnius',
  'Kaunas',
  'Klaipėda',
  'Šiauliai',
  'Panevėžys',
  'Alytus',
  'Marijampolė',
  'Mažeikiai',
  'Jonava',
  'Utena',
  'Ukmergė',
  'Kėdainiai',
  'Telšiai',
  'Visaginas',
  'Tauragė',
  'Plungė',
  'Kretinga',
  'Šilutė',
  'Radviliškis',
  'Palanga',
  'Gargždai',
  'Rokiškis',
  'Biržai',
  'Elektrėnai',
  'Garliava',
  'Jurbarkas',
  'Raseiniai',
  'Vilkaviškis',
  'Anykščiai',
  'Lentvaris',
  'Grigiškės',
  'Prienai',
  'Joniškis',
  'Kelmė',
  'Varėna',
  'Kaišiadorys',
  'Kupiškis',
  'Zarasai',
  'Skuodas',
  'Kazlų Rūda',
  'Širvintos',
  'Molėtai',
  'Šalčininkai',
  'Šakiai',
  'Švenčionys',
  'Ignalina',
  'Šilalė',
  'Pakruojis',
  'Neringa',
  'Akmenė',
]);

const TIME_WINDOW_REGEX =
  /\b([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\s*(?:[-–—]|iki)\s*([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])\b/i;

const STREET_REGEX =
  /\b([A-ZĄČĘĖĮŠŲŪŽ0-9][a-ząčęėįšųūž0-9\s.-]*?\b(?:g|al|pr|pl|kel|tak|skg|r)\.?\s*\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?)\b/i;

const STREET_FALLBACK_REGEX =
  /\b([A-ZĄČĘĖĮŠŲŪŽ][A-Za-zĄČĘĖĮŠŲŪŽa-ząčęėįšųūž0-9\s.-]+?\s+\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?)\b/i;

const COMPANY_REGEX =
  /\b(UAB|AB|MB|IĮ|VŠĮ|VšĮ|PĮ|ŽŪK|KŪB|TŪB)\s+["„]?[A-ZĄČĘĖĮŠŲŪŽ0-9a-ząčęėįšųūž\s.-]+?["“]?\b/i;

const QUOTED_COMPANY_REGEX = /["„](UAB|AB|MB|IĮ|VŠĮ|VšĮ|PĮ|ŽŪK|KŪB|TŪB)\s+[^"“]+["“]/i;

/**
 * Extracts time window (e.g. "08:00-10:00") from text block or line.
 */
export function extractTimeWindow(text: string): ParsedTimeWindow | null {
  const match = text.match(TIME_WINDOW_REGEX);
  if (!match) return null;

  const [, fromH, fromM, toH, toM] = match;
  const from = `${fromH.padStart(2, '0')}:${fromM}`;
  const to = `${toH.padStart(2, '0')}:${toM}`;

  return {
    from,
    to,
    raw: match[0].trim(),
  };
}

/**
 * Extracts company name (e.g. "UAB Lambda LT") from text block or line.
 */
export function extractCompany(text: string): string {
  const quotedMatch = text.match(/["„]((?:UAB|AB|MB|IĮ|VŠĮ|VšĮ|PĮ|ŽŪK|KŪB|TŪB)\s+[^"“]+)["“]/i);
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  const match = text.match(/\b(UAB|AB|MB|IĮ|VŠĮ|VšĮ|PĮ|ŽŪK|KŪB|TŪB)\b\s+[^,;\n]+/i);
  if (match) {
    let company = match[0].replace(/["„“]/g, '').trim();
    company = company.replace(/\s+\d{1,2}[:.]\d{2}.*$/, '').trim();
    return company;
  }

  return '';
}

/**
 * Extracts street address (e.g. "Joniškėlio g. 1" or "Alekniškio 17") from text block or line.
 */
export function extractStreet(text: string): string {
  const match = text.match(STREET_REGEX);
  if (match) {
    return match[1].trim();
  }

  const fallbackMatch = text.match(STREET_FALLBACK_REGEX);
  if (fallbackMatch) {
    let streetCandidate = fallbackMatch[1].trim();
    for (const city of LITHUANIAN_CITIES) {
      if (streetCandidate.endsWith(city)) {
        streetCandidate = streetCandidate.slice(0, -city.length).trim();
      }
    }
    return streetCandidate;
  }

  return '';
}

/**
 * Extracts city name (e.g. "Pasvalys") from text block or line.
 */
export function extractCity(text: string): string {
  const words = text.split(/[\s,;\n"„“]+/);
  for (const word of words) {
    const cleanWord = word.trim().replace(/[.:]/g, '');
    if (LITHUANIAN_CITIES.has(cleanWord)) {
      return cleanWord;
    }
  }
  return '';
}

/**
 * Parses raw text input into a structured list of delivery points.
 */
export function parseDeliveryText(rawText: string): ParseResult {
  if (!rawText || !rawText.trim()) {
    return { points: [], unparsedLines: [] };
  }

  const lines = rawText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const addressLikeLineCount = lines.filter((line) => extractStreet(line)).length;
  if (!/\n\s*\n/u.test(rawText) && addressLikeLineCount >= 2) {
    return {
      points: lines.map((line) => {
        const street = extractStreet(line) || line;
        const city = extractCity(line);
        return {
          street,
          city,
          timeWindow: extractTimeWindow(line),
          company: extractCompany(line),
          fullAddress: city && !street.includes(city) ? `${street}, ${city}` : street,
          rawText: line,
        };
      }),
      unparsedLines: [],
    };
  }

  // The document-import parser is the primary parser. This function is now a
  // backwards-compatible adapter for the original manual-entry screen.
  const parsed = parseDeliveries(rawText);
  const points = parsed
    .filter((delivery) => delivery.address.value)
    .map((delivery): ParsedDeliveryPoint => {
      const source = delivery.rawText;
      const street = extractStreet(delivery.address.value!) || delivery.address.value!;
      const city = extractCity(source);
      return {
        street,
        city,
        timeWindow: extractTimeWindow(delivery.deliveryTime.value ?? source),
        company: delivery.recipient.value ?? extractCompany(source),
        fullAddress: city && !street.includes(city) ? `${street}, ${city}` : street,
        rawText: source,
      };
    });
  if (points.length > 0) return { points, unparsedLines: [] };

  // A named facility can be a valid geocoding query even when it has no house
  // number. Preserve each non-empty line for Google validation instead of
  // inventing address components.
  const fallback = rawText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return {
    points: fallback.map((line) => ({
      street: line,
      city: extractCity(line),
      timeWindow: null,
      company: '',
      fullAddress: line,
      rawText: line,
    })),
    unparsedLines: [],
  };
}

function parseBlockOrLines(textBlock: string): ParsedDeliveryPoint[] {
  const lines = textBlock.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Try parsing line by line if lines contain commas or tabs (single-line items)
  const resultsFromLines: ParsedDeliveryPoint[] = [];
  let allLinesSingleItems = true;

  for (const line of lines) {
    const street = extractStreet(line);
    if (street) {
      const city = extractCity(line);
      const timeWindow = extractTimeWindow(line);
      const company = extractCompany(line);

      // If at least street is found in this single line, create a point
      if (street) {
        resultsFromLines.push({
          street,
          city,
          timeWindow,
          company,
          fullAddress: city ? `${street}, ${city}` : street,
          rawText: line,
        });
        continue;
      }
    }
    allLinesSingleItems = false;
  }

  if (allLinesSingleItems && resultsFromLines.length === lines.length) {
    return resultsFromLines;
  }

  // Otherwise treat the block as a single multi-line delivery point
  const street = extractStreet(textBlock);
  if (!street) return [];

  const city = extractCity(textBlock);
  const timeWindow = extractTimeWindow(textBlock);
  const company = extractCompany(textBlock);

  return [
    {
      street,
      city,
      timeWindow,
      company,
      fullAddress: city ? `${street}, ${city}` : street,
      rawText: textBlock,
    },
  ];
}

// These coordinates are retained solely for explicit synthetic scenario tooling.
// Real pasted-address routing never reads this table.
const SYNTHETIC_CITY_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  Pasvalys: { latitude: 56.0635, longitude: 24.4035 },
  Kaunas: { latitude: 54.8985, longitude: 23.9036 },
  Vilnius: { latitude: 54.6872, longitude: 25.2797 },
  Klaipėda: { latitude: 55.7033, longitude: 21.1443 },
  Šiauliai: { latitude: 55.9333, longitude: 23.3167 },
  Panevėžys: { latitude: 55.7333, longitude: 24.3500 },
  Alytus: { latitude: 54.3963, longitude: 24.0459 },
  Marijampolė: { latitude: 54.5599, longitude: 23.3541 },
  Utena: { latitude: 55.4976, longitude: 25.5992 },
  Kėdainiai: { latitude: 55.2878, longitude: 23.9744 },
  Telšiai: { latitude: 55.9814, longitude: 22.2472 },
  Tauragė: { latitude: 55.2522, longitude: 22.2897 },
  Elektrėnai: { latitude: 54.7869, longitude: 24.6653 },
  Ukmergė: { latitude: 55.2522, longitude: 24.7672 },
  Rokiškis: { latitude: 55.9542, longitude: 25.5864 },
  Jonava: { latitude: 55.0733, longitude: 24.2758 },
  Mažeikiai: { latitude: 56.3117, longitude: 22.3411 },
  Druskininkai: { latitude: 54.0222, longitude: 23.9786 },
  Palanga: { latitude: 55.9175, longitude: 21.0686 },
  Visaginas: { latitude: 55.6019, longitude: 26.4319 },
  Plungė: { latitude: 55.9114, longitude: 21.8442 },
  Kretinga: { latitude: 55.8894, longitude: 21.2436 },
  Šilutė: { latitude: 55.3497, longitude: 21.4800 },
  Radviliškis: { latitude: 55.8114, longitude: 23.5414 },
  Gargždai: { latitude: 55.7119, longitude: 21.4031 },
  Biržai: { latitude: 56.2008, longitude: 24.7553 },
  Kuršėnai: { latitude: 56.0028, longitude: 22.9356 },
  Garliava: { latitude: 54.8219, longitude: 23.8744 },
  Jurbarkas: { latitude: 55.0767, longitude: 22.7667 },
  Raseiniai: { latitude: 55.3789, longitude: 23.1186 },
  Anykščiai: { latitude: 55.5258, longitude: 25.1039 },
  Trakai: { latitude: 54.6400, longitude: 24.9350 },
  Molėtai: { latitude: 55.2289, longitude: 25.4214 },
  Širvintos: { latitude: 55.0417, longitude: 24.9589 },
};

/**
 * Converts parsed delivery points into a valid RouteOptimizationRequest for the RoutingEngine.
 */
export function buildOptimizationRequestFromPoints(
  points: ConfirmedGeocodedPoint[],
  options: BuildOptimizationRequestOptions,
): RouteOptimizationRequest {
  const baseRequest = createBaseRequest(Math.max(points.length, 1));
  // Schedule from the planned wall-clock time. Traffic providers bump a past
  // departure themselves; doing it here rewrote the whole day from "now".
  const plannedDepartureAt = options.departureAt;
  if (!Number.isFinite(Date.parse(plannedDepartureAt))) {
    throw new Error('Neteisingas planuojamo išvykimo laikas.');
  }

  const stops: OptimizationStop[] = points.map((point, index) => {
    const id = `stop-${index + 1}`;

    const label = point.company
      ? `${point.company} (${point.street})`
      : point.street || `Taškas ${index + 1}`;

    const informationalTimeWindow = point.timeWindow
      ? toAbsoluteTimeWindow(point.timeWindow, plannedDepartureAt)
      : undefined;

    return {
      id,
      location: {
        id,
        label,
        address: point.geocode.normalizedAddress,
        latitude: point.geocode.latitude,
        longitude: point.geocode.longitude,
      },
      // Unknown weight stays null. It is not silently converted to either a
      // real zero or a synthetic demo weight.
      weightKg: point.weightKg ?? null,
      serviceDurationMinutes: 15,
      informationalTimeWindow,
      priority: 1,
      deliverBeforeStopIds: [],
      deliverAfterStopIds: [],
      preferEarly: false,
      preferLate: false,
      mustBeFirst: false,
      mustBeLast: false,
    };
  });

  const startLocation = {
    id: 'route-start',
    label: 'Startas',
    address: options.startLocation.normalizedAddress,
    latitude: options.startLocation.latitude,
    longitude: options.startLocation.longitude,
  };
  const endLocation = {
    ...startLocation,
    id: 'route-end',
    label: 'Grįžimas į startą',
  };

  return {
    ...baseRequest,
    routeId: `custom-parsed-${Date.now()}`,
    startLocation,
    endLocation,
    plannedDepartureAt,
    stops,
    planningMode: stops.some((stop) => stop.informationalTimeWindow)
      ? 'with_time_windows'
      : 'ignore_time_windows',
    trafficMode: 'live',
    workdayEndAt: undefined,
    vehicle: {
      ...baseRequest.vehicle,
      startLocation,
      defaultEndLocation: endLocation,
    },
  };
}

function toAbsoluteTimeWindow(
  window: ParsedTimeWindow,
  departureAt: string,
): { from: string; to: string } {
  const from = timeOnPlanningDay(window.from, departureAt);
  const to = timeOnPlanningDay(window.to, departureAt);
  if (to.getTime() < from.getTime()) to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function timeOnPlanningDay(value: string, departureAt: string): Date {
  const result = new Date(departureAt);
  const [hours, minutes] = value.split(':').map(Number);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

void SYNTHETIC_CITY_COORDINATES;
