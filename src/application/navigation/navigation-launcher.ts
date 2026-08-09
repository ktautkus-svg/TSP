import type { NavigationProvider } from '@/application/settings/navigation-preference';
import type { NavigationUrls } from './navigation-url-builder';

export function navigationUrlForProvider(urls: NavigationUrls, provider: NavigationProvider): string {
  if (provider === 'apple_maps') return urls.appleMaps;
  if (provider === 'google_maps') return urls.googleMaps;
  return urls.waze;
}

export function openWebNavigationInSameContext(
  url: string,
  assign: (nextUrl: string) => void = (nextUrl) => window.location.assign(nextUrl),
): void {
  assign(url);
}
