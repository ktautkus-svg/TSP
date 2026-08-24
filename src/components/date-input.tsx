import { forwardRef, useEffect, useRef } from 'react';
import { Platform, TextInput, type TextInput as TextInputInstance, type TextInputProps } from 'react-native';

/**
 * A YYYY-MM-DD text field that opens the browser's native calendar picker on
 * web. react-native-web's TextInput always resets its DOM `type` attribute
 * from `keyboardType`/`inputMode` (there is no RN equivalent of type="date"),
 * so passing `type: 'date'` as a raw prop is silently discarded on every
 * render — it never reaches the DOM. Forcing the attribute imperatively via
 * the underlying host node after mount is the only way to get the real
 * picker; React never touches that attribute again since its own computed
 * value for it stays `undefined` across re-renders.
 */
export const DateInput = forwardRef<TextInputInstance, TextInputProps>((props, forwardedRef) => {
  const innerRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = innerRef.current as unknown as HTMLInputElement | null;
    if (node) node.type = 'date';
  }, []);

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
