import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { TspBrand } from '@/components/tsp-brand';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { BackIcon, HomeIcon } from '@/components/app-icons';
import { colors, spacing } from '@/ui/tokens';

export interface BrandHeaderProps {
  readonly onMenuPress?: () => void;
  readonly showSyncStatus?: boolean;
  readonly showNotifications?: boolean;
  readonly variant?: 'default' | 'driver';
  readonly onBackPress?: () => void;
  readonly onHomePress?: () => void;
}

export function BrandHeader({
  onMenuPress,
  showSyncStatus = true,
  showNotifications = true,
  variant = 'default',
  onBackPress,
  onHomePress,
}: BrandHeaderProps = {}) {
  const driver = variant === 'driver';
  const { width } = useWindowDimensions();
  return (
    <View style={[styles.header, driver && styles.driverHeader]} testID="brand-header">
      {onBackPress ? <Pressable accessibilityLabel="Atgal" accessibilityRole="button" onPress={onBackPress} style={styles.navigationButton} testID="brand-header-back">
        <BackIcon size={22} color={colors.brandNavy} />
        {width >= 620 ? <Text style={styles.navigationText}>Atgal</Text> : null}
      </Pressable> : null}
      <View style={[styles.brandRow, driver && styles.driverBrandRow]}>
        <TspBrand inverse={false} />
      </View>
      {!driver ? <View style={styles.headerActions}>
        {showSyncStatus && width >= 720 ? <CloudSyncStatus compact /> : null}
        {onHomePress ? <Pressable accessibilityLabel="Į pradžią" accessibilityRole="button" onPress={onHomePress} style={styles.navigationButton} testID="brand-header-home">
          <HomeIcon size={21} color={colors.brandNavy} />
          {width >= 620 ? <Text style={styles.navigationText}>Pradžia</Text> : null}
        </Pressable> : null}
        {showNotifications ? <View style={styles.notification}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3V9Z" fill="none" stroke={colors.brandNavy} strokeWidth={1.8} strokeLinejoin="round" />
            <Path d="M10 19h4" stroke={colors.brandNavy} strokeLinecap="round" strokeWidth={1.8} />
          </Svg>
          <View style={styles.notificationDot} />
        </View> : null}
        {onMenuPress ? <Pressable accessibilityLabel="Atidaryti meniu" onPress={onMenuPress} style={styles.profileButton}>
          <Svg width={34} height={34} viewBox="0 0 34 34">
            <Circle cx={17} cy={17} fill={colors.primarySoft} r={16} stroke={colors.border} />
            <Circle cx={17} cy={12} fill={colors.brandNavy} r={5} />
            <Path d="M8 28c1.5-6 5-9 9-9s7.5 3 9 9" fill={colors.brandNavy} />
          </Svg>
        </Pressable> : null}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 3,
    borderTopColor: colors.brandWordmarkGreen,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  driverHeader: { minHeight: 58, paddingVertical: 4, borderTopWidth: 0, justifyContent: 'center' },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, overflow: 'hidden' },
  driverBrandRow: { flex: 0, justifyContent: 'center' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  notification: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 7, right: 3, width: 6, height: 6, borderRadius: 9, backgroundColor: colors.accent },
  profileButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navigationButton: { minWidth: 44, minHeight: 44, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  navigationText: { color: colors.brandNavy, fontWeight: '600' },
});
