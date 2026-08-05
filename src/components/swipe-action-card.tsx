import { useMemo } from 'react';
import { PanResponder, View, type ViewProps } from 'react-native';

export function SwipeActionCard(props: ViewProps & {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  disabled?: boolean;
}) {
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      !props.disabled && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx >= 80) props.onSwipeRight?.();
      if (gesture.dx <= -80) props.onSwipeLeft?.();
    },
  }), [props.disabled, props.onSwipeLeft, props.onSwipeRight]);
  const { onSwipeLeft: _left, onSwipeRight: _right, disabled: _disabled, ...viewProps } = props;
  return <View {...viewProps} {...responder.panHandlers} />;
}
