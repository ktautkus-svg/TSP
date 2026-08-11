import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { fonts, spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';

type TspBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  descriptor?: string;
};

/**
 * Scalable TSP lock-up for application chrome.
 *
 * The descriptor is deliberately optional: operational headers stay legible
 * at phone sizes instead of shrinking a tagline into unreadable pixels.
 */
export function TspBrand({ compact = false, inverse = true, descriptor }: TspBrandProps) {
  const { colors } = useTheme();
  const foreground = inverse ? '#FFFFFF' : colors.text;
  const middle = inverse ? '#79ADD0' : colors.info;
  const destination = inverse ? '#59B884' : colors.success;

  return (
    <View accessibilityLabel={descriptor ? `TSP – ${descriptor}` : 'TSP'} style={styles.lockup}>
      <Svg height={compact ? 30 : 38} viewBox="0 0 64 48" width={compact ? 40 : 50}>
        <Path d="M4 6h54L48 16H14Z" fill={foreground} />
        <Path d="M14 20h34L38 30H24Z" fill={middle} />
        <Path d="M24 34h14l-7 8Z" fill={destination} />
      </Svg>
      {!compact ? (
        <View style={styles.wordmark}>
          <Text style={[styles.name, { color: foreground }]}>TSP</Text>
          {descriptor ? <Text numberOfLines={1} style={[styles.descriptor, { color: foreground }]}>{descriptor}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wordmark: { minWidth: 0, justifyContent: 'center' },
  name: { fontFamily: fonts.heading, fontSize: 25, lineHeight: 27, letterSpacing: 0.4 },
  descriptor: { maxWidth: 220, fontFamily: fonts.bodyMedium, fontSize: 9, lineHeight: 11, letterSpacing: 0.45, opacity: 0.75 },
});
