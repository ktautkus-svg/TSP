import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/ui/tokens';

export interface FiroBrandProps {
  readonly compact?: boolean;
  readonly hero?: boolean;
  readonly inverse?: boolean;
  readonly descriptor?: string;
}

const wordmarkSource = require('../../assets/brand/firo-wordmark-color.png') as {
  readonly uri: string;
};
const inverseWordmarkSource = require('../../assets/brand/firo-wordmark-inverse.png') as {
  readonly uri: string;
};

/**
 * Approved wide FR / FIRO landscape badge (assets/brand/firo-wordmark-*.png,
 * generated from firo-approved-source.png). The compact header variant is
 * intentionally a touch wider so it fills the navigation gap confidently.
 */
const BADGE_ASPECT = 720 / 454;
const COMPACT_WIDTH_SCALE = 1.14;

function badgeSize(kind: 'compact' | 'default' | 'hero'): { width: number; height: number } {
  // Compact header: tall enough for the border + FIRO caption to stay legible,
  // wide enough to read as a landscape badge between the header actions.
  if (kind === 'compact') {
    const height = 46;
    return { width: Math.round(height * BADGE_ASPECT * COMPACT_WIDTH_SCALE), height };
  }
  const height = kind === 'hero' ? 128 : 60;
  return { width: Math.round(height * BADGE_ASPECT), height };
}

/** Shared FiRo lock-up for headers, authentication and compact navigation. */
export function FiroBrand({ compact = false, hero = false, inverse = false, descriptor }: Readonly<FiroBrandProps>) {
  const foreground = inverse ? colors.textInverse : colors.brandNavy;
  const kind = compact ? 'compact' : hero ? 'hero' : 'default';
  const { width, height } = badgeSize(kind);
  const source = inverse ? inverseWordmarkSource : wordmarkSource;

  return (
    <View accessibilityLabel={descriptor ? `FiRo – ${descriptor}` : 'FiRo'} style={[styles.lockup, hero && styles.heroLockup]}>
      {Platform.OS === 'web'
        ? <img alt="FiRo" src={source.uri} style={{ display: 'block', height, objectFit: compact ? 'fill' : 'contain', width, backgroundColor: 'transparent' }} />
        : <Image accessibilityLabel="FiRo" resizeMode={compact ? 'stretch' : 'contain'} source={source} style={{ width, height, backgroundColor: 'transparent' }} />}
      {!compact && descriptor ? <Text numberOfLines={1} style={[styles.descriptor, { color: foreground }]}>{descriptor}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, overflow: 'visible' },
  heroLockup: { flexDirection: 'column', gap: spacing.xs },
  descriptor: { maxWidth: 220, fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 13, letterSpacing: 0.55, opacity: 0.78 },
});
