import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { BackIcon } from '@/components/app-icons';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { FiroBrand } from '@/components/firo-brand';
import { colors, fonts, spacing } from '@/ui/tokens';

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
  showNotifications = false,
  variant = 'default',
  onBackPress,
  onHomePress,
}: BrandHeaderProps = {}) {
  const driver = variant === 'driver';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { profile } = useLocalAccess();
  const profileInitials = profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('lt-LT'))
    .join('') || 'FR';
  const goHome = () => (onHomePress ? onHomePress() : router.push('/' as Href));
  return (
    <View style={[styles.header, driver && styles.driverHeader]} testID="brand-header">
      <View style={styles.sideSlot}>
        {onBackPress ? (
          <Pressable
            accessibilityLabel="Atgal"
            accessibilityRole="button"
            onPress={onBackPress}
            style={styles.navigationButton}
            testID="brand-header-back">
            <BackIcon size={26} color={colors.brandNavy} />
            <Text style={styles.navigationText}>Atgal</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel="Į pradžią"
        accessibilityRole="button"
        onPress={goHome}
        style={[styles.brandCenter, driver && styles.driverBrandCenter]}
        testID="brand-header-logo">
        <FiroBrand compact />
      </Pressable>
      <View style={[styles.sideSlot, styles.sideSlotEnd]}>
        {!driver ? (
          <View style={styles.headerActions}>
            {showSyncStatus && width >= 720 && !onBackPress ? <CloudSyncStatus compact /> : null}
            {showNotifications ? (
              <View style={styles.notification}>
                <Svg width={22} height={22} viewBox="0 0 24 24">
                  <Path d="M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3V9Z" fill="none" stroke={colors.brandNavy} strokeWidth={1.8} strokeLinejoin="round" />
                  <Path d="M10 19h4" stroke={colors.brandNavy} strokeLinecap="round" strokeWidth={1.8} />
                </Svg>
                <View style={styles.notificationDot} />
              </View>
            ) : null}
            {onMenuPress ? (
              <Pressable
                accessibilityLabel={`Atidaryti ${profile.displayName} profilį`}
                accessibilityRole="button"
                onPress={onMenuPress}
                style={styles.profileButton}
                testID="brand-header-profile">
                <View style={styles.profileAvatar}>
                  <Text numberOfLines={1} style={styles.profileInitials}>{profileInitials}</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    minHeight: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 3,
    borderTopColor: colors.brandBurgundy,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    overflow: 'visible',
  },
  driverHeader: { minHeight: 58, paddingVertical: 4, borderTopWidth: 0 },
  // Equal flex side slots keep the logo visually centred between navigation and profile actions.
  sideSlot: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideSlotEnd: { justifyContent: 'flex-end' },
  brandCenter: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    // Keep the wide landscape badge fully visible — never clip the FR border.
    overflow: 'visible',
  },
  driverBrandCenter: { flex: 0 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  notification: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 7, right: 3, width: 6, height: 6, borderRadius: 9, backgroundColor: colors.accent },
  profileButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.brandBurgundy,
    backgroundColor: colors.brandNavy,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brandNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  profileInitials: { color: colors.textInverse, fontFamily: fonts.heading, fontSize: 13, letterSpacing: 0.5 },
  navigationButton: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  navigationText: { color: colors.brandNavy, fontWeight: '700', fontSize: 15 },
});
