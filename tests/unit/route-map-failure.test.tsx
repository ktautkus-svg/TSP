import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Exercise the component's event handlers without a browser or tile requests.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, width: 390 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Platform: { select: () => 'monospace' },
  useWindowDimensions: () => ({ width: hooks.width }),
}));
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) } }));
vi.mock('react-leaflet', () => ({
  MapContainer: 'MapContainer', TileLayer: 'TileLayer', Marker: 'Marker', Polyline: 'Polyline', useMap: vi.fn(),
}));
vi.mock('@/ui/theme', async () => ({ useTheme: () => ({ colors: (awaitColors) }) }));
import { colors as awaitColors } from '@/ui/tokens';
import { RouteMapView } from '@/components/route-map.web';
import { RouteVariantStops, RouteVariantSummary } from '@/components/route-variant-overview';
import type { RouteCandidate, RouteOptimizationRequest } from '@/domain/routing/models';

type Node = ReactElement<Record<string, any>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function render(compact = false) {
  hooks.cursor = 0;
  const location = { id: 'depot', label: 'Sandėlis', latitude: 54.7, longitude: 25.3 };
  return nodes(RouteMapView({ startLocation: location, endLocation: location,
    orderedStops: [{ ...location, id: 'second' }, { ...location, id: 'first' }], compact }));
}
const find = (tree: Node[], id: string) => tree.find((node) => node.props.testID === id)!;

beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.width = 390; });
describe('žemėlapio sluoksnio klaida', () => {
  it('po 403 rodo vieną pranešimą, pašalina plyteles ir pakartotinai jas įkelia', () => {
    let tree = render();
    const layer = tree.find((node) => node.type === 'TileLayer')!;
    layer.props.eventHandlers.tileerror({ error: new Error('403 Access blocked') });
    tree = render();
    expect(tree.filter((node) => node.props.testID === 'route-map-error')).toHaveLength(1);
    expect(tree.some((node) => node.type === 'MapContainer')).toBe(false);
    expect(JSON.stringify(tree)).not.toContain('403 Access blocked');
    find(tree, 'retry-route-map').props.onPress();
    tree = render();
    expect(find(tree, 'route-map-error')).toBeUndefined();
    expect(tree.find((node) => node.type === 'TileLayer')!.key).not.toBe(layer.key);
    expect(tree.filter((node) => node.type === 'Marker').map((node) => node.key))
      .toContain('0-second');
  });
  it.each([390, 768, 1280])('klaidos turiniui leidžia augti esant %i px pločiui', (width) => {
    hooks.width = width;
    let tree = render(true);
    tree.find((node) => node.type === 'TileLayer')!.props.eventHandlers.tileerror({});
    tree = render(true);
    expect(find(tree, 'route-map-canvas').props.style.at(-1).height).toBe('auto');
    const details = tree.find((node) => node.props.accessibilityState?.expanded === false)!;
    details.props.onPress();
    expect(JSON.stringify(render(true))).toContain('Tai nekeičia apskaičiuoto maršruto.');
  });
});

describe('pasirinkto varianto duomenys be žemėlapio', () => {
  const candidate = {
    stopSequence: ['b', 'a', 'c'], totalDistanceKm: 42.5, totalWorkMinutes: 90,
    schedules: [
      { stopId: 'a', serviceStartAt: '2026-09-18T09:00:00', lateMinutes: 7, waitingMinutes: 0 },
      { stopId: 'b', serviceStartAt: '2026-09-18T08:00:00', lateMinutes: 0, waitingMinutes: 0 },
    ],
  } as RouteCandidate;
  const request = { stops: [
    { id: 'a', location: { label: 'Klientas A', address: 'Adresas A' } },
    { id: 'b', location: { label: 'Klientas B', address: 'Adresas B' } },
    { id: 'c', location: { label: 'Klientas C', address: 'Adresas C' } },
  ] } as RouteOptimizationRequest;
  const text = (tree: Node[]) => tree.filter((node) => node.type === 'Text')
    .map((node) => [node.props.children].flat().join('')).join('\n');

  it('išlaiko pasirinkto varianto eiliškumą, adresus, laikus ir planavimo būsenas', () => {
    const content = text(nodes(RouteVariantStops({ candidate, request })));
    expect(content.indexOf('1. Klientas B')).toBeLessThan(content.indexOf('2. Klientas A'));
    expect(content).toContain('3. Klientas C');
    expect(content).toContain('Adresas B');
    expect(content).toContain('08:00');
    expect(content).toContain('09:00');
    expect(content).toContain('Numatomas vėlavimas: 7 min');
    expect(content).toContain('Suplanuota');
    expect(content).toContain('Nenurodytas');
    expect(content).toContain('Laikas neapskaičiuotas');
  });
  it('santraukoje pateikia pasirinkto varianto rodiklius', () => {
    const tree = nodes(RouteVariantSummary({ candidate, count: 4, title: 'Greičiausias' }));
    const content = text(tree);
    const metrics = tree.filter((node) => typeof node.type === 'function')
      .map((node) => ({ label: node.props.label, value: node.props.value }));
    expect(content).toContain('Greičiausias');
    expect(metrics).toContainEqual({ label: 'VARIANTAI', value: '4' });
    expect(metrics).toContainEqual({ label: 'ATSTUMAS', value: '42.5 km' });
    expect(metrics).toContainEqual({ label: 'TRUKMĖ', value: '1 val. 30 min.' });
    expect(metrics).toContainEqual({ label: 'SUSTOJIMAI', value: '3' });
  });
});

describe('kelio linijos laukimo užuomina', () => {
  it('nerodo „dar negauta“, kol linija nepaprašyta', () => {
    const location = { id: 'depot', label: 'Sandėlis', latitude: 54.7, longitude: 25.3 };
    const idle = nodes(RouteMapView({
      startLocation: location, endLocation: location, orderedStops: [], expectPolyline: false,
    }));
    expect(JSON.stringify(idle)).not.toContain('Kelio linija dar negauta');
    const waiting = nodes(RouteMapView({
      startLocation: location, endLocation: location, orderedStops: [], expectPolyline: true,
    }));
    expect(JSON.stringify(waiting)).toContain('Kelio linija dar negauta');
  });
});
