import type {
  RoutingLocation,
  TrafficMode,
  TravelMatrix,
  VehicleRoutingProfile,
} from '../src/domain/routing/models';
import type { OcrResult } from '../src/domain/import/models';

export type GatewayProvider = 'here' | 'google';
export type GatewayRunMode = 'real' | 'cache-only' | 'refresh' | 'synthetic';

export type GatewayMatrixRequest = {
  schemaVersion: '1';
  provider: GatewayProvider;
  matrixId: string;
  startLocation: RoutingLocation;
  stops: RoutingLocation[];
  endLocation: RoutingLocation;
  departureAt: string;
  trafficMode: Exclude<TrafficMode, 'synthetic'>;
  vehicle: VehicleRoutingProfile;
  language: 'lt-LT';
  regionCode: 'LT';
  /** Ties every matrix request to one planning run in the cost logs. */
  planningRunId?: string | null;
};

export type GatewayPolylineRequest = {
  schemaVersion: '1';
  provider: GatewayProvider;
  startLocation: RoutingLocation;
  orderedStops: RoutingLocation[];
  endLocation: RoutingLocation;
  departureAt?: string;
  trafficMode?: Exclude<TrafficMode, 'synthetic'>;
  language?: 'lt-LT';
  regionCode?: 'LT';
};

export type GatewayGeocodeRequest = {
  address: string;
  language: 'lt';
  region: 'lt';
};

export type GeocodeCandidate = {
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  placeId: string | null;
  locationType: string;
  resultTypes: string[];
};

export type GatewayGeocodeResponse = {
  query: string;
  isUnambiguous: boolean;
  result: GeocodeCandidate | null;
  alternatives: GeocodeCandidate[];
  executionMode: 'real' | 'cache';
  gatewayMetadata: {
    cacheHit: boolean;
    externalRequestCount: number;
    providerResponseMs: number;
  };
};

export type GatewayOcrRequest = {
  documentId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' | 'application/pdf';
  imageBase64: string;
  languageHints: string[];
};

export type GatewayOcrResponse = OcrResult;

export type ProviderCapabilities = {
  trafficSupported: boolean;
  predictiveTrafficSupported: boolean;
  truckRestrictionsSupported: boolean;
  vehicleDimensionsSupported: boolean;
  asymmetricMatrixSupported: boolean;
  departureTimeSupported: boolean;
  maneuverMetadataSupported: boolean;
  maximumMatrixElements: number;
  executionMode: 'real';
};

export type UsageMetadata = {
  unitName: 'matrix_elements';
  matrixElements: number;
  units: number;
  externalRequestCount: number;
  estimatedCost: number | null;
  currency: string | null;
};

export type GatewayMatrixMetadata = {
  matrixId: string;
  providerRequestId: string | null;
  providerResponseMs: number;
  totalResponseMs: number;
  completenessRatio: number;
  cacheHit: boolean;
  cacheStoredAt: string | null;
  capabilities: ProviderCapabilities;
  usage: UsageMetadata;
  adapterVersion: string;
  timeZone: 'Europe/Vilnius';
};

export type GatewayMatrixResponse = TravelMatrix & {
  gatewayMetadata: GatewayMatrixMetadata;
};

export type ProviderFetchResult = {
  matrix: TravelMatrix;
  providerRequestId: string | null;
  responseMs: number;
  completenessRatio: number;
  warnings: string[];
  externalRequestCount?: number;
  billableElementCount?: number;
};

export type ProviderFetchOptions = {
  bypassCache?: boolean;
};

export type PricingConfig = {
  currency: string | null;
  perThousandElements: Partial<Record<GatewayProvider, number>>;
};

export interface MatrixProviderAdapter {
  readonly provider: GatewayProvider;
  readonly version: string;
  readonly capabilities: ProviderCapabilities;
  fetchMatrix(
    request: GatewayMatrixRequest,
    signal: AbortSignal,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult>;
}
