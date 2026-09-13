import { forwardRef, useEffect, useRef } from 'react';
import { Platform, TextInput, type TextInput as TextInputInstance, type TextInputProps } from 'react-native';

/**
 * An HH:MM text field that opens the browser's native time picker on web.
 * Same DOM-type-forcing trick as DateInput — see that file for why a plain
 * `type: 'time'` prop is silently discarded by react-native-web, and why the
 * attribute must be reasserted on every render (not only on mount).
 */
export const TimeInput = forwardRef<TextInputInstance, TextInputProps>((props, forwardedRef) => {
  const innerRef = useRef<TextInputInstance>(null);

  const ensureWebTimeInput = () => {
    if (Platform.OS !== 'web') return null;
    const node = innerRef.current as unknown as HTMLInputElement | null;
    if (node && node.type !== 'time') node.type = 'time';
    return node;
  };

  useEffect(() => {
    ensureWebTimeInput();
  });

  return <TextInput
    placeholder="HH:MM"
    ref={(node) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
    {...props}
    onFocus={(event) => {
      props.onFocus?.(event);
      const node = ensureWebTimeInput();
      try { node?.showPicker?.(); } catch { /* Browser declined programmatic picker; native tap still works. */ }
    }}
  />;
});
TimeInput.displayName = 'TimeInput';
