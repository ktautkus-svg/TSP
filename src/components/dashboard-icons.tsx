import Svg, { Circle, Line, Path } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

/** Compass-style navigation arrow, replacing the flag glyph on the "Navigate" button. */
export function NavigateIcon({ size = 26, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9.5} stroke={color} strokeWidth={1.6} fill="none" opacity={0.55} />
      <Path d="M12 4 L15.2 12 L12 20 L8.8 12 Z" fill={color} />
      <Path d="M12 4 L15.2 12 L12 12 Z" fill={color} opacity={0.6} />
    </Svg>
  );
}

/** Bold checkmark, replacing the ✓ glyph on the "Delivered" button. */
export function DeliveredIcon({ size = 26, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12.5 L10 17.5 L19 6.5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Bold cross, replacing the ⊘ glyph on the "Failed" button. */
export function FailedIcon({ size = 26, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth={3} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Map pin, replacing the ↗ glyph on the "distance to next stop" tile. */
export function DistanceIcon({ size = 20, color = '#0A5A31' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 21s-6.5-6.02-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.98-6.5 11-6.5 11Z"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.4} fill={color} />
    </Svg>
  );
}

/** Clock face, replacing the ⏱ glyph on the "time to next stop" tile. */
export function ClockIcon({ size = 20, color = '#0A5A31' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} fill="none" />
      <Line x1={12} y1={12} x2={12} y2={7.2} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={12} y1={12} x2={15.4} y2={13.8} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
