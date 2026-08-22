import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import type { DepartureReadiness } from '@/domain/departure-readiness';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export function DepartureGateCard({
  readiness,
  title,
}: {
  readiness: DepartureReadiness;
  title?: string;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (readiness.blockers.length === 0 && readiness.warnings.length === 0) return null;
  return (
    <View style={[styles.card, readiness.blockers.length > 0 ? styles.blocked : styles.warning]} testID="departure-gate-card">
      <Text style={styles.title}>{title ?? (readiness.blockers.length > 0 ? 'Važiuoti negalima' : 'Priminimai')}</Text>
      {readiness.blockers.map((issue) => (
        <Pressable
          accessibilityRole={issue.href ? 'link' : 'text'}
          key={`${issue.code}-${issue.message}`}
          onPress={issue.href ? () => router.push(issue.href as Href) : undefined}
          style={styles.row}>
          <Text style={styles.blocker}>{issue.message}</Text>
        </Pressable>
      ))}
      {readiness.warnings.map((issue) => (
        <Text key={`${issue.code}-${issue.message}`} style={styles.warningText}>{issue.message}</Text>
      ))}
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm },
  blocked: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  title: { ...type.cardTitle, color: colors.text },
  row: { minHeight: 44, justifyContent: 'center' },
  blocker: { ...type.bodyStrong, color: colors.danger },
  warningText: { ...type.body, color: colors.warning },
});
