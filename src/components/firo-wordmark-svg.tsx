import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '@/ui/tokens';

export interface FiroWordmarkSvgProps {
  readonly height?: number;
  /** Light-on-dark variant for login / dark surfaces. */
  readonly inverse?: boolean;
}

const VIEW_W = 340;
const VIEW_H = 96;
const ASPECT = VIEW_W / VIEW_H;

/**
 * Clean FiRo letterforms matching the approved valdymo centro hero direction:
 * F navy with red bottom bar, i red, R navy with red crossbar, o navy.
 * Pair with {@link FiroRoadMark} as a separate tile — never fuse the road into F.
 */
export function FiroWordmarkSvg({ height = 44, inverse = false }: Readonly<FiroWordmarkSvgProps>) {
  const width = Math.round(height * ASPECT);
  const navy = inverse ? colors.textInverse : colors.brandNavy;
  const accent = inverse ? colors.brandBurgundyLight : colors.brandBurgundy;

  return (
    <Svg
      accessibilityLabel="FiRo"
      height={height}
      role="img"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={width}>
      {/* F — navy body */}
      <Path d="M4 6h66v16H28v12h36v16H28v18H4z" fill={navy} />
      {/* F — red bottom bar */}
      <Rect fill={accent} height={11} rx={2} width={58} x={4} y={80} />

      {/* i — fully red */}
      <Circle cx={104} cy={14} fill={accent} r={9} />
      <Rect fill={accent} height={58} rx={3} width={16} x={96} y={32} />

      {/* R — navy body with open counter */}
      <Path
        d="M132 6h58c26 0 44 15 44 40 0 18-11 32-30 37l32 13h-26l-34-13h-18v13h-26V6zm26 18v30h30c12 0 22-7 22-15s-10-15-22-15H158z"
        fill={navy}
        fillRule="evenodd"
      />
      {/* R — red crossbar */}
      <Rect fill={accent} height={11} rx={2} width={52} x={158} y={42} />

      {/* o — navy ring */}
      <Path
        d="M268 30c32 0 54 15 54 34s-22 34-54 34-54-15-54-34 22-34 54-34zm0 16c-16 0-28 7-28 18s12 18 28 18 28-7 28-18-12-18-28-18z"
        fill={navy}
        fillRule="evenodd"
      />
    </Svg>
  );
}

export const FIRO_WORDMARK_ASPECT = ASPECT;
