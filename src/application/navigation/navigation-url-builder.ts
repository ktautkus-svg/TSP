import type { RouteEndpoint } from '@/domain/route';

export type NavigationPlatform = 'ios' | 'android' | 'web';

export type NavigationUrls = {
  waze: string;
  fallback: string;
  fallbackProvider: 'apple_maps' | 'google_maps';
};

export class NavigationTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavigationTargetError';
  }
}

export function buildNavigationUrls(
  target: Pick<RouteEndpoint, 'originalAddress' | 'normalizedAddress' | 'latitude' | 'longitude'>,
  platform: NavigationPlatform,
): NavigationUrls {
  const hasCoordinates = Number.isFinite(target.latitude) && Number.isFinite(target.longitude);
  const address = (target.normalizedAddress ?? target.originalAddress).trim();
  if (!hasCoordinates && !address) {
    throw new NavigationTargetError('Adresas tuščias. Pirmiausia patvirtinkite pristatymo vietą.');
  }
  const destination = hasCoordinates
    ? `${target.latitude},${target.longitude}`
    : address;
  const encoded = encodeURIComponent(destination);
  const waze = platform === 'web'
    ? hasCoordinates
      ? `https://waze.com/ul?ll=${target.latitude}%2C${target.longitude}&navigate=yes`
      : `https://waze.com/ul?q=${encoded}&navigate=yes`
    : hasCoordinates
      ? `waze://?ll=${target.latitude},${target.longitude}&navigate=yes`
      : `waze://?q=${encoded}&navigate=yes`;
  if (platform === 'ios') {
    return {
      waze,
      fallback: `http://maps.apple.com/?daddr=${encoded}&dirflg=d`,
      fallbackProvider: 'apple_maps',
    };
  }
  return {
    waze,
    fallback: `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`,
    fallbackProvider: 'google_maps',
  };
}

export function navigationTargetFromStop(stop: {
  originalAddress: string;
  normalizedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  addressValidationState: string;
}): RouteEndpoint {
  if (stop.addressValidationState !== 'auto_confirmed') {
    throw new NavigationTargetError('Adresas dar nepatvirtintas. Patvirtinkite jį prieš atidarydami navigaciją.');
  }
  return {
    originalAddress: stop.originalAddress,
    geocodingQuery: stop.originalAddress,
    normalizedAddress: stop.normalizedAddress,
    latitude: stop.latitude,
    longitude: stop.longitude,
  };
}
