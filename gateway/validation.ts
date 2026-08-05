import { GatewayError } from './errors';
import type {
  GatewayGeocodeRequest,
  GatewayMatrixRequest,
  GatewayOcrRequest,
  GatewayPolylineRequest,
  GatewayProvider,
} from './types';

const REQUEST_KEYS = new Set([
  'schemaVersion',
  'provider',
  'matrixId',
  'startLocation',
  'stops',
  'endLocation',
  'departureAt',
  'trafficMode',
  'vehicle',
  'language',
  'regionCode',
]);

const POLYLINE_REQUEST_KEYS = new Set([
  'schemaVersion',
  'provider',
  'startLocation',
  'orderedStops',
  'endLocation',
  'departureAt',
  'trafficMode',
  'language',
  'regionCode',
]);

export function parseGatewayMatrixRequest(
  input: unknown,
  maxStops = 40,
): GatewayMatrixRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('Užklausa turi būti JSON objektas.');
  }
  const record = input as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !REQUEST_KEYS.has(key));
  if (unknownKeys.length) {
    invalid('Užklausoje yra neleistinų laukų.', { unknownKeys });
  }
  if (record.schemaVersion !== '1') invalid('Nepalaikoma schemaVersion.');
  if (record.provider !== 'here' && record.provider !== 'google') {
    invalid('Neleistinas provideris.');
  }
  if (
    typeof record.matrixId !== 'string' ||
    record.matrixId.length < 1 ||
    record.matrixId.length > 120
  ) {
    invalid('Neteisingas matrixId.');
  }
  if (!Array.isArray(record.stops) || record.stops.length === 0) {
    invalid('Pristatymo taškų sąrašas negali būti tuščias.');
  }
  if (record.stops.length > maxStops) {
    invalid(`Leidžiama ne daugiau kaip ${maxStops} pristatymo taškų.`);
  }
  const startLocation = parseLocation(record.startLocation, 'startLocation');
  const stops = record.stops.map((value, index) =>
    parseLocation(value, `stops[${index}]`),
  );
  const endLocation = parseLocation(record.endLocation, 'endLocation');
  const ids = [startLocation, ...stops, endLocation].map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    invalid('Visi matricos taškai privalo turėti unikalų id.');
  }
  if (
    typeof record.departureAt !== 'string' ||
    !Number.isFinite(Date.parse(record.departureAt))
  ) {
    invalid('departureAt turi būti galiojantis ISO laikas.');
  }
  if (
    record.trafficMode !== 'none' &&
    record.trafficMode !== 'historical' &&
    record.trafficMode !== 'live'
  ) {
    invalid('Neleistinas trafficMode.');
  }
  if (record.language !== 'lt-LT' || record.regionCode !== 'LT') {
    invalid('Šiame gateway leidžiami tik lt-LT ir LT.');
  }
  const vehicle = parseVehicle(record.vehicle);
  return {
    schemaVersion: '1',
    provider: record.provider as GatewayProvider,
    matrixId: record.matrixId as string,
    startLocation,
    stops,
    endLocation,
    departureAt: record.departureAt as string,
    trafficMode: record.trafficMode,
    vehicle,
    language: 'lt-LT',
    regionCode: 'LT',
  };
}

