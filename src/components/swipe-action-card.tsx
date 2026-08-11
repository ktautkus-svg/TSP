import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewProps,
} from 'react-native';

import { useTheme, type ColorPalette } from '@/ui/theme';

const MIN_THRESHOLD = 88;

export function SwipeActionCard(props: ViewProps & {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;
  const width = useRef(320);
  const [reduceMotion, setReduceMotion] = useState(false);
  const threshold = () => Math.min(132, Math.max(MIN_THRESHOLD, width.current * 0.3));

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const reset = () => Animated.spring(translateX, {
    toValue: 0,
    damping: 19,
    stiffness: 230,
    mass: 0.7,
    useNativeDriver: true,
  }).start();

  const confirm = (direction: -1 | 1) => {
    const callback = direction > 0 ? props.onSwipeRight : props.onSwipeLeft;
    Animated.timing(translateX, {
      toValue: direction * Math.max(width.current, 240),
      duration: reduceMotion ? 0 : 150,
      useNativeDriver: true,
    }).start(() => {
      callback?.();
      translateX.setValue(0);
    });
  };

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      !props.disabled && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderGrant: () => translateX.stopAnimation(),
    onPanResponderMove: (_, gesture) => {
      const resistance = Math.abs(gesture.dx) > width.current * 0.75 ? 0.72 : 1;
      translateX.setValue(gesture.dx * resistance);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx >= threshold() && props.onSwipeRight) confirm(1);
      else if (gesture.dx <= -threshold() && props.onSwipeLeft) confirm(-1);
      else reset();
    },
    onPanResponderTerminate: reset,
  }), [props.disabled, props.onSwipeLeft, props.onSwipeRight, reduceMotion]);

  const rightOpacity = translateX.interpolate({ inputRange: [0, MIN_THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const leftOpacity = translateX.interpolate({ inputRange: [-MIN_THRESHOLD, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const onLayout = (event: LayoutChangeEvent) => {
    width.current = event.nativeEvent.layout.width;
    props.onLayout?.(event);
  };
  const { onSwipeLeft: _left, onSwipeRight: _right, disabled: _disabled, style, children, ...viewProps } = props;

  return (
    <View {...viewProps} onLayout={onLayout} style={[styles.shell, style]}>
      <Animated.View pointerEvents="none" style={[styles.action, styles.deliveredAction, { opacity: rightOpacity }]}>
        <Text style={styles.actionIcon}>✓</Text><Text style={styles.actionText}>PRIDUOTA</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.action, styles.failedAction, { opacity: leftOpacity }]}>
        <Text style={styles.actionText}>NEPRIDUOTA</Text><Text style={styles.actionIcon}>×</Text>
      </Animated.View>
      <Animated.View
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
  movingCard: { flex: 1, gap: 8, padding: 16, backgroundColor: colors.surface },
  action: { position: 'absolute', inset: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  deliveredAction: { backgroundColor: colors.success },
  failedAction: { backgroundColor: colors.danger },
  actionText: { color: colors.textInverse, fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.8 },
  actionIcon: { color: colors.textInverse, fontSize: 28, lineHeight: 32, fontWeight: '700' },
  });
}
