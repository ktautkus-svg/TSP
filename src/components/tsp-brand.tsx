import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, fonts, spacing } from '@/ui/tokens';

type TspBrandProps = {
  compact?: boolean;
  hero?: boolean;
  inverse?: boolean;
  descriptor?: string;
};

/**
 * Scalable TSP lock-up for application chrome.
 *
 * The descriptor is deliberately optional: operational headers stay legible
 * at phone sizes instead of shrinking a tagline into unreadable pixels.
 */
export function TspBrand({ compact = false, hero = false, inverse = true, descriptor }: TspBrandProps) {
  const foreground = inverse ? colors.textInverse : colors.brandWordmarkBlue;
  const route = inverse ? colors.brandWordmarkGreenLight : colors.brandWordmarkGreen;
  const width = compact ? 72 : hero ? 176 : 104;
  const height = compact ? 32 : hero ? 78 : 46;

  return (
    <View accessibilityLabel={descriptor ? `TSP – ${descriptor}` : 'TSP'} style={[styles.lockup, hero && styles.heroLockup]}>
      <Svg height={height} viewBox="0 0 124 52" width={width}>
        {/* A deliberately simple vector wordmark: crisp at header and sign-in sizes,
            transparent by construction, and independent from raster logo padding. */}
        <Path d="M3 6h36l-5 9H24v31H13V15H3Z" fill={foreground} />
        <Path
          d="M43 6h36l-5 9H56c-3 0-4 1-4 3 0 1 1 2 2 4l13 3c10 2 14 7 12 14-2 6-7 9-17 9H36l5-9h20c3 0 4-1 4-3 0-1-1-2-4-3l-13-3c-10-2-14-8-11-15 1-4 3-7 6-9Z"
          fill={route}
        />
        <Path
          d="M81 6h22c13 0 19 7 19 18 0 10-7 17-19 17H92v7H81Zm11 9v17h10c6 0 9-3 9-8s-3-9-9-9Z"
          fill={foreground}
          fillRule="evenodd"
        />
        <Path d="M47 14h7v2h-7Zm9 0h7v2h-7Zm9 0h7v2h-7Z" fill={foreground} opacity={0.78} />
      </Svg>
      {!compact && descriptor ? <Text numberOfLines={1} style={[styles.descriptor, { color: foreground }]}>{descriptor}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroLockup: { flexDirection: 'column', gap: spacing.xs },
  descriptor: { maxWidth: 220, fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 13, letterSpacing: 0.55, opacity: 0.75 },
});
