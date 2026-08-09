import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { spacing } from '@/ui/tokens';

export function BrandHeader({ onMenuPress }: { onMenuPress?: () => void } = {}) {
  return (
    <View style={styles.header} testID="brand-header">
      <View style={styles.brandRow}>
        <View style={styles.logoContainer}>
          <Svg accessibilityLabel="TSP – Tikslus siuntų pristatymas" width={40} height={30} viewBox="0 0 40 30">
            <Path d="M2 3h36l-6 6H8Z" fill="#FFFFFF" />
            <Path d="M8.5 11.5h23l-6 6h-11Z" fill="#FFFFFF" />
            <Path d="M15 20h10l-5 7Z" fill="#86C440" />
          </Svg>
        </View>
        <View style={styles.brandText}>
          <Text style={styles.brandName}>TSP</Text>
          <Text numberOfLines={1} style={styles.brandSubtitle}>TIKSLUS SIUNTŲ PRISTATYMAS</Text>
        </View>
      </View>
      <View style={styles.headerActions}>
        <View style={styles.notification}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3V9Z" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinejoin="round" />
            <Path d="M10 19h4" stroke="#FFFFFF" strokeLinecap="round" strokeWidth={1.8} />
          </Svg>
          <View style={styles.notificationDot} />
        </View>
        <Pressable accessibilityLabel="Atidaryti meniu" onPress={onMenuPress} style={styles.profileButton}>
          <Svg width={34} height={34} viewBox="0 0 34 34">
            <Circle cx={17} cy={17} fill="#E9EFE9" r={16} stroke="rgba(255,255,255,0.65)" />
            <Circle cx={17} cy={12} fill="#31523D" r={5} />
            <Path d="M8 28c1.5-6 5-9 9-9s7.5 3 9 9" fill="#31523D" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: '#072D1B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, overflow: 'hidden', gap: 8 },
  logoContainer: {
    width: 44,
    height: 34,
    maxWidth: 44,
    maxHeight: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandText: { minWidth: 0, justifyContent: 'center' },
  brandName: { color: '#FFFFFF', fontSize: 25, lineHeight: 27, fontWeight: '900', letterSpacing: 0.4 },
  brandSubtitle: { color: '#EAF2EC', fontSize: 7, lineHeight: 9, fontWeight: '800', letterSpacing: 0.55 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  notification: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 7, right: 3, width: 6, height: 6, borderRadius: 9, backgroundColor: '#87C442' },
  profileButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
