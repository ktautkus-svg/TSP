import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { applyWageQuickEditOpen } from '../../src/application/finance/wage-quick-edit-open';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
}));

vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks.values[index],
        (value: unknown) => {
          hooks.values[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(hooks.values[index]) : value;
        },
      ];
    },
    useEffect: (run: () => void) => {
      hooks.effects.push(run);
    },
  };
});

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  Pressable: 'Pressable',
}));

import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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

function flushEffects() {
  const pending = [...hooks.effects];
  hooks.effects = [];
  for (const run of pending) run();
}

/** Rendered shell of the fixed WageAdjustmentEditor quick-edit contract. */
function QuickEditShell(props: {
  startEditing: boolean;
  manualAmount: number;
  manualComment: string;
  onConsumed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    applyWageQuickEditOpen({
      startEditing: props.startEditing,
      manualAmount: props.manualAmount,
      manualComment: props.manualComment,
      seed: (nextAmount, nextComment) => {
        setAmount(nextAmount);
        setComment(nextComment);
      },
      setEditing,
      consume: props.onConsumed,
    });
  });

  const close = () => {
    setEditing(false);
    props.onConsumed();
  };

  return (
    <View testID="quick-edit-shell">
      {editing ? (
        <>
          <TextInput testID="finance-adjustment-amount" value={amount} onChangeText={setAmount} />
          <TextInput testID="finance-adjustment-comment" value={comment} onChangeText={setComment} />
          <Pressable testID="finance-adjustment-save" onPress={close} />
          <Pressable testID="finance-adjustment-cancel" onPress={close} />
        </>
      ) : (
        <Text testID="finance-adjustment-closed">closed</Text>
      )}
    </View>
  );
}

function renderShell(props: {
  startEditing: boolean;
  manualAmount: number;
  manualComment: string;
  onConsumed?: () => void;
}) {
  hooks.cursor = 0;
  hooks.effects = [];
  const onConsumed = props.onConsumed ?? vi.fn();
  const element = QuickEditShell({
    startEditing: props.startEditing,
    manualAmount: props.manualAmount,
    manualComment: props.manualComment,
    onConsumed,
  });
  flushEffects();
  // Re-render once so state updates from the effect are visible in the tree.
  hooks.cursor = 0;
  hooks.effects = [];
  const after = QuickEditShell({
    startEditing: props.startEditing,
    manualAmount: props.manualAmount,
    manualComment: props.manualComment,
    onConsumed,
  });
  flushEffects();
  return { tree: nodes(after), onConsumed };
}

beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.effects = [];
});

describe('applyWageQuickEditOpen', () => {
  it('opens once, seeds fields, and consumes the parent flag', () => {
    const seed = vi.fn();
    const setEditing = vi.fn();
    const consume = vi.fn();
    applyWageQuickEditOpen({
      startEditing: true,
      manualAmount: 5,
      manualComment: 'Quick edit proof',
      seed,
      setEditing,
      consume,
    });
    expect(seed).toHaveBeenCalledWith('5', 'Quick edit proof');
    expect(setEditing).toHaveBeenCalledWith(true);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('does nothing when startEditing is false even if manual values changed after save', () => {
    const seed = vi.fn();
    const setEditing = vi.fn();
    const consume = vi.fn();
    applyWageQuickEditOpen({
      startEditing: false,
      manualAmount: 5,
      manualComment: 'Quick edit proof',
      seed,
      setEditing,
      consume,
    });
    expect(seed).not.toHaveBeenCalled();
    expect(setEditing).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });
});

describe('wage quick-edit rendered regression', () => {
  it('opens from startEditing and shows amount/save controls', () => {
    const { tree, onConsumed } = renderShell({
      startEditing: true,
      manualAmount: 12.8,
      manualComment: 'Senas',
    });
    expect(onConsumed).toHaveBeenCalled();
    expect(find(tree, 'finance-adjustment-amount')?.props.value).toBe('12,8');
    expect(find(tree, 'finance-adjustment-comment')?.props.value).toBe('Senas');
    expect(find(tree, 'finance-adjustment-save')).toBeTruthy();
    expect(find(tree, 'finance-adjustment-closed')).toBeUndefined();
  });

  it('after save+consume, reload with new manual values keeps the editor closed', () => {
    // Simulate post-save parent state: flag cleared, saved amount refreshed.
    hooks.values = [false, '5', 'Quick edit proof'];
    const { tree } = renderShell({
      startEditing: false,
      manualAmount: 5,
      manualComment: 'Quick edit proof',
    });
    expect(find(tree, 'finance-adjustment-closed')).toBeTruthy();
    expect(find(tree, 'finance-adjustment-amount')).toBeUndefined();
    expect(find(tree, 'finance-adjustment-save')).toBeUndefined();
  });

  it('can reopen the same day after a prior consume/close', () => {
    hooks.values = [false, '5', 'Quick edit proof'];
    const { tree, onConsumed } = renderShell({
      startEditing: true,
      manualAmount: 5,
      manualComment: 'Quick edit proof',
    });
    expect(find(tree, 'finance-adjustment-amount')?.props.value).toBe('5');
    expect(find(tree, 'finance-adjustment-save')).toBeTruthy();
    expect(onConsumed).toHaveBeenCalled();
  });

  it('does not overwrite in-progress text when startEditing is false during reload', () => {
    hooks.values = [true, 'typed-by-user', 'draft'];
    const { tree } = renderShell({
      startEditing: false,
      manualAmount: 99,
      manualComment: 'from-server',
    });
    expect(find(tree, 'finance-adjustment-amount')?.props.value).toBe('typed-by-user');
    expect(find(tree, 'finance-adjustment-comment')?.props.value).toBe('draft');
  });
});

describe('wages.tsx quick-edit wiring', () => {
  it('consumes quickEditDayKey and no longer reopens from manualAmount/manualComment deps', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/app/finance/wages.tsx'), 'utf8');
    expect(source).toContain('applyWageQuickEditOpen');
    expect(source).toContain('onStartEditingConsumed');
    expect(source).toContain('consumeQuickEdit');
    expect(source).toContain('closeEditor');
    expect(source).not.toContain('}, [startEditing, manualAmount, manualComment]');
    expect(source).toMatch(/\}, \[startEditing, onStartEditingConsumed\]\)/);
  });
});
