import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
}));

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  Modal: 'Modal',
  Platform: { OS: 'web', select: (spec: Record<string, string>) => spec.default ?? spec.web ?? 'monospace' },
  StyleSheet: { create: (styles: unknown) => styles },
}));

vi.mock('@/ui/theme', async () => ({ useTheme: () => ({ colors: (awaitColors) }) }));
import { colors as awaitColors } from '@/ui/tokens';
import { FinanceConfirmDialog } from '@/components/finance-confirm-dialog';

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

function renderDialog(props: Partial<Parameters<typeof FinanceConfirmDialog>[0]> = {}) {
  hooks.cursor = 0;
  const onCancel = props.onCancel ?? vi.fn();
  const onConfirm = props.onConfirm ?? vi.fn();
  const onRetry = props.onRetry ?? vi.fn();
  const tree = nodes(FinanceConfirmDialog({
    visible: true,
    title: 'Pašalinti papildomą sumą?',
    message: 'driver-1 · 2026-10-02 rankinė suma',
    testID: 'finance-remove-confirm-driver-1|2026-10-02',
    onCancel,
    onConfirm,
    onRetry,
    ...props,
  }));
  return { tree, onCancel, onConfirm, onRetry };
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
});

describe('FinanceConfirmDialog rendered UI', () => {
  it('renders cancel and confirm controls (not RN Alert no-op)', () => {
    const { tree } = renderDialog();
    expect(find(tree, 'finance-remove-confirm-driver-1|2026-10-02')).toBeTruthy();
    expect(find(tree, 'finance-remove-confirm-driver-1|2026-10-02-title')?.props.children).toBe('Pašalinti papildomą sumą?');
    expect(find(tree, 'finance-remove-confirm-driver-1|2026-10-02-cancel')).toBeTruthy();
    expect(find(tree, 'finance-remove-confirm-driver-1|2026-10-02-confirm')).toBeTruthy();
    expect(JSON.stringify(tree)).toContain('Atšaukti');
    expect(JSON.stringify(tree)).toContain('Pašalinti');
  });

  it('cancel does not call confirm', () => {
    const { tree, onCancel, onConfirm } = renderDialog();
    find(tree, 'finance-remove-confirm-driver-1|2026-10-02-cancel')!.props.onPress();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm invokes onConfirm while busy shows disabled confirm label', () => {
    const idle = renderDialog();
    find(idle.tree, 'finance-remove-confirm-driver-1|2026-10-02-confirm')!.props.onPress();
    expect(idle.onConfirm).toHaveBeenCalledTimes(1);

    const busy = renderDialog({ busy: true });
    const confirm = find(busy.tree, 'finance-remove-confirm-driver-1|2026-10-02-confirm')!;
    expect(confirm.props.disabled).toBe(true);
    expect(JSON.stringify(busy.tree)).toContain('Šalinama…');
    expect(find(busy.tree, 'finance-remove-confirm-driver-1|2026-10-02-cancel')!.props.disabled).toBe(true);
  });

  it('keeps dialog open on error and exposes retry', () => {
    const { tree, onRetry, onConfirm } = renderDialog({
      error: 'Pašalinti nepavyko.',
      busy: false,
    });
    expect(find(tree, 'finance-remove-confirm-driver-1|2026-10-02-error')?.props.children).toBe('Pašalinti nepavyko.');
    expect(find(tree, 'finance-remove-confirm-driver-1|2026-10-02-confirm')).toBeUndefined();
    const retry = find(tree, 'finance-remove-confirm-driver-1|2026-10-02-retry')!;
    retry.props.onPress();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('returns null when not visible', () => {
    hooks.cursor = 0;
    expect(FinanceConfirmDialog({
      visible: false,
      title: 'x',
      message: 'y',
      onCancel: () => undefined,
      onConfirm: () => undefined,
    })).toBeNull();
  });
});

describe('finance screens wire Modal confirm instead of Alert.alert for deletes', () => {
  it('wages and month-summary import FinanceConfirmDialog for removal', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const wages = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    const month = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/month-summary.tsx'), 'utf8');
    expect(wages).toContain("from '@/components/finance-confirm-dialog'");
    expect(month).toContain("from '@/components/finance-confirm-dialog'");
    expect(wages).toContain('FinanceConfirmDialog');
    expect(month).toContain('FinanceConfirmDialog');
    expect(wages).toContain('executeRemove');
    expect(month).toContain('executeAccountingDelete');
    // Delete flows must not depend on RN web Alert.alert no-op.
    const wagesRemove = wages.slice(wages.indexOf('const removeAdjustment'), wages.indexOf('return <View style={styles.detailSection}'));
    expect(wagesRemove).not.toContain('Alert.alert');
    const monthRemove = month.slice(month.indexOf('const removeAccountingRow'), month.indexOf('const save = async'));
    expect(monthRemove).not.toContain('Alert.alert');
  });
});
