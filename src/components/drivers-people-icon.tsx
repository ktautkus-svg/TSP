import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors as designColors } from '@/ui/tokens';

export type DriversPeopleIconProps = {
  readonly size?: number;
  readonly color?: string;
};

/**
 * Clear people / users glyph for Vairuotojai.
 * One large filled person + a smaller companion — readable as people, not eyes.
 */
export function DriversPeopleIcon({
  size = 22,
  color = designColors.brandNavy,
}: DriversPeopleIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {/* Primary person — large head + torso */}
      <Circle cx={8.5} cy={6.8} fill={color} r={3.4} />
      <Path d="M2.6 20c.5-4.6 3.4-7 5.9-7s5.4 2.4 5.9 7Z" fill={color} />
      {/* Secondary person — smaller, offset */}
      <Circle cx={17.4} cy={8.2} fill={color} r={2.6} />
      <Rect fill={color} height={7.2} rx={2.4} width={7.2} x={13.8} y={12.8} />
    </Svg>
  );
}
