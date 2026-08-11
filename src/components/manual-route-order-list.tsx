import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';

export type ManualOrderItem = {
  id: string;
  label: string;
  address?: string | null;
  recipient?: string | null;
  weightKg: number | null;
  timeWindowLabel?: string | null;
  priority: boolean;
};

const ROW_HEIGHT = 96;

// Mobile browsers claim vertical gestures for scrolling before JavaScript sees
// them, which silently kills dragging inside the surrounding ScrollView. Opting
// the handle out of native panning is what makes the drag reach PanResponder.
const dragHandleTouchTarget = Platform.OS === 'web'
  ? ({ touchAction: 'none' } as unknown as ViewStyle)
  : null;

export function ManualRouteOrderList(props: {
  items: ManualOrderItem[];
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
  onTogglePriority: (id: string) => void;
  onMove: (id: string, targetIndex: number) => void;
}) {
  const { colors } = useTheme();
  const [dragging, setDragging] = useState(false);
  const translateY = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  const panResponder = useMemo(() => PanResponder.create({
    // Capture variants win the gesture before the parent ScrollView can start
    // scrolling, which is the difference between a working and a dead handle.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      setDragging(true);
    },
    onPanResponderMove: (_event, gesture) => translateY.setValue(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      draggingRef.current = false;
      setDragging(false);
      const { index, count, item, onMove } = latest.current;
      const offset = Math.round(gesture.dy / ROW_HEIGHT);
      const target = Math.max(0, Math.min(count - 1, index + offset));
      translateY.setValue(0);
      if (target !== index) onMove(item.id, target);
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false;
      setDragging(false);
      translateY.setValue(0);
    },
  }), [translateY]);

  const move = (delta: -1 | 1) => {
    const target = props.index + delta;
    if (target < 0 || target >= props.count) return;
    props.onMove(props.item.id, target);
  };

  const title = props.item.recipient?.trim() || props.item.label;
  const address = props.item.address?.trim() || null;
  const showAddress = Boolean(address && address !== title);

  return (
    <Animated.View
      style={[
        styles.row,
        {
          borderColor: colors.border,
          backgroundColor: colors.surface,
          transform: [{ translateY }],
          zIndex: dragging ? 100 : 1,
          elevation: dragging ? 12 : 1,
          shadowOpacity: dragging ? 0.28 : 0,
        },
        dragging && styles.rowDragging,
      ]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.item.priority }}
        onPress={() => props.onTogglePriority(props.item.id)}
        style={[styles.priority, { borderColor: colors.primary }, props.item.priority && { backgroundColor: colors.primary }]}
        testID={`manual-priority-${props.item.id}`}>
        <Text style={{ color: props.item.priority ? '#fff' : colors.primary, fontWeight: '700' }}>{props.item.priority ? '★' : '☆'}</Text>
      </Pressable>
      <View style={styles.sequenceBadge}>
        <Text style={[styles.sequenceText, { color: colors.text }]}>{props.index + 1}</Text>
      </View>
      <View style={styles.textBlock}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>{title}</Text>
        {showAddress ? (
          <Text numberOfLines={2} style={[styles.address, { color: colors.textSecondary }]}>{address}</Text>
        ) : null}
        <View style={styles.metaRow}>
          {props.item.weightKg !== null ? (
            <Text style={[styles.meta, { color: colors.textMuted }]}>{Math.round(props.item.weightKg)} kg</Text>
          ) : (
            <Text style={[styles.meta, { color: colors.textMuted }]}>Svoris —</Text>
          )}
          {props.item.timeWindowLabel ? (
            <Text style={[styles.meta, { color: colors.textMuted }]}>{props.item.timeWindowLabel}</Text>
          ) : null}
          {props.item.priority ? (
            <Text style={[styles.meta, { color: colors.primary }]}>Prioritetas</Text>
          ) : null}
        </View>
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
        style={[styles.dragHandle, { borderLeftColor: colors.border, backgroundColor: dragging ? colors.primarySoft : colors.background }, dragHandleTouchTarget]}
        testID={`manual-drag-handle-${props.item.id}`}
        {...panResponder.panHandlers}>
        <Text style={[styles.dragText, { color: colors.primary }]}>☰</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs, overflow: 'visible' },
  row: {
    minHeight: ROW_HEIGHT,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.sm,
    zIndex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
  },
  rowDragging: {
    borderColor: '#0A5A31',
    backgroundColor: '#F4FFF6',
  },
  priority: { width: 40, height: 40, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sequenceBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  sequenceText: { ...type.label, fontWeight: '700' },
  textBlock: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 2 },
  label: { ...type.bodyStrong, lineHeight: 20 },
  address: { ...type.secondary, lineHeight: 18 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  meta: { ...type.meta },
  stepperColumn: { gap: 3, paddingVertical: 4 },
  stepper: { width: 40, height: 26, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  stepperDisabled: { opacity: 0.3 },
  stepperText: { fontSize: 12, fontWeight: '700' },
  dragHandle: {
    width: 56,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderTopRightRadius: 11,
    borderBottomRightRadius: 11,
  },
  dragText: { fontSize: 28, fontWeight: '700' },
});
