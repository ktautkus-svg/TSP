import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { layout, radius, spacing, type } from '@/ui/tokens';

export type AppButtonVariant = 'primary' | 'secondary' | 'route' | 'danger' | 'ghost';

type AppButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: AppButtonVariant;
  loading?: boolean;
  leading?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  label,
  variant = 'primary',
  disabled,
  loading,
  leading,
  style,
  ...props
}: AppButtonProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const inactive = Boolean(disabled || loading);
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        styles[`${variant}Button`],
        focused && !inactive && styles.focusedButton,
        pressed && !inactive && styles.pressedButton,
        pressed && !inactive && styles[`${variant}Pressed`],
        inactive && styles.disabledButton,
        style,
      ]}
      {...props}
      onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
      onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}>
      {loading ? <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.text : colors.textInverse} /> : leading}
      <Text style={[styles.buttonText, styles[`${variant}Text`], inactive && styles.disabledText]}>{label}</Text>
    </Pressable>
  );
}

export function AppCard({ children, style, ...props }: Omit<ViewProps, 'style'> & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return <View style={[styles.card, style]} {...props}>{children}</View>;
}

type AppTextFieldProps = TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
};

export function AppTextField({ label, hint, error, style, ...props }: AppTextFieldProps) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.fieldGroup}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textSubtle}
        style={[styles.input, error && styles.inputError, style]}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={[styles.badge, styles[`${tone}Badge`]]}>
      <View style={[styles.badgeDot, styles[`${tone}Dot`]]} />
      <Text style={[styles.badgeText, styles[`${tone}BadgeText`]]}>{label}</Text>
    </View>
  );
}

export function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

export function InlineNotice({ children, tone = 'info' }: { children: ReactNode; tone?: StatusTone }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View accessibilityRole="alert" style={[styles.notice, styles[`${tone}Notice`]]}>
      <View style={[styles.noticeRail, styles[`${tone}Dot`]]} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  button: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pressedButton: { transform: [{ translateY: 1 }, { scale: 0.985 }] },
  focusedButton: { borderColor: colors.info, shadowColor: colors.info, shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
  primaryButton: { backgroundColor: colors.actionPrimary },
  primaryPressed: { backgroundColor: colors.actionPrimaryPressed },
  primaryText: { color: colors.textInverse },
  secondaryButton: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  secondaryPressed: { backgroundColor: colors.surfaceMuted },
  secondaryText: { color: colors.text },
  routeButton: { backgroundColor: colors.actionRoute },
  routePressed: { backgroundColor: colors.actionRoutePressed },
  routeText: { color: colors.textInverse },
  dangerButton: { backgroundColor: colors.danger },
  dangerPressed: { backgroundColor: '#8F2820' },
  dangerText: { color: colors.textInverse },
  ghostButton: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: colors.surfaceMuted },
  ghostText: { color: colors.textSecondary },
  disabledButton: { backgroundColor: colors.disabledSurface, borderColor: colors.disabledSurface },
  buttonText: { ...type.button, textAlign: 'center' },
  disabledText: { color: colors.disabledText },

  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
  },
  fieldGroup: { gap: spacing.xs },
  fieldLabel: { ...type.secondaryStrong, color: colors.textSecondary },
  input: {
    minHeight: layout.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...type.body,
  },
  inputError: { borderColor: colors.danger },
  hintText: { ...type.meta, color: colors.textMuted },
  errorText: { ...type.meta, color: colors.danger },

  badge: {
    minHeight: 28,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeDot: { width: 7, height: 7, borderRadius: radius.pill },
  badgeText: { ...type.secondaryStrong },
  neutralBadge: { backgroundColor: colors.surfaceMuted },
  neutralBadgeText: { color: colors.textSecondary },
  neutralDot: { backgroundColor: colors.textMuted },
  infoBadge: { backgroundColor: colors.infoSoft },
  infoBadgeText: { color: colors.info },
  infoDot: { backgroundColor: colors.info },
  successBadge: { backgroundColor: colors.accentSoft },
  successBadgeText: { color: colors.success },
  successDot: { backgroundColor: colors.success },
  warningBadge: { backgroundColor: colors.warningSoft },
  warningBadgeText: { color: colors.warning },
  warningDot: { backgroundColor: colors.warning },
  dangerBadge: { backgroundColor: colors.dangerSoft },
  dangerBadgeText: { color: colors.danger },
  dangerDot: { backgroundColor: colors.danger },

  sectionHeader: { gap: spacing.xs },
  sectionTitle: { ...type.sectionTitle, color: colors.text },
  sectionDetail: { ...type.secondary, color: colors.textMuted },
  notice: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  noticeRail: { width: 4 },
  noticeText: { ...type.secondary, flex: 1, color: colors.textSecondary, padding: spacing.md },
  neutralNotice: { backgroundColor: colors.surfaceSubtle },
  infoNotice: { backgroundColor: colors.infoSoft },
  successNotice: { backgroundColor: colors.accentSoft },
  warningNotice: { backgroundColor: colors.warningSoft },
  dangerNotice: { backgroundColor: colors.dangerSoft },
});
