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
const markSource = require('../../assets/brand/firo-mark-color.png') as {
  readonly uri: string;
};
const inverseMarkSource = require('../../assets/brand/firo-mark-inverse.png') as {
  readonly uri: string;
};

/** Full wordmark aspect (badge + FIRO caption). */
const BADGE_ASPECT = 720 / 454;
/** Wider landscape mark for compact headers — more elongated, no cramped caption. */
const COMPACT_MARK_ASPECT = 720 / 343;

function badgeSize(kind: 'compact' | 'default' | 'hero'): { width: number; height: number } {
  if (kind === 'compact') {
    const height = 40;
    return { width: Math.round(height * COMPACT_MARK_ASPECT), height };
  }
  // Hero is the login lock-up; default is the larger non-header wordmark.
  const height = kind === 'hero' ? 128 : 60;
  return { width: Math.round(height * BADGE_ASPECT), height };
}

/** Shared FiRo lock-up for headers, authentication and compact navigation. */
export function FiroBrand({ compact = false, hero = false, inverse = false, descriptor }: Readonly<FiroBrandProps>) {
  const foreground = inverse ? colors.textInverse : colors.brandNavy;
  const kind = compact ? 'compact' : hero ? 'hero' : 'default';
  const { width, height } = badgeSize(kind);
  const source = compact
    ? (inverse ? inverseMarkSource : markSource)
    : (inverse ? inverseWordmarkSource : wordmarkSource);

  return (
    <View accessibilityLabel={descriptor ? `FiRo – ${descriptor}` : 'FiRo'} style={[styles.lockup, hero && styles.heroLockup]}>
      {Platform.OS === 'web'
        ? <img alt="FiRo" src={source.uri} style={{ display: 'block', height, objectFit: 'contain', width }} />
        : <Image accessibilityLabel="FiRo" resizeMode="contain" source={source} style={{ width, height }} />}
      {!compact && descriptor ? <Text numberOfLines={1} style={[styles.descriptor, { color: foreground }]}>{descriptor}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroLockup: { flexDirection: 'column', gap: spacing.xs },
  descriptor: { maxWidth: 220, fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 13, letterSpacing: 0.55, opacity: 0.78 },
});
