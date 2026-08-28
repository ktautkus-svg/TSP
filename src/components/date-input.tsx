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

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = innerRef.current as unknown as HTMLInputElement | null;
    if (node && node.type !== 'date') node.type = 'date';
  });

  return <TextInput
    placeholder="YYYY-MM-DD"
    ref={(node) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
    {...props}
  />;
});
DateInput.displayName = 'DateInput';
