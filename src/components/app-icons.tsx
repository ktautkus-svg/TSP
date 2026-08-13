import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { colors as designColors } from '@/ui/tokens';

/**
 * Shared line-icon set. Everything is drawn on a 24x24 grid with a consistent
 * 1.8 stroke and round joins, so icons sit together without one looking heavier
 * than the next. Filled shapes are avoided except where a solid dot reads
 * better than an outline at small sizes.
 */
export type IconProps = { size?: number; color?: string; strokeWidth?: number };

const BASE_STROKE = 1.8;

export function ExcelIcon({ size = 24, color = designColors.success, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M14 3v5h5" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M9.2 11.6l5.6 6M14.8 11.6l-5.6 6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function PdfIcon({ size = 24, color = designColors.danger, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M14 3v5h5" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M8.6 17v-4.4h1.5a1.3 1.3 0 0 1 0 2.6H8.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M13.4 12.6h2.2M13.4 14.8h1.7M13.4 12.6V17" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function CameraIcon({ size = 24, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Circle cx={12} cy={13.5} r={3.6} stroke={color} strokeWidth={strokeWidth} fill="none" />
    </Svg>
  );
}

export function GalleryIcon({ size = 24, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3.5} y={5} width={17} height={14} rx={2} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={9} cy={10} r={1.6} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M4.5 17l4.6-4.4 3.2 3 2.6-2.2 4.6 3.9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function PencilIcon({ size = 20, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8V20Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M13.8 6.2l4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function TrashIcon({ size = 20, color = designColors.danger, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4.5 6.5h15" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M6.4 6.5l.9 12.1a1.6 1.6 0 0 0 1.6 1.4h6.2a1.6 1.6 0 0 0 1.6-1.4l.9-12.1" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M10.4 10v6.4M13.6 10v6.4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function CheckIcon({ size = 20, color = designColors.success, strokeWidth = 2.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline points="5,12.6 9.8,17.4 19,7.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function CrossIcon({ size = 20, color = designColors.danger, strokeWidth = 2.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function WarningIcon({ size = 20, color = designColors.danger, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 4.2 2.9 19.4h18.2L12 4.2Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M12 10v4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Circle cx={12} cy={16.8} r={1} fill={color} />
    </Svg>
  );
}

/** Stopwatch, used for anything about delivery time windows. */
export function WindowIcon({ size = 20, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={13.4} r={7.4} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M12 9.6v3.8l2.6 1.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M9.6 2.8h4.8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Path d="M12 2.8V6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Stacked boxes, used for weight/cargo readouts. */
export function WeightIcon({ size = 20, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.6 20.4 8 12 12.4 3.6 8 12 3.6Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M3.6 8v8L12 20.4 20.4 16V8" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M12 12.4v8" stroke={color} strokeWidth={strokeWidth} fill="none" />
    </Svg>
  );
}

/** Signpost, used for the region/route-code chips. */
export function RegionIcon({ size = 20, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.4v17.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Path d="M12 5.6h6.4l1.8 2.4-1.8 2.4H12" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M12 12.4H5.6L3.8 14.8l1.8 2.4H12" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Speed dial, used for the "fastest route" objective. */
export function FastestIcon({ size = 20, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3.6 17.4a9 9 0 1 1 16.8 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Path d="M12 15.4l4.4-5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Circle cx={12} cy={16.6} r={1.5} fill={color} />
    </Svg>
  );
}

/** Ruler, used for the "shortest route" objective. */
export function ShortestIcon({ size = 20, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={2.6} y={8.4} width={18.8} height={7.2} rx={1.4} stroke={color} strokeWidth={strokeWidth} fill="none" transform="rotate(-20 12 12)" />
      <Path d="M7.6 9.6l1 2M11 8.4l1.6 3.4M14.6 7.2l1 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Truck, used for the loading/start-route action. */
export function TruckIcon({ size = 22, color = '#FFFFFF', strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M2.6 6.4h10.2v9.4H2.6z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M12.8 9.6h4l3.6 3.4v2.8h-7.6z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Circle cx={7} cy={17.6} r={1.9} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={16.6} cy={17.6} r={1.9} stroke={color} strokeWidth={strokeWidth} fill="none" />
    </Svg>
  );
}

/** Route line with pins, used for the optimize action. */
export function RouteIcon({ size = 22, color = '#FFFFFF', strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5.6} cy={6.4} r={2.6} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={18.4} cy={17.6} r={2.6} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M5.6 9v3.2a3.4 3.4 0 0 0 3.4 3.4h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="2.6 2.4" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 18, color = '#5D6B63', strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline points="6,9.5 12,15.5 18,9.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 18, color = '#5D6B63', strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polyline points="9.5,6 15.5,12 9.5,18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
