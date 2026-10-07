import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as Array<() => void> }));

vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (fn: unknown) => fn,
    useEffect: (run: () => void) => {
      hooks.effects.push(run);
    },
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        hooks.values[index],
        (value: unknown) => {
          hooks.values[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(hooks.values[index]) : value;
        },
      ];
    },
  };
});

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  ScrollView: 'ScrollView',
  Modal: 'Modal',
  Platform: { OS: 'web', select: (spec: Record<string, string>) => spec.default ?? spec.web ?? 'monospace' },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 1366, height: 768 }),
}));

vi.mock('expo-router', () => ({
  Stack: { Screen: 'Stack.Screen' },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
}));

vi.mock('@/ui/theme', async () => ({ useTheme: () => ({ colors: (awaitColors) }) }));
vi.mock('@/ui/alert', () => ({ Alert: { alert: vi.fn() } }));
vi.mock('@/components/app-icons', () => ({ ChevronDownIcon: 'ChevronDownIcon' }));
vi.mock('@/components/date-input', () => ({ DateInput: 'DateInput' }));
vi.mock('@/components/foundation-screen', () => ({ FoundationScreen: 'FoundationScreen' }));
vi.mock('@/components/menu-artwork', () => ({ MenuArtwork: 'MenuArtwork' }));
vi.mock('@/components/period-calendar-picker', () => ({ PeriodCalendarPicker: 'PeriodCalendarPicker' }));
vi.mock('@/components/finance-confirm-dialog', () => ({ FinanceConfirmDialog: 'FinanceConfirmDialog' }));
vi.mock('@/application/auth/local-access-context', () => ({
  useLocalAccess: () => ({ profile: { role: 'admin', permissions: {} }, online: true }),
}));
vi.mock('@/application/auth/employee-permissions', () => ({
  normalizeEmployeePermissions: () => ({}),
}));
vi.mock('@/application/navigation/role-home', () => ({ roleHomePath: () => '/' }));
vi.mock('@/application/settings/company-profile', () => ({ CompanyProfileSettings: { load: async () => ({}) } }));
vi.mock('@/application/trip-sheet/print-frame', () => ({ printHtmlDocument: vi.fn() }));
vi.mock('@/application/finance/wage-document', () => ({ buildWagePrintDocument: vi.fn() }));
vi.mock('@/application/finance/wage-workbook', () => ({ buildWageWorkbook: vi.fn() }));
vi.mock('@/infrastructure/auth/employee-session', () => ({
  employeeApi: vi.fn(),
}));

import { colors as awaitColors } from '@/ui/tokens';
import { aggregateWageDays } from '@/application/finance/wage-report';
import type { ServerTripSheet } from '@/infrastructure/auth/employee-session';
import { WageDayDetail, createWageScreenStyles } from '../../src/app/finance/wages';

type Node = ReactElement<Record<string, any>>;

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

function find(tree: Node[], id: string): Node | undefined {
  return tree.find((node) => node.props.testID === id);
}

const eur2 = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sheet(overrides: Partial<ServerTripSheet> = {}): ServerTripSheet {
  return {
    id: 'sheet-1',
    assignmentId: 'assignment-1',
    routeId: 'route-1',
    routeNumbers: ['R1'],
    status: 'completed',
    date: '2026-10-03',
    driverId: 'driver-1',
    driverName: 'Jonas',
    vehicle: null,
    fuelNormLitersPer100Km: null,
    startOdometer: null,
    endOdometer: null,
    actualDistanceKm: 100,
    plannedDistanceKm: null,
    startedAt: null,
    completedAt: null,
    durationMinutes: null,
    totalStops: 4,
    deliveredStops: 4,
    totalWeightKg: 200,
    deliveredWeightKg: 200,
    startAddress: '',
    endAddress: '',
    compensation: {
      rates: { type: 'variable', fixedDailyNetEur: 20, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65 },
      distanceKm: 100,
      distanceSource: 'odometer',
      weightKg: 200,
      stops: 4,
      fixedAmountEur: 20,
      distanceAmountEur: 5,
      weightAmountEur: 1.2,
      stopsAmountEur: 2.6,
      totalNetEur: 32.8,
      preliminary: false,
    },
    fuelEntries: [],
    ...overrides,
  };
}

