import type { GatewayMatrixRequest } from '../../gateway/types';

export function gatewayRequest(
  provider: 'here' | 'google' = 'here',
): GatewayMatrixRequest {
  const start = {
    id: 'start',
    label: 'Startas',
    latitude: 54.6382,
    longitude: 25.1742,
  };
  const stop = {
    id: 'stop',
    label: 'Taškas',
    latitude: 54.6872,
    longitude: 25.2797,
  };
  const end = {
    id: 'end',
    label: 'Pabaiga',
    latitude: 54.7338,
    longitude: 25.2394,
  };
  return {
    schemaVersion: '1',
    provider,
    matrixId: `test-${provider}`,
    startLocation: start,
    stops: [stop],
    endLocation: end,
    departureAt: '2026-08-03T04:30:00.000Z',
    trafficMode: 'live',
    vehicle: {
      id: 'truck',
      type: 'truck',
      maximumPayloadKg: 3500,
      heightM: 3.1,
      widthM: 2.3,
      lengthM: 7,
      grossWeightKg: 7500,
      useRoadRestrictions: true,
      startLocation: start,
      defaultEndLocation: end,
    },
    language: 'lt-LT',
    regionCode: 'LT',
  };
}

