import { useEffect, useState } from 'react';
import { Alert as RNAlert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, spacing, type } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
};

let nextId = 1;
let currentRequest: AlertRequest | null = null;
const listeners = new Set<(request: AlertRequest | null) => void>();

function publish(request: AlertRequest | null): void {
  currentRequest = request;
  listeners.forEach((listener) => listener(request));
}

/**
 * window.alert()/confirm() are unreliable on the web: react-native-web's
 * Alert.alert() is a total no-op, and even a raw window.confirm() silently
 * does nothing (no dialog, no error) when this app runs as an installed
 * standalone PWA (app.json sets display: "standalone") — there is no browser
 * chrome for the OS to anchor a native dialog to. So on web this renders its
 * own in-app Modal instead of touching any native dialog API at all.
 */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    if (Platform.OS === 'web') {
      const resolvedButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'Gerai' }];
      publish({ id: nextId++, title, message, buttons: resolvedButtons });
    } else {
      RNAlert.alert(title, message, buttons);
    }
  },
};

/** Mount once near the app root (inside ThemeProvider) so Alert.alert() has somewhere to render on web. */
export function AlertHost() {
  const { colors } = useTheme();
  const [request, setRequest] = useState<AlertRequest | null>(currentRequest);

  useEffect(() => {
    listeners.add(setRequest);
    return () => { listeners.delete(setRequest); };
  }, []);

  if (Platform.OS !== 'web' || !request) return null;

  const dismiss = (button?: AlertButton) => {
    publish(null);
    button?.onPress?.();
  };

  const styles = createStyles(colors);

  return (
    <Modal animationType="fade" transparent visible onRequestClose={() => dismiss()}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="alert-host-sheet">
          <Text style={styles.title}>{request.title}</Text>
          {request.message ? <Text style={styles.message}>{request.message}</Text> : null}
          <View style={styles.actions}>
            {request.buttons.map((button, index) => (
              <Pressable
                key={`${button.text ?? 'button'}-${index}`}
                accessibilityRole="button"
                style={[
                  styles.button,
                  button.style === 'destructive' && styles.destructiveButton,
                  button.style === 'cancel' && styles.cancelButton,
                ]}
                onPress={() => dismiss(button)}>
                <Text
                  style={[
                    styles.buttonText,
                    button.style === 'destructive' && styles.destructiveText,
                    button.style === 'cancel' && styles.cancelText,
                  ]}>
                  {button.text ?? 'Gerai'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  sheet: { width: '100%', maxWidth: 420, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surfaceElevated },
  title: { ...type.sectionTitle, color: colors.text },
  message: { ...type.body, color: colors.textSecondary },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.actionPrimary },
  buttonText: { ...type.button, color: colors.textInverse },
  cancelButton: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text },
  destructiveButton: { backgroundColor: colors.danger },
  destructiveText: { color: colors.textInverse },
});
