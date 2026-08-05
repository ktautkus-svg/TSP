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

import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { ScreenContainer } from './screen-container';

type FoundationScreenProps = {
  title: string;
  description: string;
  children?: ReactNode;
  showFoundationNotice?: boolean;
};

export function FoundationScreen({
  title,
  description,
  children,
  showFoundationNotice = true,
}: FoundationScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScreenContainer>
          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.description}>{description}</Text>
            </View>
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
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: 64,
    gap: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  description: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: spacing.sm,
  },
  notice: {
    padding: spacing.lg,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
  },
  noticeTitle: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  noticeText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
});
