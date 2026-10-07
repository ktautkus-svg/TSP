import { useEffect, useMemo } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export type FinanceConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busyLabel?: string;
  retryLabel?: string;
  /** When true, confirm/retry are disabled and busy label is shown. */
  busy?: boolean;
  /** Inline error keeps the dialog open so the user can retry without reopening. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry?: () => void;
  testID?: string;
};

/**
 * Cross-platform confirm dialog for finance destructive actions.
 * Uses an in-app Modal on every platform so web is never stuck on
 * react-native-web's no-op Alert.alert(). Busy / error / retry stay inside
 * the same sheet instead of dismissing before the API call finishes.
 */
export function FinanceConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Pašalinti',
  cancelLabel = 'Atšaukti',
  busyLabel = 'Šalinama…',
  retryLabel = 'Bandyti dar kartą',
  busy = false,
  error = null,
  onCancel,
  onConfirm,
  onRetry,
  testID = 'finance-confirm-dialog',
}: FinanceConfirmDialogProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const showRetry = Boolean(error) && !busy;

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const timer = setTimeout(() => {
      const target = document.querySelector(`[data-testid="${testID}-cancel"]`) as HTMLElement | null;
      target?.focus?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, error, busy, testID]);

  if (!visible) return null;

  return (
    <Modal animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }} transparent visible={visible}>
      <View style={styles.backdrop} testID={testID}>
        <View accessibilityRole="summary" style={styles.sheet} testID={`${testID}-sheet`}>
          <Text style={styles.title} testID={`${testID}-title`}>{title}</Text>
          <Text style={styles.message} testID={`${testID}-message`}>{message}</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error} testID={`${testID}-error`}>{error}</Text> : null}
          <View style={styles.actions}>
            {showRetry ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => { (onRetry ?? onConfirm)(); }}
                style={({ pressed }) => [styles.button, styles.destructiveButton, pressed && styles.pressed]}
                testID={`${testID}-retry`}>
                <Text style={styles.destructiveText}>{retryLabel}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onConfirm}
                style={({ pressed }) => [styles.button, styles.destructiveButton, (busy || pressed) && styles.pressed, busy && styles.disabled]}
                testID={`${testID}-confirm`}>
                <Text style={styles.destructiveText}>{busy ? busyLabel : confirmLabel}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onCancel}
              style={({ pressed }) => [styles.button, styles.cancelButton, (busy || pressed) && styles.pressed, busy && styles.disabled]}
              testID={`${testID}-cancel`}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
  },
  title: { ...type.sectionTitle, color: colors.text },
  message: { ...type.body, color: colors.textSecondary },
  error: { ...type.secondary, color: colors.danger, marginTop: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  cancelButton: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  cancelText: { ...type.button, color: colors.text },
  destructiveButton: { backgroundColor: colors.danger },
  destructiveText: { ...type.button, color: colors.textInverse },
  pressed: { opacity: 0.86 },
  disabled: { opacity: 0.55 },
});
