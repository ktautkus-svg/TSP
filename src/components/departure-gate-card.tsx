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
  canApprove = false,
  busy = false,
  onRequestApproval,
  onApprove,
}: {
  readiness: DepartureReadiness;
  title?: string;
  canApprove?: boolean;
  busy?: boolean;
  onRequestApproval?: () => void;
  onApprove?: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (readiness.blockers.length === 0 && readiness.warnings.length === 0) return null;
  const blocked = readiness.blockers.length > 0;
  return (
    <View style={[styles.card, blocked ? styles.blocked : styles.warning]} testID="departure-gate-card">
      <Text style={styles.title}>{title ?? (blocked ? 'Važiuoti negalima' : 'Priminimai')}</Text>
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
      {blocked && readiness.overrideStatus === 'pending' ? (
        <Text style={styles.pending} testID="departure-override-pending">
          Laukiama administratoriaus patvirtinimo, kad galima važiuoti.
        </Text>
      ) : null}
      {blocked && canApprove && onApprove ? (
        <Pressable
          disabled={busy}
          onPress={onApprove}
          style={[styles.approveButton, busy && styles.disabled]}
          testID="approve-expired-departure">
          <Text style={styles.approveText}>{busy ? 'Saugoma…' : 'Patvirtinti, kad galima važiuoti'}</Text>
        </Pressable>
      ) : null}
      {blocked && !canApprove && readiness.overrideStatus !== 'pending' && onRequestApproval ? (
        <Pressable
          disabled={busy}
          onPress={onRequestApproval}
          style={[styles.requestButton, busy && styles.disabled]}
          testID="request-expired-departure">
          <Text style={styles.requestText}>{busy ? 'Siunčiama…' : 'Prašyti administratoriaus leidimo važiuoti'}</Text>
        </Pressable>
      ) : null}
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
  pending: { ...type.bodyStrong, color: colors.warning },
  approveButton: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  approveText: { ...type.button, color: colors.textInverse, textAlign: 'center' },
  requestButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  requestText: { ...type.button, color: colors.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.55 },
});
