import type { GatewayProvider, ProviderCapabilities } from './types';

export const PROVIDER_CAPABILITIES: Record<
  GatewayProvider,
  ProviderCapabilities
> = {
  here: {
    trafficSupported: true,
    predictiveTrafficSupported: true,
    truckRestrictionsSupported: true,
    vehicleDimensionsSupported: true,
    asymmetricMatrixSupported: true,
    departureTimeSupported: true,
    maneuverMetadataSupported: false,
    maximumMatrixElements: 250_000,
    executionMode: 'real',
  },
  google: {
    trafficSupported: true,
    predictiveTrafficSupported: true,
    truckRestrictionsSupported: false,
    vehicleDimensionsSupported: false,
    asymmetricMatrixSupported: true,
    departureTimeSupported: true,
    maneuverMetadataSupported: false,
    maximumMatrixElements: 625,
    executionMode: 'real',
  },
};

