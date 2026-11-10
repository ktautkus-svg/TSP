import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';

export type ManualOrderItem = { id: string; label: string; address: string; weightKg: number | null };

const ROW_HEIGHT = 82;

// Mobile browsers claim vertical gestures for scrolling before JavaScript sees
// them, which silently kills dragging inside the surrounding ScrollView. Opting
// the handle out of native panning is what makes the drag reach PanResponder.
const dragHandleTouchTarget = Platform.OS === 'web'
  ? ({ touchAction: 'none' } as unknown as ViewStyle)
  : null;

// Auto-scroll while dragging near the top/bottom edge of the visible area.
// Without it a stop could only be dragged as far as the screen showed, and the
// row vanished off-screen with nothing scrolling after it.
const AUTO_SCROLL_EDGE_PX = 90;
const AUTO_SCROLL_MAX_SPEED_PX = 18;

type ScrollHost = {
  get: () => number;
  scrollBy: (delta: number) => void;
  visibleTop: () => number;
  visibleBottom: () => number;
};

function findWebScrollHost(node: unknown): ScrollHost | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  let element = node as HTMLElement | null;
  while (element && element !== document.body) {
    const style = window.getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
      const host = element;
      return {
        get: () => host.scrollTop,
        scrollBy: (delta) => { host.scrollTop += delta; },
        visibleTop: () => Math.max(0, host.getBoundingClientRect().top),
        visibleBottom: () => Math.min(window.innerHeight, host.getBoundingClientRect().bottom),
      };
    }
    element = element.parentElement;
  }
  const root = document.scrollingElement ?? document.documentElement;
  return {
    get: () => root.scrollTop,
    scrollBy: (delta) => { root.scrollTop += delta; },
    visibleTop: () => 0,
    visibleBottom: () => window.innerHeight,
  };
}

