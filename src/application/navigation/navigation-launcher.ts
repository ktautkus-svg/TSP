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

export type NavigationLaunchEnvironment = {
  readonly isWeb: boolean;
  readonly openUrl: (url: string) => Promise<void>;
  readonly canOpenUrl: (url: string) => Promise<boolean>;
  readonly assignWeb?: (url: string) => void;
};

/**
 * Open the chosen navigation provider.
 *
 * Waze: always try the native `waze://` scheme first (works from iOS Safari /
 * PWA when the app is installed). Fall back to the HTTPS universal link only
 * when the scheme is known to be unavailable on native, or when opening the
 * scheme fails.
 *
 * PWA note: iOS does not expose a reliable "is Waze installed?" check from a
 * web context. Assigning `waze://` is the best supported path — if the app is
 * missing, iOS may show a brief error and the user can install Waze from the
 * store. Prefer that over bouncing installed users to waze.com's download page.
 */
export async function launchNavigation(
  urls: NavigationUrls,
  provider: NavigationProvider,
  environment: NavigationLaunchEnvironment,
): Promise<void> {
  const assignWeb = environment.assignWeb ?? ((url: string) => openWebNavigationInSameContext(url));
  const selected = navigationUrlForProvider(urls, provider);

  if (provider !== 'waze') {
    if (environment.isWeb) {
      assignWeb(selected);
      return;
    }
    await environment.openUrl(selected);
    return;
  }

  if (environment.isWeb) {
    // Custom scheme first — universal https links frequently stay in Safari.
    assignWeb(urls.waze);
    return;
  }

  try {
    const supported = await environment.canOpenUrl(urls.waze);
    if (supported) {
      await environment.openUrl(urls.waze);
      return;
    }
  } catch {
    // canOpenURL can throw when the scheme is not declared; still try the
    // native scheme before falling through to https / maps fallbacks.
  }

  try {
    await environment.openUrl(urls.waze);
    return;
  } catch {
    // Fall through to universal link, then maps fallback.
  }

  try {
    await environment.openUrl(urls.wazeUniversal);
  } catch {
    await environment.openUrl(urls.fallback);
  }
}
