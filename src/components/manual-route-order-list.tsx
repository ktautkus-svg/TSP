import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';

export type ManualOrderItem = { id: string; label: string; weightKg: number | null };

export function ManualRouteOrderList(props: {
  items: ManualOrderItem[];
  priorityIds: ReadonlySet<string>;
  onTogglePriority: (id: string) => void;
  onMove: (id: string, targetIndex: number) => void;
}) {
  return (
    <View style={styles.list} testID="manual-drag-list">
      {props.items.map((item, index) => (
        <DraggableRow
          key={item.id}
          item={item}
          index={index}
          count={props.items.length}
          priority={props.priorityIds.has(item.id)}
          onTogglePriority={props.onTogglePriority}
          onMove={props.onMove}
        />
      ))}
    </View>
  );
}

function DraggableRow(props: {
  item: ManualOrderItem;
  index: number;
  count: number;
  priority: boolean;
  onTogglePriority: (id: string) => void;
  onMove: (id: string, targetIndex: number) => void;
}) {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderMove: (_event, gesture) => translateY.setValue(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      const offset = Math.round(gesture.dy / 62);
      const target = Math.max(0, Math.min(props.count - 1, props.index + offset));
      translateY.setValue(0);
      if (target !== props.index) props.onMove(props.item.id, target);
    },
    onPanResponderTerminate: () => translateY.setValue(0),
  }), [props, translateY]);
  return (
    <Animated.View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface, transform: [{ translateY }] }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.priority }}
        onPress={() => props.onTogglePriority(props.item.id)}
        style={[styles.priority, { borderColor: colors.primary }, props.priority && { backgroundColor: colors.primary }]}
        testID={`manual-priority-${props.item.id}`}>
        <Text style={{ color: props.priority ? '#fff' : colors.primary, fontWeight: '900' }}>{props.priority ? '★' : '☆'}</Text>
      </Pressable>
      <View style={styles.textBlock}>
        <Text numberOfLines={2} style={[styles.label, { color: colors.text }]}>{props.index + 1}. {props.item.label}</Text>
        {props.item.weightKg !== null ? <Text style={[styles.meta, { color: colors.textMuted }]}>{Math.round(props.item.weightKg)} kg</Text> : null}
      </View>
      <View accessibilityLabel="Tempti ir keisti vietą" style={styles.dragHandle} {...panResponder.panHandlers}>
        <Text style={[styles.dragText, { color: colors.textMuted }]}>☰</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { minHeight: 58, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.sm, zIndex: 1 },
  priority: { width: 40, height: 40, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  textBlock: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  label: { fontWeight: '800', lineHeight: 19 },
  meta: { fontSize: 12, marginTop: 2 },
  dragHandle: {
    width: 52,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragText: { fontSize: 24, fontWeight: '900' },
});
