import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { FiroRoadMark } from '@/components/firo-road-mark';
import { FiroWordmarkSvg } from '@/components/firo-wordmark-svg';
import { colors, fonts, radius, spacing, type } from '@/ui/tokens';

export interface AdminHomeHeroProps {
  readonly online?: boolean;
  readonly onAvatarPress?: () => void;
}

const HERO_GRADIENT_START = '#E8F2FF';
const HERO_GRADIENT_END = '#FFE8F0';
const HERO_GRADIENT_CSS = `linear-gradient(180deg, ${HERO_GRADIENT_START} 0%, ${HERO_GRADIENT_END} 100%)`;

/**
 * Valdymo centro hero: soft blue→pink gradient, separate road-mark tile +
 * FiRo SVG wordmark with a clear gap, and "Valdymo centras" subtitle.
 * Matches the approved hero-ref direction — no Fibonacci tagline, no fused road-into-F.
 */
export function AdminHomeHero({ online = true, onAvatarPress }: Readonly<AdminHomeHeroProps>) {
  const [size, setSize] = useState({ width: 390, height: 200 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
      setSize({ width, height });
    }
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.hero, Platform.OS === 'web' ? styles.heroWeb : null]}
      testID="admin-home-hero">
      {Platform.OS !== 'web' ? (
        <Svg height={size.height} pointerEvents="none" style={StyleSheet.absoluteFill} width={size.width}>
          <Defs>
            <LinearGradient id="adminHeroGradient" x1="0" x2="0" y1="0" y2="1">
              <Stop offset="0" stopColor={HERO_GRADIENT_START} />
              <Stop offset="1" stopColor={HERO_GRADIENT_END} />
            </LinearGradient>
          </Defs>
          <Rect fill="url(#adminHeroGradient)" height={size.height} width={size.width} x={0} y={0} />
        </Svg>
      ) : null}

      <View style={styles.topRow}>
        <View style={styles.topSpacer} />
        <Pressable
          accessibilityLabel="Paskyros meniu"
          accessibilityRole="button"
          onPress={onAvatarPress}
          style={styles.avatarButton}
          testID="admin-home-avatar">
          <Svg height={40} viewBox="0 0 40 40" width={40}>
            <Circle cx={20} cy={20} fill={colors.surface} r={19} stroke={colors.border} strokeWidth={1} />
            <Circle cx={20} cy={15} fill={colors.brandNavy} r={6} />
            <Path d="M8 34c2-7 6.5-10.5 12-10.5S30 27 32 34" fill={colors.brandNavy} />
          </Svg>
          <View
            accessibilityLabel={online ? 'Prisijungta' : 'Neprisijungta'}
            style={[styles.statusDot, online ? styles.statusOnline : styles.statusOffline]}
            testID="admin-home-sync-dot"
          />
        </Pressable>
      </View>

      <View style={styles.lockupBlock}>
        <View style={styles.lockupRow} testID="admin-home-lockup">
          <View style={styles.roadTile} testID="admin-home-road-mark">
            <FiroRoadMark size={56} />
          </View>
          <View style={styles.lockupGap} />
          <View testID="admin-home-wordmark">
            <FiroWordmarkSvg height={50} />
          </View>
        </View>
        <Text style={styles.subtitle}>Valdymo centras</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    overflow: 'hidden',
    backgroundColor: HERO_GRADIENT_START,
  },
  heroWeb: Platform.OS === 'web'
    ? ({ backgroundImage: HERO_GRADIENT_CSS } as Record<string, string>)
    : {},
  topRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: spacing.md,
  },
  topSpacer: { flex: 1 },
  avatarButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    position: 'absolute',
    right: 4,
    bottom: 6,
    width: 11,
    height: 11,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  statusOnline: { backgroundColor: colors.success },
  statusOffline: { backgroundColor: colors.textSubtle },
  lockupBlock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  lockupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  roadTile: {
    // Navy road mark sits on a light rounded tile so it stays visually separate
    // from the FiRo wordmark (never fused into F).
    padding: 3,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...Platform.select({
      web: { boxShadow: '0 3px 10px rgba(21, 23, 76, 0.10)' },
      default: {
        shadowColor: colors.brandNavy,
        shadowOpacity: 0.1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      },
    }),
  },
  lockupGap: {
    width: spacing.lg,
  },
  subtitle: {
    ...type.body,
    fontFamily: fonts.bodyMedium,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