function renderDetail(day = aggregateWageDays([sheet()], [
  { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-03', amountEur: 6, comment: 'Mobile quick edit' },
])[0]!) {
  hooks.cursor = 0;
  hooks.effects = [];
  const styles = createWageScreenStyles(awaitColors);
  const tree = nodes(WageDayDetail({
    day,
    canEdit: true,
    online: true,
    onSaved: vi.fn(),
    styles,
  }));
  return { tree, day, styles };
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.effects = [];
});

describe('WageDayDetail product composition (real component)', () => {
  it('shows manual Papildomai and Dienos suma matching the day-card payEur (32,80 + 6 → 38,80)', () => {
    const { tree, day } = renderDetail();
    expect(day.figures.wageEur).toBe(32.8);
    expect(day.manualAdjustment!.amountEur).toBe(6);
    expect(day.figures.payEur).toBe(38.8);

    const dump = JSON.stringify(tree);
    expect(find(tree, `finance-wage-composition-${day.key}`)).toBeTruthy();
    expect(dump).toContain('"Papildomai"');
    expect(dump).toContain(JSON.stringify(eur2.format(6)));
    expect(dump).toContain('"Dienos suma"');
    expect(dump).toContain(JSON.stringify(eur2.format(38.8)));
    // Emphasized day total must be payEur, not trip-only wageEur.
    const totalLine = find(tree, `finance-wage-composition-total-${day.key}`);
    expect(totalLine).toBeTruthy();
    expect(JSON.stringify(totalLine)).toContain(JSON.stringify(eur2.format(38.8)));
    expect(JSON.stringify(totalLine)).not.toContain(JSON.stringify(eur2.format(32.8)));
  });

  it('omits Papildomai when there is no manualAdjustment and total equals trip wage', () => {
    const day = aggregateWageDays([sheet()], [])[0]!;
    const { tree } = renderDetail(day);
    expect(find(tree, `finance-wage-composition-extra-${day.key}`)).toBeUndefined();
    const totalLine = find(tree, `finance-wage-composition-total-${day.key}`);
    expect(totalLine).toBeTruthy();
    expect(JSON.stringify(totalLine)).toContain(JSON.stringify(eur2.format(32.8)));
    expect(JSON.stringify(tree)).not.toContain('"Papildomai"');
  });

  it('shows negative, zero and comment-only manual lines without doubling trip wage', () => {
    const negative = aggregateWageDays([sheet()], [
      { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-03', amountEur: -5, comment: 'Korekcija' },
    ])[0]!;
    let { tree } = renderDetail(negative);
    expect(JSON.stringify(find(tree, `finance-wage-composition-extra-${negative.key}`))).toContain(JSON.stringify(eur2.format(-5)));
    expect(JSON.stringify(find(tree, `finance-wage-composition-total-${negative.key}`))).toContain(JSON.stringify(eur2.format(27.8)));
    expect(negative.figures.payEur).toBe(27.8);

    const zero = aggregateWageDays([sheet()], [
      { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-03', amountEur: 0, comment: 'Sirgau' },
    ])[0]!;
    ({ tree } = renderDetail(zero));
    expect(JSON.stringify(find(tree, `finance-wage-composition-extra-${zero.key}`))).toContain(JSON.stringify(eur2.format(0)));
    expect(JSON.stringify(find(tree, `finance-wage-composition-total-${zero.key}`))).toContain(JSON.stringify(eur2.format(32.8)));
    expect(zero.figures.payEur).toBe(32.8);
  });

  it('does not invent a composition total from legacy trip wage when only a bonus-without-trip exists', () => {
    const bonusOnly = aggregateWageDays([], [
      { driverId: 'driver-1', driverName: 'Jonas', date: '2026-10-03', amountEur: 100, comment: 'Šeštadienis' },
    ])[0]!;
    const { tree } = renderDetail(bonusOnly);
    expect(bonusOnly.figures.hasCompensation).toBe(false);
    expect(find(tree, `finance-wage-composition-${bonusOnly.key}`)).toBeUndefined();
    expect(JSON.stringify(tree)).toContain('Atlygio detalizacija dar neapskaičiuota');
    expect(JSON.stringify(tree)).toContain('Šią dieną reiso nėra');
  });
});
