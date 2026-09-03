import Svg, { Circle, Path } from 'react-native-svg';

import { colors as designColors } from '@/ui/tokens';

export type SteeringWheelIconProps = {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
};

/** Steering wheel — used for "Vykdyti vairuotojo maršrutą" (distinct from Vairuotojai). */
export function SteeringWheelIcon({
  size = 22,
  color = designColors.info,
  strokeWidth = 1.8,
}: SteeringWheelIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Circle cx={12} cy={12} fill="none" r={9} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx={12} cy={12} fill="none" r={2.2} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M12 9.8V5.2M10.2 13.2 5.8 16.2M13.8 13.2l4.4 3"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}
