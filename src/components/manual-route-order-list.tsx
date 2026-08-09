import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';

export type ManualOrderItem = { id: string; label: string; weightKg: number | null };

const ROW_HEIGHT = 62;

// Mobile browsers claim vertical gestures for scrolling before JavaScript sees
// them, which silently kills dragging inside the surrounding ScrollView. Opting
// the handle out of native panning is what makes the drag reach PanResponder.
const dragHandleTouchTarget = Platform.OS === 'web'
  ? ({ touchAction: 'none' } as unknown as ViewStyle)
  : null;

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
  const dragging = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const panResponder = useMemo(() => PanResponder.create({
    // Capture variants win the gesture before the parent ScrollView can start
    // scrolling, which is the difference between a working and a dead handle.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { dragging.current = true; },
    onPanResponderMove: (_event, gesture) => translateY.setValue(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      dragging.current = false;
      const { index, count, item, onMove } = latest.current;
      const offset = Math.round(gesture.dy / ROW_HEIGHT);
      const target = Math.max(0, Math.min(count - 1, index + offset));
      translateY.setValue(0);
      if (target !== index) onMove(item.id, target);
    },
    onPanResponderTerminate: () => {
      dragging.current = false;
      translateY.setValue(0);
    },
  }), [translateY]);

  const move = (delta: -1 | 1) => {
    const target = props.index + delta;
    if (target < 0 || target >= props.count) return;
    props.onMove(props.item.id, target);
  };

  return (
    <Animated.View
      style={[
        styles.row,
        { borderColor: colors.border, backgroundColor: colors.surface, transform: [{ translateY }] },
      ]}>
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
      <View style={styles.stepperColumn}>
        <Pressable
          accessibilityLabel="Perkelti aukštyn"
          disabled={props.index === 0}
          onPress={() => move(-1)}
          style={[styles.stepper, { borderColor: colors.border }, props.index === 0 && styles.stepperDisabled]}
          testID={`manual-move-up-${props.item.id}`}>
          <Text style={[styles.stepperText, { color: colors.text }]}>▲</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Perkelti žemyn"
          disabled={props.index === props.count - 1}
          onPress={() => move(1)}
          style={[styles.stepper, { borderColor: colors.border }, props.index === props.count - 1 && styles.stepperDisabled]}
          testID={`manual-move-down-${props.item.id}`}>
          <Text style={[styles.stepperText, { color: colors.text }]}>▼</Text>
        </Pressable>
      </View>
      <View
        accessibilityLabel="Tempti ir keisti vietą"
        style={[styles.dragHandle, dragHandleTouchTarget]}
        testID={`manual-drag-handle-${props.item.id}`}
        {...panResponder.panHandlers}>
        <Text style={[styles.dragText, { color: colors.textMuted }]}>☰</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { minHeight: ROW_HEIGHT, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.sm, zIndex: 1 },
  priority: { width: 40, height: 40, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  textBlock: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  label: { fontWeight: '800', lineHeight: 19 },
  meta: { fontSize: 12, marginTop: 2 },
  stepperColumn: { gap: 3, paddingVertical: 4 },
  stepper: { width: 40, height: 26, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  stepperDisabled: { opacity: 0.3 },
  stepperText: { fontSize: 12, fontWeight: '900' },
  dragHandle: {
    width: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragText: { fontSize: 24, fontWeight: '900' },
});
