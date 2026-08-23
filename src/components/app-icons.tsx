import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';

import { colors as designColors } from '@/ui/tokens';

/**
 * Shared line-icon set. Everything is drawn on a 24x24 grid with a consistent
 * 1.8 stroke and round joins, so icons sit together without one looking heavier
 * than the next. Filled shapes are avoided except where a solid dot reads
 * better than an outline at small sizes.
 */
export type IconProps = { size?: number; color?: string; strokeWidth?: number };

const BASE_STROKE = 1.8;

export function BackIcon({ size = 22, color = designColors.brandNavy, strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function HomeIcon({ size = 22, color = designColors.brandNavy, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="m3.5 11 8.5-7 8.5 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M5.5 10.2V20h13v-9.8M9.5 20v-6h5v6" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

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

export function ClipboardIcon({ size = 24, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={5} y={4.5} width={14} height={16} rx={2} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M9 6V4.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 4.8V6H9ZM8.5 11h7M8.5 15h5.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

/** Live fleet overview: vehicle plus a small location signal. */
export function DispatchIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 7.2h9.6v8.2H3zM12.6 10h3.2l3.2 3v2.4h-6.4z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Circle cx={6.8} cy={17.2} r={1.7} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={16.6} cy={17.2} r={1.7} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={18.4} cy={6.1} r={2.2} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M18.4 3.9v2.2l1.3.9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Checklist, used for delivery quality review. */
export function QualityIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={3.5} width={16} height={17} rx={2} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Polyline points="7.4,9.2 9.1,10.9 12.1,7.7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M13.8 9.4h3M7.4 15.2h9.4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Route execution action. */
export function ExecuteRouteIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={6} cy={17.5} r={2.4} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={18} cy={6.5} r={2.4} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M6 15.1v-2.4a3 3 0 0 1 3-3h2.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Polyline points="11.5,6.7 15,9.7 11.5,12.7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Application settings. */
export function SettingsIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={3.1} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Employee and driver management. */
export function EmployeesIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={9} cy={8} r={3.2} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M3.8 19a5.2 5.2 0 0 1 10.4 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Circle cx={17.3} cy={9.5} r={2.4} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path d="M15.2 14.8a4.2 4.2 0 0 1 5 4.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Fleet vehicle management. */
export function VehicleIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 15.5V9.8L6.1 5h10.5l3.4 4.8v5.7" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M4 10h16M7 15.5h10" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Circle cx={7} cy={17.2} r={1.8} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Circle cx={17} cy={17.2} r={1.8} stroke={color} strokeWidth={strokeWidth} fill="none" />
    </Svg>
  );
}

/** Completed work and trip-sheet reports. */
export function TripSheetIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 3.5h8l4 4V20.5H7z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none" />
      <Path d="M15 3.5v4h4M10 12h6M10 15.5h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Polyline points="3.8,15.2 5.2,16.6 7.5,13.9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Three ascending bars, outline weight, for the statistics screen entry point. */
export function StatsIcon({ size = 22, color = designColors.info, strokeWidth = BASE_STROKE }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 20V14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Path d="M11 20V8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
      <Path d="M18 20V4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
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
