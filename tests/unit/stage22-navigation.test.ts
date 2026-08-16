import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('stage 2.2 deterministic navigation', () => {
  it('routes successful completion to an isolated result screen', () => {
    const delivery = source('src/app/route/[id]/delivery.tsx');
    const result = source('src/app/route/[id]/result.tsx');
    expect(delivery).toContain("pathname: '/route/[id]/result'");
    expect(result).toContain('Maršrutas užbaigtas');
    expect(result).toContain('Peržiūrėti maršrutą');
    expect(result).toContain('Į pradžią');
    expect(result).toContain('gestureEnabled: false');
    expect(result).toContain("title: 'Maršruto rezultatas'");
    expect(result).not.toContain('router.back(');
  });

  it('provides deterministic history detail exits and blocks stale route states', () => {
    const detail = source('src/app/history/[id].tsx');
    expect(detail).toContain("router.replace('/history' as Href)");
    expect(detail).toContain("router.replace('/' as Href)");
    expect(detail).toContain('← Maršrutai');
    expect(detail).toContain('Į pradžią');
    expect(detail).toContain("!['completed', 'cancelled'].includes(persisted.route.status)");
    expect(detail).toContain('resolveRoute(persisted.route)');
    expect(detail).toContain('gestureEnabled: false');
    expect(detail).not.toContain('router.back(');
    expect(detail).toContain('<RouteBottomTabs');
  });

  it('combines operational and historical routes with deterministic exits', () => {
    const history = source('src/app/history.tsx');
    expect(history).toContain("router.replace('/' as Href)");
    expect(history).toContain('Į skydelį');
    expect(history).toContain('DABAR IR TOLIAU');
    expect(history).toContain('ANKSTESNI');
    expect(history).toContain('repository.listOperational(owner)');
    expect(history).toContain('repository.listHistory(50, owner)');
    expect(history).toContain('Maršrutų dar nėra');
    expect(history).toContain('gestureEnabled: false');
    expect(history).not.toContain('router.back(');
    expect(history).toContain('<DriverAppTabs active="routes"');
  });

  it('keeps technical audit data collapsed by default', () => {
    const detail = source('src/app/history/[id].tsx');
    expect(detail).toContain('useState(false)');
    expect(detail).toContain('Techninė informacija');
    expect(detail).toContain("showTechnical ? audit.map");
    expect(detail).toContain('Audito įrašai paslėpti.');
  });

  it('exposes Dashboard navigation with and without an active route', () => {
    const dashboard = source('src/app/index.tsx');
    expect(dashboard).toContain('Naujas maršrutas');
    expect(dashboard).toContain('activeRouteAction(active)');
    expect(dashboard).toContain('Maršrutai');
    expect(dashboard).toContain('Nustatymai');
    expect(dashboard).toContain('<DriverAppTabs active="now"');
  });

  it('keeps the three non-duplicated driver destinations consistent across global screens', () => {
    const tabs = source('src/components/driver-app-tabs.tsx');
    expect(tabs).not.toContain("label: 'Dabar'");
    expect(tabs).toContain("label: 'Maršrutai'");
    expect(tabs).toContain("label: 'Statistika'");
    expect(tabs).toContain("label: 'Nustatymai'");
    expect(source('src/app/history.tsx')).toContain('<DriverAppTabs active="routes"');
    expect(source('src/app/statistics.tsx')).toContain('<DriverAppTabs active="statistics"');
    expect(source('src/app/settings/index.tsx')).toContain('<DriverAppTabs active="settings"');
  });

  it('gives every non-Dashboard stack screen a visible global Home action', () => {
    const layout = source('src/app/_layout.tsx');
    const stackNavigation = source('src/components/stack-navigation.tsx');
    expect(layout).toContain('headerRight: () => <StackHeaderActions />');
    expect(stackNavigation).toContain("router.replace('/' as Href)");
    expect(stackNavigation).toContain('>Pradžia<');
    expect(layout).toContain('<Stack.Screen name="settings/index"');
    expect(layout).toContain('<Stack.Screen name="route/[id]/result"');
  });

  it('keeps settings and location settings out of dead ends', () => {
    const settings = source('src/app/settings/index.tsx');
    const locations = source('src/app/settings/locations.tsx');
    expect(settings).toContain("router.replace('/' as Href)");
    expect(settings).toContain('Sandėlis ir namų vieta');
    expect(locations).toContain("router.replace('/settings' as Href)");
    expect(locations).toContain('← Nustatymai');
  });

  it('does not expose unhandled async history or settings loads', () => {
    for (const path of ['src/app/history.tsx', 'src/app/history/[id].tsx', 'src/app/route/[id]/result.tsx', 'src/app/settings/locations.tsx']) {
      const content = source(path);
      expect(content).not.toMatch(/void\s+[^;]+\.then\([^;]+\);/s);
      expect(content).toContain('.catch(');
    }
  });
});
