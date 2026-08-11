import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const labels = {
  synced: 'Sinchronizuota',
  syncing: 'Sinchronizuojama',
  offline: 'Neprisijungta',
  error: 'Sinchronizavimo klaida',
} as const;

const compactLabels = {
  synced: 'Sinchronizuota',
  syncing: 'Siunčiama',
  offline: 'Nėra ryšio',
  error: 'Klaida',
} as const;

export function CloudSyncStatus({ compact = false }: { compact?: boolean }) {
  const { status, error, requestSync } = useRouteCloudSync();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const retryable = status === 'error' || status === 'offline';
  const label = compact ? compactLabels[status] : labels[status];
  const content = (
    <>
      <View style={[styles.dot, styles[`${status}Dot`]]} />
      <Text numberOfLines={1} style={[styles.text, styles[`${status}Text`]]}>{label}</Text>
    </>
  );

  if (retryable) {
    return (
      <Pressable
        accessibilityHint={error ?? 'Bandyti sinchronizuoti dar kartą'}
        accessibilityLabel={`${label}. Bandyti dar kartą`}
        accessibilityRole="button"
        onPress={() => { void requestSync('manual-retry'); }}
        style={[styles.badge, styles[`${status}Badge`]]}
        testID="cloud-sync-status">
        {content}
      </Pressable>
    );
  }

  return <View accessibilityLabel={label} style={[styles.badge, styles[`${status}Badge`]]} testID="cloud-sync-status">{content}</View>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  badge: {
    minHeight: 28,
    maxWidth: 180,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  text: { ...type.meta },
  syncedBadge: { backgroundColor: colors.accentSoft },
  syncedDot: { backgroundColor: colors.success },
  syncedText: { color: colors.success },
  syncingBadge: { backgroundColor: colors.infoSoft },
  syncingDot: { backgroundColor: colors.info },
  syncingText: { color: colors.info },
  offlineBadge: { backgroundColor: colors.warningSoft },
  offlineDot: { backgroundColor: colors.warning },
  offlineText: { color: colors.warning },
  errorBadge: { backgroundColor: colors.dangerSoft },
  errorDot: { backgroundColor: colors.danger },
  errorText: { color: colors.danger },
});
