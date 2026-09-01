import type { RouteEndpoint } from '@/domain/route';

export type NavigationPlatform = 'ios' | 'android' | 'web';

export type NavigationUrls = {
  /** Native Waze URL scheme — preferred on every platform, including iOS PWA. */
  waze: string;
  /** HTTPS universal link / web fallback when the Waze app is not installed. */
  wazeUniversal: string;
  appleMaps: string;
  googleMaps: string;
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
  // Always prefer the custom scheme. https://waze.com/ul often stays inside
  // Safari/PWA and lands on the "Don't have Waze yet?" download page even when
  // the app is installed (iOS universal-link handoff is unreliable from PWAs).
  const waze = hasCoordinates
    ? `waze://?ll=${target.latitude},${target.longitude}&navigate=yes`
    : `waze://?q=${encoded}&navigate=yes`;
  const wazeUniversal = hasCoordinates
    ? `https://waze.com/ul?ll=${target.latitude}%2C${target.longitude}&navigate=yes`
    : `https://waze.com/ul?q=${encoded}&navigate=yes`;
  const appleMaps = `https://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  const googleMaps = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  if (platform === 'ios') {
    return {
      waze,
      wazeUniversal,
      appleMaps,
      googleMaps,
      fallback: appleMaps,
      fallbackProvider: 'apple_maps',
    };
  }
  return {
    waze,
    wazeUniversal,
    appleMaps,
    googleMaps,
    fallback: googleMaps,
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
