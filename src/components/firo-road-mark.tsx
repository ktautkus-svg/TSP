import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/ui/tokens';

export interface FiroRoadMarkProps {
  readonly size?: number;
}

/**
 * Standalone FiRo road icon — curved road with dashed center line.
 * Always rendered as its own tile; never fused into the FiRo letterforms.
 */
export function FiroRoadMark({ size = 56 }: Readonly<FiroRoadMarkProps>) {
  return (
    <Svg
      accessibilityLabel="FiRo kelias"
      height={size}
      role="img"
      viewBox="0 0 128 128"
      width={size}>
      <Rect fill={colors.brandNavy} height={128} rx={28} ry={28} width={128} />
      <Path
        d="M14 98C34 78 48 62 58 48C70 32 84 20 108 12L118 28C96 36 84 46 74 60C64 74 52 88 34 106Z"
        fill={colors.brandBurgundy}
      />
      <Path
        d="M28 94C44 78 56 64 64 52C74 38 86 28 104 22L110 34C94 40 84 48 76 60C68 72 58 84 44 98Z"
        fill={colors.brandNavy}
      />
      <Path
        d="M40 90C54 74 66 58 78 44C88 32 98 24 112 18"
        fill="none"
        stroke={colors.textInverse}
        strokeDasharray="11 9"
        strokeLinecap="butt"
        strokeWidth={5}
      />
    </Svg>
  );
}
