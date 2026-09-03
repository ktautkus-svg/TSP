import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '@/ui/tokens';

export interface FiroWordmarkSvgProps {
  readonly height?: number;
  /** Light-on-dark variant for login / dark surfaces. */
  readonly inverse?: boolean;
}

const VIEW_W = 360;
const VIEW_H = 100;
const ASPECT = VIEW_W / VIEW_H;

/**
 * Clean FiRo letterforms matching the approved valdymo centro hero direction:
 * F navy with red bottom bar, i red, R navy with red crossbar, o navy.
 * Pair with {@link FiroRoadMark} as a separate tile — never fuse the road into F.
 *
 * Letters are built from simple solid shapes so counters stay open at all scales.
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
      {/* F — stem + top bar + mid bar + red bottom accent */}
      <Rect fill={navy} height={72} width={22} x={6} y={6} />
      <Rect fill={navy} height={16} width={70} x={6} y={6} />
      <Rect fill={navy} height={14} width={54} x={6} y={36} />
      <Rect fill={accent} height={12} rx={2} width={62} x={6} y={84} />

      {/* i — red stem + red dot */}
      <Circle cx={108} cy={14} fill={accent} r={9} />
      <Rect fill={accent} height={58} rx={3} width={16} x={100} y={32} />

      {/* R — stem */}
      <Rect fill={navy} height={86} width={22} x={140} y={6} />
      {/* R — bowl (outer then cut with white/background via overlapping? use path with evenodd) */}
      <Path
        d="M162 6 H214 A36 36 0 0 1 214 78 H162 Z M184 26 H210 A16 16 0 0 1 210 58 H184 Z"
        fill={navy}
        fillRule="evenodd"
      />
      {/* R — leg */}
      <Path d="M188 70 L236 92 L214 92 L170 70 Z" fill={navy} />
      {/* R — red crossbar */}
      <Rect fill={accent} height={12} rx={2} width={58} x={162} y={42} />

      {/* o — ring via evenodd circle pair */}
      <Path
        d="M292 28 A34 34 0 1 1 292 96 A34 34 0 1 1 292 28 Z M292 46 A16 16 0 1 0 292 78 A16 16 0 1 0 292 46 Z"
        fill={navy}
        fillRule="evenodd"
      />
    </Svg>
  );
}

export const FIRO_WORDMARK_ASPECT = ASPECT;
