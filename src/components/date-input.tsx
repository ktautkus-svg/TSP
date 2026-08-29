import { forwardRef, useEffect, useRef } from 'react';
import { Platform, TextInput, type TextInput as TextInputInstance, type TextInputProps } from 'react-native';

/**
 * A YYYY-MM-DD text field that opens the browser's native calendar picker on
 * web. react-native-web's TextInput always resets its DOM `type` attribute
 * from `keyboardType`/`inputMode` (there is no RN equivalent of type="date"),
 * so passing `type: 'date'` as a raw prop is silently discarded on every
 * render — it never reaches the DOM. Forcing the attribute imperatively via
 * the underlying host node is the only way to get the real picker.
 *
 * This reasserts on every render, not just mount: a value-driven re-render
 * (the controlled `value` prop changing, e.g. switching between quality
 * control's Diena/Savaitė/Mėnuo period tabs without remounting the field)
 * can make react-native-web resync its own DOM attributes and silently
 * revert `type` back to "text" — which showed up as this field falling back
 * to a plain keyboard instead of the calendar picker.
 */
export const DateInput = forwardRef<TextInputInstance, TextInputProps>((props, forwardedRef) => {
  const innerRef = useRef<TextInputInstance>(null);

  const ensureWebDateInput = () => {
    if (Platform.OS !== 'web') return null;
    const node = innerRef.current as unknown as HTMLInputElement | null;
    if (node && node.type !== 'date') node.type = 'date';
    return node;
  };

  useEffect(() => {
    ensureWebDateInput();
  });

  return <TextInput
    placeholder="YYYY-MM-DD"
    ref={(node) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
    {...props}
    onFocus={(event) => {
      props.onFocus?.(event);
      const node = ensureWebDateInput();
      // iPad/Safari with a connected keyboard can focus a date input without
      // opening its calendar. `showPicker` keeps the interaction calendar-led
      // where the browser supports it; normal native behaviour remains the
      // fallback everywhere else.
      try { node?.showPicker?.(); } catch { /* Browser declined programmatic picker; native tap still works. */ }
    }}
  />;
});
DateInput.displayName = 'DateInput';
