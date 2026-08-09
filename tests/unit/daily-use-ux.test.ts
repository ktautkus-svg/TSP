import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { navigationUrlForProvider, openWebNavigationInSameContext } from '../../src/application/navigation/navigation-launcher';
import { buildNavigationUrls } from '../../src/application/navigation/navigation-url-builder';
import { NavigationPreference } from '../../src/application/settings/navigation-preference';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
}

function createPreferenceDb(): SQLiteDatabase {
  const adapter = new ExpoLikeDatabase();
  adapter.raw.exec('CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
  return adapter as unknown as SQLiteDatabase;
}

describe('Daily Use navigation preference', () => {
  it('defaults to Waze and persists every supported provider across repository instances', async () => {
    const db = createPreferenceDb();
    expect(await new NavigationPreference(db).get()).toBe('waze');
    await new NavigationPreference(db).save('apple_maps', '2026-08-09T10:00:00.000Z');
    expect(await new NavigationPreference(db).get()).toBe('apple_maps');
    await new NavigationPreference(db).save('google_maps', '2026-08-09T10:01:00.000Z');
    expect(await new NavigationPreference(db).get()).toBe('google_maps');
  });

  it('selects the exact requested provider and launches web navigation in the same context', () => {
    const urls = buildNavigationUrls({
      originalAddress: 'Tilžės g. 1, Šiauliai',
      normalizedAddress: 'Tilžės g. 1, Šiauliai, Lietuva',
      latitude: 55.93,
      longitude: 23.31,
    }, 'web');
    expect(navigationUrlForProvider(urls, 'waze')).toContain('waze.com/ul');
    expect(navigationUrlForProvider(urls, 'apple_maps')).toContain('maps.apple.com');
    expect(navigationUrlForProvider(urls, 'google_maps')).toContain('google.com/maps/dir');
    const assign = vi.fn();
    openWebNavigationInSameContext(urls.waze, assign);
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(urls.waze);
  });
});

describe('Daily Use menu and Dashboard contract', () => {
  it('keeps only requested top-level menu items and nests exactly four active-route actions', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    const menu = delivery.slice(delivery.indexOf('visible={menuOpen}'), delivery.indexOf('visible={showAddStop}'));
    expect(menu).not.toContain('Naujas maršrutas');
    for (const label of ['Pradžios meniu', 'Aktyvus maršrutas', 'Statistika', 'Nustatymai']) expect(menu).toContain(`>${label}<`);
    for (const label of ['Įtraukti sustojimą', 'Perskaičiuoti maršrutą', 'Baigti maršrutą', 'Nutraukti maršrutą']) expect(menu).toContain(`>${label}<`);
    expect(menu).toContain("route?.status === 'in_progress' && activeMenuExpanded");
    expect(menu).toContain('active-route-menu-actions');
  });

  it('shows a compact whole-route summary instead of next-stop ETA chatter on Home', () => {
    const dashboard = source('src/app/index.tsx');
    expect(dashboard).toContain('dashboard-route-summary');
    expect(dashboard).toContain('progress.totalStops');
    expect(dashboard).toContain('progress.remainingStops');
    expect(dashboard).toContain('progress.totalKnownWeightKg');
    expect(dashboard).toContain('progress.remainingKnownWeightKg');
    expect(dashboard).toContain('active.estimatedDistanceKm');
    expect(dashboard).toContain('progress.preliminaryRemainingDistanceKm');
    expect(dashboard).not.toContain('KITAS PRISTATYMAS');
    expect(dashboard).not.toContain('dashboard-next-stop');
    expect(dashboard).not.toContain('Mano maršrutas');
    expect(dashboard).not.toContain("href={'/statistics' as Href}");
    expect(dashboard).not.toContain('Kelionės lapas, transportas ir degalai');
    expect(dashboard).toContain("safeArea: { flex: 1, backgroundColor: '#FFFFFF' }");
  });

  it('does not open a new browser context for PWA navigation', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    const launcher = source('src/application/navigation/navigation-launcher.ts');
    expect(delivery).toContain('openWebNavigationInSameContext(selectedUrl)');
    expect(delivery).not.toContain('await Linking.openURL(urls.waze)');
    expect(delivery).not.toContain('window.open(');
    expect(launcher).toContain('window.location.assign(nextUrl)');
    expect(launcher).not.toContain('window.open(');
    expect(launcher).not.toContain('_blank');
  });

  it('keeps the active dashboard within the viewport width at narrow breakpoints', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('(Math.min(viewportWidth, 430) - 124) / 2');
    expect(delivery).toContain("overflow: 'hidden'");
    expect(source('src/app/+html.tsx')).toContain('overflow-x: hidden');
  });

  it('keeps next-stop actions visible and replaces duplicate distance data with the delivery window state', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    expect(delivery).toContain('dashboard-arrival-window');
    expect(delivery).toContain('deliveryWindowValue(nextStop)');
    expect(delivery).toContain('nextStopWindow.label');
    expect(delivery).toContain('>NAVIGUOTI<');
    expect(delivery).toContain('>ATLIKTA<');
    expect(delivery).toContain('>NEATLIKTA<');
    expect(delivery).not.toContain('dashboardStopExpanded ? (');
    expect(delivery).not.toContain('nextStopMetaRow');
  });

  it('keeps every detailed Settings section collapsed by default', () => {
    const settings = source('src/app/settings/index.tsx');
    expect(settings).toContain('const [openSection, setOpenSection] = useState<SettingsSection | null>(null)');
    for (const section of ['appearance', 'navigation', 'gateway', 'data']) {
      expect(settings).toContain(`openSection === '${section}'`);
    }
    expect(settings).toContain('Duomenys ir atsarginė kopija');
    expect(settings).toContain('← Pradžios meniu');
    expect(settings).toContain("headerText: { color: '#FFFFFF'");
  });
});
