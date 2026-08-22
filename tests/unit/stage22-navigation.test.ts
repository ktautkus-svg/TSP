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
    expect(detail).toContain('router.replace(roleHomePath(profile.role) as Href)');
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
    expect(history).toContain('router.replace(roleHomePath(profile.role) as Href)');
    expect(history).toContain('Į skydelį');
    expect(history).toContain('VYKDOMA DABAR');
    expect(history).toContain('Suplanuoti maršrutai');
    expect(history).toContain('Užbaigtų maršrutų istorija');
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

  it('gives stack screens a deterministic role-aware Home action', () => {
    const layout = source('src/app/_layout.tsx');
    const stackNavigation = source('src/components/stack-navigation.tsx');
    const roleHome = source('src/application/navigation/role-home.ts');
    expect(layout).toContain('headerRight: () => <StackHeaderActions />');
    expect(stackNavigation).toContain('router.replace(navigation.homeTarget)');
    expect(stackNavigation).toContain('roleHomePath(profile.role)');
    expect(roleHome).toContain("if (role === 'driver') return '/history'");
    expect(roleHome).toContain("if (role === 'dispatcher') return '/dispatcher'");
    expect(roleHome).toContain("if (role === 'quality') return '/quality-control'");
    expect(stackNavigation).not.toContain('router.back()');
    expect(stackNavigation).toContain('>Pradžia<');
    expect(layout).toContain('<Stack.Screen name="settings/index"');
    expect(layout).toContain('<Stack.Screen name="route/[id]/result"');
  });

  it('keeps route actions on their cards and opens order editing with its map', () => {
    const routes = source('src/app/history.tsx');
    const overview = source('src/app/route/[id]/overview.tsx');
    expect(routes).not.toContain('driver-route-primary-actions');
    expect(routes).toContain("secondaryActionLabel={['planned', 'in_progress'].includes(route.status) ? 'Redaguoti' : 'Informacija'}");
    expect(routes).toContain("edit: 'order'");
    expect(overview).toContain('testID="active-route-order-map"');
    expect(overview).toContain('<RouteMapView');
    expect(overview).toContain('buildOrderMap(route, stops, pendingOrder)');
  });

  it('keeps settings and location settings out of dead ends', () => {
    const settings = source('src/app/settings/index.tsx');
    const locations = source('src/app/settings/locations.tsx');
    expect(settings).toContain('Sandėlis ir namų vieta');
    expect(settings).toContain('<DriverAppTabs active="settings"');
    expect(locations).toContain("router.replace('/settings' as Href)");
    expect(locations).toContain('← Nustatymai');
  });

  it('groups settings into compact sections and keeps expanded controls attached to their row', () => {
    const settings = source('src/app/settings/index.tsx');
    expect(settings).toContain('PASKYRA');
    expect(settings).toContain('MARŠRUTAS IR NAVIGACIJA');
    expect(settings).toContain('PROGRAMA');
    expect(settings).toContain('styles.settingsGroup');
    expect(settings).toContain('styles.groupDivider');
    expect(settings).toContain('styles.expandedContent');
    expect(settings).toContain("current === section ? null : section");
  });

  it('does not expose unhandled async history or settings loads', () => {
    for (const path of ['src/app/history.tsx', 'src/app/history/[id].tsx', 'src/app/route/[id]/result.tsx', 'src/app/settings/locations.tsx']) {
      const content = source(path);
      expect(content).not.toMatch(/void\s+[^;]+\.then\([^;]+\);/s);
      expect(content).toContain('.catch(');
    }
  });
});
