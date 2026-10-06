import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewProps,
} from 'react-native';

import { useTheme, type ColorPalette } from '@/ui/theme';
import { pulseHaptic } from '@/ui/haptics';
import {
  resistedOffset,
  resolveSwipeEnd,
  swipeAxisLock,
  swipeThreshold,
  type SwipeDirection,
} from '@/components/swipe-gesture';

type SwipeHandler = () => void | Promise<void>;

export function SwipeActionCard(props: ViewProps & {
  onSwipeRight?: SwipeHandler;
  onSwipeLeft?: SwipeHandler;
  rightActionLabel?: string;
  leftActionLabel?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;
  const width = useRef(320);
  const trackedDx = useRef(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const horizontalLock = useRef(false);
  const committed = useRef(false);
  const suppressClick = useRef(false);
  const mounted = useRef(true);
  const cardRef = useRef<View>(null);
  const handlersRef = useRef(props);
  handlersRef.current = props;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [armedDirection, setArmedDirection] = useState<SwipeDirection | 0>(0);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    mounted.current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  const reset = useCallback(() => {
    trackedDx.current = 0;
    setArmedDirection(0);
    setCommitting(false);
    Animated.spring(translateX, {
      toValue: 0,
      damping: 19,
      stiffness: 230,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const applyTracked = useCallback((dx: number) => {
    const current = handlersRef.current;
    const allowedDx = dx > 0 && !current.onSwipeRight ? 0 : dx < 0 && !current.onSwipeLeft ? 0 : dx;
    trackedDx.current = allowedDx;
    const visual = resistedOffset(allowedDx, width.current);
    translateX.setValue(visual);
    const limit = swipeThreshold(width.current);
    const nextArmed: SwipeDirection | 0 = allowedDx >= limit && current.onSwipeRight
      ? 1
      : allowedDx <= -limit && current.onSwipeLeft
        ? -1
        : 0;
    setArmedDirection((currentArmed) => currentArmed === nextArmed ? currentArmed : nextArmed);
  }, [translateX]);

  const finishFromTrackedOffset = useCallback((reason: 'up' | 'cancel' | 'terminate') => {
    horizontalLock.current = false;
    startX.current = null;
    startY.current = null;
    if (committed.current) return;
    if (Math.abs(trackedDx.current) > 8) suppressClick.current = true;
    const decision = resolveSwipeEnd({
      trackedDx: trackedDx.current,
      width: width.current,
      canSwipeRight: Boolean(handlersRef.current.onSwipeRight) && !handlersRef.current.disabled,
      canSwipeLeft: Boolean(handlersRef.current.onSwipeLeft) && !handlersRef.current.disabled,
      reason,
    });
    if (decision.type === 'cancel') {
      reset();
      return;
    }
    committed.current = true;
    setCommitting(true);
    setArmedDirection(decision.direction);
    pulseHaptic('commit');
    const callback = decision.direction > 0 ? handlersRef.current.onSwipeRight : handlersRef.current.onSwipeLeft;
    Animated.timing(translateX, {
      toValue: decision.direction * Math.max(width.current, 240),
      duration: reduceMotion ? 0 : 160,
      useNativeDriver: true,
    }).start();
    void Promise.resolve()
      .then(() => callback?.())
      .then(() => {
        // Hold the committed offset until the mutation settles so the card
        // cannot spring back to the pre-action position. If the row stays
        // mounted (status update in place), settle only after that update.
        if (!mounted.current) return;
        trackedDx.current = 0;
        setArmedDirection(0);
        setCommitting(false);
        committed.current = false;
        Animated.timing(translateX, {
          toValue: 0,
          duration: reduceMotion ? 0 : 140,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => {
        committed.current = false;
        if (mounted.current) reset();
      });
  }, [reduceMotion, reset, translateX]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => {
      const current = handlersRef.current;
      return !current.disabled
        && (gesture.dx > 0 ? Boolean(current.onSwipeRight) : Boolean(current.onSwipeLeft))
        && Math.abs(gesture.dx) > 8
        && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const current = handlersRef.current;
      return !current.disabled
        && (gesture.dx > 0 ? Boolean(current.onSwipeRight) : Boolean(current.onSwipeLeft))
        && Math.abs(gesture.dx) > 8
        && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      translateX.stopAnimation();
      committed.current = false;
    },
    onPanResponderMove: (_, gesture) => {
      horizontalLock.current = true;
      applyTracked(gesture.dx);
    },
    onPanResponderRelease: () => finishFromTrackedOffset('up'),
    onPanResponderTerminate: () => finishFromTrackedOffset('terminate'),
  }), [applyTracked, finishFromTrackedOffset, translateX]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const node = cardRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return undefined;
    node.style.touchAction = 'pan-y';
    node.style.userSelect = 'none';

    const activePointer = { current: -1 };

    const onDown = (event: PointerEvent) => {
      if (handlersRef.current.disabled || committed.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      startX.current = event.clientX;
      startY.current = event.clientY;
      horizontalLock.current = false;
      activePointer.current = event.pointerId;
    };
    const onMove = (event: PointerEvent) => {
      if (startX.current == null || startY.current == null || activePointer.current !== event.pointerId) return;
      const dx = event.clientX - startX.current;
      const dy = event.clientY - startY.current;
      if (!horizontalLock.current) {
        const lock = swipeAxisLock(dx, dy);
        if (lock === 'vertical') {
          startX.current = null;
          startY.current = null;
          activePointer.current = -1;
          return;
        }
        if (lock !== 'horizontal') return;
        horizontalLock.current = true;
        translateX.stopAnimation();
        node.style.touchAction = 'none';
        if (typeof node.setPointerCapture === 'function') {
          try { node.setPointerCapture(event.pointerId); } catch { /* already captured or unsupported */ }
        }
      }
      if (event.cancelable) event.preventDefault();
      applyTracked(dx);
    };
    const end = (event: PointerEvent, reason: 'up' | 'cancel') => {
      if (activePointer.current !== event.pointerId && !horizontalLock.current) return;
      activePointer.current = -1;
      node.style.touchAction = 'pan-y';
      if (typeof node.releasePointerCapture === 'function' && node.hasPointerCapture?.(event.pointerId)) {
        try { node.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      }
      if (!horizontalLock.current && startX.current == null) return;
      finishFromTrackedOffset(reason);
    };
    const onUp = (event: PointerEvent) => end(event, 'up');
    const onCancel = (event: PointerEvent) => end(event, 'cancel');
    const onClick = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onCancel);
    node.addEventListener('click', onClick, true);
    return () => {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('click', onClick, true);
    };
  }, [applyTracked, finishFromTrackedOffset, translateX]);

  const rightOpacity = translateX.interpolate({ inputRange: [0, 56], outputRange: [0, 1], extrapolate: 'clamp' });
  const leftOpacity = translateX.interpolate({ inputRange: [-56, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const onLayout = (event: LayoutChangeEvent) => {
    width.current = event.nativeEvent.layout.width;
    props.onLayout?.(event);
  };
  const { onSwipeLeft: _left, onSwipeRight: _right, disabled: _disabled, style, children, ...viewProps } = props;
  const rightLabel = armedDirection === 1 ? 'ATLEISTI' : props.rightActionLabel ?? 'PRIDUOTA';
  const leftLabel = armedDirection === -1 ? 'ATLEISTI' : props.leftActionLabel ?? 'NEPRIDUOTA';

  return (
    <View {...viewProps} onLayout={onLayout} style={[styles.shell, style]}>
      <Animated.View pointerEvents="none" style={[styles.action, styles.deliveredAction, armedDirection === 1 && styles.armedAction, { opacity: rightOpacity }]}>
        <Text style={[styles.actionIcon, armedDirection === 1 && styles.armedIcon]}>{committing ? '…' : '✓'}</Text>
        <Text style={styles.actionText}>{rightLabel}</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.action, styles.failedAction, armedDirection === -1 && styles.armedAction, { opacity: leftOpacity }]}>
        <Text style={styles.actionText}>{leftLabel}</Text>
        <Text style={[styles.actionIcon, armedDirection === -1 && styles.armedIcon]}>{committing ? '…' : '×'}</Text>
      </Animated.View>
      <Animated.View
        ref={cardRef}
        {...responder.panHandlers}
        style={[styles.movingCard, { transform: [{ translateX }] }]}
        testID="swipe-moving-card">
        {children}
      </Animated.View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    shell: { position: 'relative', overflow: 'hidden', padding: 0 },
    movingCard: {
      flex: 1,
      gap: 8,
      padding: 16,
      backgroundColor: colors.surface,
    },
    action: { position: 'absolute', inset: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
    deliveredAction: { backgroundColor: colors.success },
    failedAction: { backgroundColor: colors.danger },
    armedAction: { paddingHorizontal: 16 },
    actionText: { color: colors.textInverse, fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.8 },
    actionIcon: { color: colors.textInverse, fontSize: 28, lineHeight: 32, fontWeight: '700' },
    armedIcon: { fontSize: 34, lineHeight: 36 },
  });
}
