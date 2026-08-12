import { useMemo, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { ScreenContainer } from './screen-container';

export interface FoundationScreenProps {
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
  readonly showFoundationNotice?: boolean;
  readonly showHeading?: boolean;
  readonly edgeToEdge?: boolean;
  readonly contentMaxWidth?: number;
}

export function FoundationScreen({
  title,
  description,
  children,
  showFoundationNotice = true,
  showHeading = true,
  edgeToEdge = false,
  contentMaxWidth,
}: FoundationScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={[styles.safeArea, edgeToEdge && styles.edgeSafeArea]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScreenContainer maxWidth={contentMaxWidth}>
          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={[styles.content, edgeToEdge && styles.edgeContent]}
            directionalLockEnabled
            horizontal={false}
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={[styles.scroll, edgeToEdge && styles.edgeScroll]}
          >
            {showHeading ? (
              <View style={styles.headingBlock}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.description}>{description}</Text>
              </View>
            ) : null}
            {children}
            {showFoundationNotice ? (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>Paruoštas integracijos taškas</Text>
                <Text style={styles.noticeText}>
                  Ekrano eiga ir duomenų kontraktai suprojektuoti. Funkcinė realizacija numatyta MVP plane.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </ScreenContainer>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  edgeSafeArea: { backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { flex: 1, minWidth: 0, width: '100%' },
  content: {
    flexGrow: 1,
    minWidth: 0,
    width: '100%',
    padding: spacing.lg,
    paddingBottom: 92,
    gap: spacing.lg,
  },
  edgeContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
    backgroundColor: colors.surface,
  },
  edgeScroll: { backgroundColor: colors.surface },
  headingBlock: { gap: 2 },
  title: { ...type.pageTitle, color: colors.text, letterSpacing: -0.3 },
  description: { ...type.body, color: colors.textMuted },
  notice: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  noticeTitle: { ...type.cardTitle, color: colors.text },
  noticeText: { ...type.secondary, color: colors.textMuted, marginTop: spacing.xs },
});