export function ManualRouteOrderList(props: {
  items: ManualOrderItem[];
  priorityIds: ReadonlySet<string>;
  onTogglePriority: (id: string) => void;
  onMove: (id: string, targetIndex: number) => void;
  showPriority?: boolean;
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
          showPriority={props.showPriority !== false}
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
  showPriority: boolean;
  onTogglePriority: (id: string) => void;
  onMove: (id: string, targetIndex: number) => void;
}) {
  const { colors } = useTheme();
  const [dragging, setDragging] = useState(false);
  const translateY = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const handleRef = useRef<View>(null);
  const scrollHost = useRef<ScrollHost | null>(null);
  const scrollStart = useRef(0);
  const gestureDy = useRef(0);
  const pointerClientY = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  // Total vertical travel = finger movement + how far the page scrolled under it.
  const effectiveDy = () =>
    gestureDy.current + (scrollHost.current ? scrollHost.current.get() - scrollStart.current : 0);

  const stopAutoScroll = () => {
    if (frame.current !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  const autoScrollTick = () => {
    frame.current = null;
    const host = scrollHost.current;
    const y = pointerClientY.current;
    if (!draggingRef.current || !host || y === null) return;
    const top = host.visibleTop();
    const bottom = host.visibleBottom();
    let speed = 0;
    if (y < top + AUTO_SCROLL_EDGE_PX) speed = -AUTO_SCROLL_MAX_SPEED_PX * Math.min(1, (top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX);
    else if (y > bottom - AUTO_SCROLL_EDGE_PX) speed = AUTO_SCROLL_MAX_SPEED_PX * Math.min(1, (y - (bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX);
    if (speed !== 0) {
      const before = host.get();
      host.scrollBy(speed);
      if (host.get() !== before) translateY.setValue(effectiveDy());
    }
    frame.current = requestAnimationFrame(autoScrollTick);
  };

  useEffect(() => () => stopAutoScroll(), []);

  const panResponder = useMemo(() => PanResponder.create({
    // Capture variants win the gesture before the parent ScrollView can start
    // scrolling, which is the difference between a working and a dead handle.
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      setDragging(true);
      scrollHost.current = findWebScrollHost(handleRef.current);
      scrollStart.current = scrollHost.current?.get() ?? 0;
      gestureDy.current = 0;
      pointerClientY.current = null;
      if (scrollHost.current && typeof requestAnimationFrame !== 'undefined') {
        frame.current = requestAnimationFrame(autoScrollTick);
      }
    },
    onPanResponderMove: (event, gesture) => {
      gestureDy.current = gesture.dy;
      const pageY = event.nativeEvent.pageY;
      pointerClientY.current = Platform.OS === 'web' && typeof window !== 'undefined'
        ? pageY - window.scrollY
        : pageY;
      translateY.setValue(effectiveDy());
    },
    onPanResponderRelease: (_event, gesture) => {
      gestureDy.current = gesture.dy;
      const travelled = effectiveDy();
      stopAutoScroll();
      draggingRef.current = false;
      setDragging(false);
      const { index, count, item, onMove } = latest.current;
      const offset = Math.round(travelled / ROW_HEIGHT);
      const target = Math.max(0, Math.min(count - 1, index + offset));
      translateY.setValue(0);
      if (target !== index) onMove(item.id, target);
    },
    onPanResponderTerminate: () => {
      stopAutoScroll();
      draggingRef.current = false;
      setDragging(false);
      translateY.setValue(0);
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick/stop helpers only read refs
  }), [translateY]);

  const [positionText, setPositionText] = useState(String(props.index + 1));
  useEffect(() => setPositionText(String(props.index + 1)), [props.index]);
  const commitPosition = () => {
    const wanted = Number.parseInt(positionText.trim(), 10);
    if (!Number.isFinite(wanted)) {
      setPositionText(String(props.index + 1));
      return;
    }
    const target = Math.max(0, Math.min(props.count - 1, wanted - 1));
    setPositionText(String(target + 1));
    if (target !== props.index) props.onMove(props.item.id, target);
  };

  const move = (delta: -1 | 1) => {
    const target = props.index + delta;
    if (target < 0 || target >= props.count) return;
    props.onMove(props.item.id, target);
  };

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
        dragging && { borderColor: colors.info, backgroundColor: colors.infoSoft },
      ]}>
      {props.showPriority ? <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: props.priority }}
        onPress={() => props.onTogglePriority(props.item.id)}
        style={[styles.priority, { borderColor: colors.primary }, props.priority && { backgroundColor: colors.primary }]}
        testID={`manual-priority-${props.item.id}`}>
        <Text style={{ color: props.priority ? '#fff' : colors.primary, fontWeight: '900' }}>{props.priority ? '★' : '☆'}</Text>
      </Pressable> : null}
      <View style={styles.textBlock}>
        <View style={styles.titleRow}>
          <TextInput
            accessibilityLabel="Pozicija maršrute – įrašykite numerį ir spauskite Enter"
            value={positionText}
            onChangeText={(text) => setPositionText(text.replace(/[^0-9]/g, ''))}
            onSubmitEditing={commitPosition}
            onBlur={commitPosition}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            maxLength={3}
            style={[styles.positionInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
            testID={`manual-position-${props.item.id}`}
          />
          <Text numberOfLines={1} style={[styles.label, styles.labelText, { color: colors.text }]}>{props.item.label}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text numberOfLines={2} style={[styles.address, { color: colors.textMuted }]}>{props.item.address}</Text>
          {props.item.weightKg !== null ? <Text style={[styles.weight, { color: colors.textMuted }]}>{Math.round(props.item.weightKg)} kg</Text> : null}
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
        ref={handleRef}
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
  priority: { width: 40, height: 40, borderWidth: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  textBlock: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  label: { fontWeight: '800', lineHeight: 19 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  labelText: { flex: 1, minWidth: 0 },
  positionInput: {
    width: 46,
    height: 32,
    borderWidth: 1,
    borderRadius: 7,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 15,
    paddingVertical: 0,
    paddingHorizontal: 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 2 },
  address: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16 },
  weight: { flexShrink: 0, fontSize: 12, lineHeight: 16 },
  stepperColumn: { gap: 3, paddingVertical: 4 },
  stepper: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  stepperDisabled: { opacity: 0.3 },
  stepperText: { fontSize: 12, fontWeight: '900' },
  dragHandle: {
    width: 56,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderTopRightRadius: 11,
    borderBottomRightRadius: 11,
  },
  dragText: { fontSize: 28, fontWeight: '900' },
});