function parseLocation(value: unknown, path: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${path} turi būti objektas.`);
  }
  const item = value as Record<string, unknown>;
  const allowed = new Set(['id', 'label', 'address', 'latitude', 'longitude']);
  const unknown = Object.keys(item).filter((key) => !allowed.has(key));
  if (unknown.length) invalid(`${path} turi neleistinų laukų.`, { unknown });
  if (
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.label !== 'string' ||
    !item.label
  ) {
    invalid(`${path} id ir label yra privalomi.`);
  }
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    invalid(`${path} koordinatės neteisingos.`);
  }
  if (item.address !== undefined && typeof item.address !== 'string') {
    invalid(`${path}.address turi būti tekstas.`);
  }
  return {
    id: item.id as string,
    label: item.label as string,
    ...(item.address ? { address: item.address as string } : {}),
    latitude,
    longitude,
  };
}

function parseVehicle(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('vehicle turi būti objektas.');
  }
  const item = value as Record<string, unknown>;
  const allowed = new Set([
    'id',
    'type',
    'maximumPayloadKg',
    'heightM',
    'widthM',
    'lengthM',
    'grossWeightKg',
    'useRoadRestrictions',
    'startLocation',
    'defaultEndLocation',
  ]);
  const unknown = Object.keys(item).filter((key) => !allowed.has(key));
  if (unknown.length) invalid('vehicle turi neleistinų laukų.', { unknown });
  if (
    typeof item.id !== 'string' ||
    !['car', 'van', 'truck'].includes(String(item.type)) ||
    !isPositive(item.maximumPayloadKg) ||
    typeof item.useRoadRestrictions !== 'boolean'
  ) {
    invalid('Neteisingas vehicle profilis.');
  }
  for (const name of ['heightM', 'widthM', 'lengthM', 'grossWeightKg']) {
    if (item[name] !== undefined && !isPositive(item[name])) {
      invalid(`vehicle.${name} turi būti teigiamas skaičius.`);
    }
  }
  return {
    id: item.id,
    type: item.type,
    maximumPayloadKg: Number(item.maximumPayloadKg),
    ...(item.heightM ? { heightM: Number(item.heightM) } : {}),
    ...(item.widthM ? { widthM: Number(item.widthM) } : {}),
    ...(item.lengthM ? { lengthM: Number(item.lengthM) } : {}),
    ...(item.grossWeightKg
      ? { grossWeightKg: Number(item.grossWeightKg) }
      : {}),
    useRoadRestrictions: item.useRoadRestrictions,
    startLocation: parseLocation(item.startLocation, 'vehicle.startLocation'),
    defaultEndLocation: parseLocation(
      item.defaultEndLocation,
      'vehicle.defaultEndLocation',
    ),
  } as GatewayMatrixRequest['vehicle'];
}

export function parseGatewayPolylineRequest(
  input: unknown,
): GatewayPolylineRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('Užklausa turi būti JSON objektas.');
  }
  const record = input as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !POLYLINE_REQUEST_KEYS.has(key),
  );
  if (unknownKeys.length) {
    invalid('Užklausoje yra neleistinų laukų.', { unknownKeys });
  }
  if (record.schemaVersion !== '1') invalid('Nepalaikoma schemaVersion.');
  if (record.provider !== 'google') {
    invalid('Polyline užklausai šiuo metu palaikomas tik google provideris.');
  }
  const startLocation = parseLocation(record.startLocation, 'startLocation');
  if (!Array.isArray(record.orderedStops)) {
    invalid('orderedStops turi būti masyvas.');
  }
  const orderedStops = record.orderedStops.map((value, index) =>
    parseLocation(value, `orderedStops[${index}]`),
  );
  const endLocation = parseLocation(record.endLocation, 'endLocation');

  if (record.departureAt !== undefined) {
    if (
      typeof record.departureAt !== 'string' ||
      !Number.isFinite(Date.parse(record.departureAt))
    ) {
      invalid('departureAt turi būti galiojantis ISO laikas.');
    }
  }

  if (record.trafficMode !== undefined) {
    if (
      record.trafficMode !== 'none' &&
      record.trafficMode !== 'historical' &&
      record.trafficMode !== 'live'
    ) {
      invalid('Neleistinas trafficMode.');
    }
  }

  return {
    schemaVersion: '1',
    provider: 'google',
    startLocation,
    orderedStops,
    endLocation,
    ...(record.departureAt ? { departureAt: record.departureAt as string } : {}),
    ...(record.trafficMode
      ? { trafficMode: record.trafficMode as GatewayPolylineRequest['trafficMode'] }
      : {}),
    language: 'lt-LT',
    regionCode: 'LT',
  };
}

export function parseGatewayGeocodeRequest(
  input: unknown,
  maximumAddressLength = 300,
): GatewayGeocodeRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('Užklausa turi būti JSON objektas.');
  }
  const record = input as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== 'address');
  if (unknownKeys.length) {
    invalid('Geokodavimo užklausoje yra neleistinų laukų.', { unknownKeys });
  }
  if (typeof record.address !== 'string') {
    invalid('Adresas yra privalomas.');
  }
  const address = normalizeAddress(record.address as string);
  if (address.length < 3 || address.length > maximumAddressLength) {
    invalid(`Adresas turi būti nuo 3 iki ${maximumAddressLength} simbolių.`);
  }
  return { address, language: 'lt', region: 'lt' };
}

export function parseGatewayOcrRequest(input: unknown): GatewayOcrRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('OCR užklausa turi būti JSON objektas.');
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(['documentId', 'mimeType', 'imageBase64', 'languageHints']);
  const unknownKeys = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknownKeys.length) invalid('OCR užklausoje yra neleistinų laukų.', { unknownKeys });
  if (typeof record.documentId !== 'string' || !record.documentId.trim() || record.documentId.length > 120) {
    invalid('Neteisingas OCR documentId.');
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(String(record.mimeType))) {
    invalid('Nepalaikomas OCR paveikslėlio MIME tipas.');
  }
  if (typeof record.imageBase64 !== 'string' || record.imageBase64.length < 16) {
    invalid('OCR paveikslėlio turinys yra privalomas.');
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/u.test(record.imageBase64)) {
    invalid('OCR paveikslėlis nėra validus base64.');
  }
  const languageHints = Array.isArray(record.languageHints)
    ? record.languageHints.filter((value): value is string => typeof value === 'string').slice(0, 5)
    : ['lt'];
  return {
    documentId: record.documentId.trim(),
    mimeType: record.mimeType as GatewayOcrRequest['mimeType'],
    imageBase64: record.imageBase64,
    languageHints,
  };
}

export function normalizeAddress(address: string): string {
  return address.trim().replace(/\s+/g, ' ');
}

function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function invalid(
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new GatewayError('INVALID_REQUEST', message, 400, false, details);
}
