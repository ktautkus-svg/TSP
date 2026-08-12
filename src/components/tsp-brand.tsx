import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/ui/tokens';

export interface TspBrandProps {
  readonly compact?: boolean;
  readonly hero?: boolean;
  readonly inverse?: boolean;
  readonly descriptor?: string;
}

const wordmarkSource = require('../../assets/brand/tsp-wordmark-red-blue.png') as {
  readonly uri: string;
};

/**
 * Scalable TSP lock-up for application chrome.
 *
 * The descriptor is deliberately optional: operational headers stay legible
 * at phone sizes instead of shrinking a tagline into unreadable pixels.
 */
export function TspBrand({ compact = false, hero = false, inverse = true, descriptor }: TspBrandProps) {
  const foreground = inverse ? colors.textInverse : colors.brandWordmarkBlue;
  const width = compact ? 76 : hero ? 206 : 112;
  const height = compact ? 32 : hero ? 86 : 47;

  return (
    <View accessibilityLabel={descriptor ? `TSP – ${descriptor}` : 'TSP'} style={[styles.lockup, hero && styles.heroLockup]}>
      {Platform.OS === 'web'
        ? <img alt="TSP" src={wordmarkSource.uri} style={{ display: 'block', height, objectFit: 'contain', width }} />
        : <Image accessibilityLabel="TSP" resizeMode="contain" source={wordmarkSource} style={{ width, height }} />}
      {!compact && descriptor ? <Text numberOfLines={1} style={[styles.descriptor, { color: foreground }]}>{descriptor}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroLockup: { flexDirection: 'column', gap: spacing.xs },
  descriptor: { maxWidth: 220, fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 13, letterSpacing: 0.55, opacity: 0.75 },
});
