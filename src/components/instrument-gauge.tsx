import { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { fonts } from '@/ui/tokens';
import { cockpitColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';

export interface InstrumentGaugeProps {
  /** Amount already handed over. Drives the needle and the progress arc. */
  readonly value: number;
  /** Amount still on board. Drives the readout inside the cut-out wedge. */
  readonly remaining?: number;
  readonly maximum: number;
  readonly unit?: string;
  readonly title: string;
  readonly size?: number;
}

type CockpitPalette = ReturnType<typeof cockpitColorsFor>;

const VIEW = 240;
const CENTER = 120;
// The face is read like a clock: zero sits at 8 o'clock and full scale at
// 4 o'clock. The 120° wedge between them is cut out of the dial entirely and
// carries the readout, so digits can never collide with the scale.
const DIAL_MIN_ANGLE = 240;
const DIAL_SWEEP = 240;
const FACE_RADIUS = 99;
const ARC_RADIUS = 93;
const ARC_WIDTH = 8;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS * (DIAL_SWEEP / 360);
const TICK_OUTER = 86;
const TICK_MAJOR_INNER = 74;
const TICK_MINOR_INNER = 80;
const LABEL_RADIUS = 63;
// Reaches almost to the progress arc so the tip reads against the dial edge,
// matching the length the driver sketched over the short stub.
const NEEDLE_TIP = 78;
const READOUT_CENTER_Y = 172;

function polar(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + Math.sin(radians) * radius,
    y: CENTER - Math.cos(radians) * radius,
  };
}

function sweepPath(radius: number): string {
  const from = polar(DIAL_MIN_ANGLE, radius);
  const to = polar(DIAL_MIN_ANGLE + DIAL_SWEEP, radius);
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${radius} ${radius} 0 1 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

const FACE_START = polar(DIAL_MIN_ANGLE, FACE_RADIUS);
const FACE_END = polar(DIAL_MIN_ANGLE + DIAL_SWEEP, FACE_RADIUS);
// Pac-man shaped dial: full disc minus the bottom wedge that holds the digits.
const FACE_PATH = `M ${CENTER} ${CENTER} L ${FACE_START.x.toFixed(2)} ${FACE_START.y.toFixed(2)} A ${FACE_RADIUS} ${FACE_RADIUS} 0 1 1 ${FACE_END.x.toFixed(2)} ${FACE_END.y.toFixed(2)} Z`;
const WEDGE_PATH = `M ${CENTER} ${CENTER} L ${FACE_END.x.toFixed(2)} ${FACE_END.y.toFixed(2)} A ${FACE_RADIUS} ${FACE_RADIUS} 0 0 1 ${FACE_START.x.toFixed(2)} ${FACE_START.y.toFixed(2)} Z`;
const TRACK_PATH = sweepPath(ARC_RADIUS);
const GLASS_PATH = sweepPath(FACE_RADIUS - 6);

/**
 * Picks round tick values (0, 500, 1000 …) while keeping full scale on the real
 * total, so the needle still lands exactly at the end of the arc when the last
 * kilo is delivered.
 */
function dialTicks(maximum: number) {
  const rough = maximum / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ??
    magnitude * 10;
  const majors: number[] = [];
  for (let tick = 0; tick < maximum - step * 0.3; tick += step) majors.push(tick);
  majors.push(maximum);
  const minorStep = step / 4;
  const minors: number[] = [];
  for (let tick = minorStep; tick < maximum; tick += minorStep) {
    if (majors.every((major) => Math.abs(major - tick) > minorStep * 0.3)) minors.push(tick);
  }
  return { majors, minors };
}

export function InstrumentGauge({
  value,
  remaining,
  maximum,
  unit = '',
  title,
  size: requestedSize,
}: InstrumentGaugeProps) {
  const { scheme } = useTheme();
  const cockpit = cockpitColorsFor(scheme);
  const styles = useMemo(() => createStyles(cockpit), [cockpit]);
  const { width } = useWindowDimensions();
  const responsiveSize = width < 700
    ? Math.min(164, Math.max(108, (Math.min(width, 480) - 92) / 2))
    : Math.min(250, Math.max(180, (Math.min(width, 760) - 96) / 2));
  const size = requestedSize ?? responsiveSize;
  const safeMaximum = maximum > 0 ? maximum : 1;
  const delivered = Math.max(0, Math.min(safeMaximum, value));
  const stillOnBoard = Math.max(0, remaining ?? safeMaximum - delivered);
  const fraction = delivered / safeMaximum;
  const needleAngle = DIAL_MIN_ANGLE + DIAL_SWEEP * fraction;

  const { majors, minors } = useMemo(() => dialTicks(safeMaximum), [safeMaximum]);
  const readout = useMemo(() => new Intl.NumberFormat('lt-LT', {
    maximumFractionDigits: stillOnBoard >= 100 ? 0 : 1,
    useGrouping: false,
  }).format(stillOnBoard), [stillOnBoard]);

  const readoutFontSize = readout.length >= 6 ? 26 : readout.length >= 5 ? 31 : readout.length >= 4 ? 37 : 44;
  const labelFontSize = majors.some((tick) => Math.round(tick).toString().length >= 4) ? 8.5 : 10;
  const angleFor = (tick: number) => DIAL_MIN_ANGLE + DIAL_SWEEP * (tick / safeMaximum);

  return (
    <View style={styles.wrapper} testID={`instrument-gauge-${title.toLowerCase()}`}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <Defs>
            <RadialGradient id="dial" cx="42%" cy="30%" r="76%">
              <Stop offset="0" stopColor={cockpit.surface} />
              <Stop offset="0.58" stopColor={cockpit.metalLight} />
              <Stop offset="1" stopColor={cockpit.surfaceContainerHigh} />
            </RadialGradient>
            <LinearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={cockpit.white} />
              <Stop offset="0.22" stopColor={cockpit.metalMid} />
              <Stop offset="0.48" stopColor={cockpit.metalLight} />
              <Stop offset="0.75" stopColor={cockpit.metalDark} />
              <Stop offset="1" stopColor={cockpit.white} />
            </LinearGradient>
            <LinearGradient id="progress" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={cockpit.primaryDark} />
              <Stop offset="0.45" stopColor={cockpit.primary} />
              <Stop offset="1" stopColor={cockpit.routeBright} />
            </LinearGradient>
            <LinearGradient id="needle" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={cockpit.error} />
              <Stop offset="0.55" stopColor="#EF4444" />
              <Stop offset="1" stopColor={cockpit.errorSoft} />
            </LinearGradient>
            <LinearGradient id="redZone" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={cockpit.error} stopOpacity={0} />
              <Stop offset="0.55" stopColor={cockpit.error} stopOpacity={0.18} />
              <Stop offset="1" stopColor={cockpit.error} stopOpacity={0.55} />
            </LinearGradient>
            <RadialGradient id="hub" cx="38%" cy="32%" r="70%">
              <Stop offset="0" stopColor={cockpit.metalLight} />
              <Stop offset="1" stopColor={cockpit.metalDark} />
            </RadialGradient>
            <RadialGradient id="wedgeGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={cockpit.primaryDim} stopOpacity={0.38} />
              <Stop offset="0.6" stopColor={cockpit.primarySoft} stopOpacity={0.18} />
              <Stop offset="1" stopColor={cockpit.surface} stopOpacity={0} />
            </RadialGradient>
          </Defs>

          <Circle cx={CENTER} cy={CENTER} r={116} fill={cockpit.surfaceDim} />
          <Circle cx={CENTER} cy={CENTER} r={111} fill="none" stroke="url(#bezel)" strokeWidth={7} />
          <Circle cx={CENTER} cy={CENTER} r={104} fill="none" stroke={cockpit.metalDark} strokeWidth={4} />

          <Path d={WEDGE_PATH} fill={cockpit.surfaceMuted} />
          <Path d={FACE_PATH} fill="url(#dial)" />
          <Path d={GLASS_PATH} fill="none" stroke={cockpit.white} strokeOpacity={0.72} strokeWidth={9} />

          <Path d={TRACK_PATH} fill="none" stroke={cockpit.surfaceDim} strokeWidth={ARC_WIDTH + 1} strokeLinecap="round" />
          <Path
            d={TRACK_PATH}
            fill="none"
            stroke="url(#redZone)"
            strokeWidth={ARC_WIDTH + 2}
            strokeLinecap="round"
            strokeDasharray={`${(ARC_LENGTH * 0.18).toFixed(2)} ${ARC_LENGTH.toFixed(2)}`}
            strokeDashoffset={(-(ARC_LENGTH * 0.82)).toFixed(2)}
          />
          {fraction > 0 ? (
            <>
              <Path
                d={TRACK_PATH}
                fill="none"
                stroke={cockpit.primaryDim}
                strokeOpacity={0.42}
                strokeWidth={ARC_WIDTH + 5}
                strokeLinecap="round"
                strokeDasharray={`${(ARC_LENGTH * fraction).toFixed(2)} ${ARC_LENGTH.toFixed(2)}`}
              />
              <Path
                d={TRACK_PATH}
                fill="none"
                stroke="url(#progress)"
                strokeWidth={ARC_WIDTH}
                strokeLinecap="round"
                strokeDasharray={`${(ARC_LENGTH * fraction).toFixed(2)} ${ARC_LENGTH.toFixed(2)}`}
              />
            </>
          ) : null}

          {minors.map((tick) => (
            <Line
              key={`minor-${tick}`}
              x1={CENTER}
              y1={CENTER - TICK_OUTER}
              x2={CENTER}
              y2={CENTER - TICK_MINOR_INNER}
              stroke={cockpit.outline}
              strokeWidth={1.2}
              transform={`rotate(${angleFor(tick)} ${CENTER} ${CENTER})`}
            />
          ))}
          {majors.map((tick) => (
            <Line
              key={`major-${tick}`}
              x1={CENTER}
              y1={CENTER - TICK_OUTER}
              x2={CENTER}
              y2={CENTER - TICK_MAJOR_INNER}
              stroke={cockpit.onSurface}
              strokeWidth={2.8}
              strokeLinecap="round"
              transform={`rotate(${angleFor(tick)} ${CENTER} ${CENTER})`}
            />
          ))}

          {majors.slice(0, -1).map((tick, index) => {
            // Full scale is already displayed as the large central readout. Do
            // not repeat it beside the cut-out where it competes with that value.
            const isStart = index === 0;
            const point = polar(angleFor(tick), isStart ? LABEL_RADIUS - 4 : LABEL_RADIUS);
            return (
              <SvgText
                key={`label-${tick}`}
                fill={cockpit.onSurface}
                fontFamily={fonts.headingExtraBold}
                fontSize={labelFontSize + 1.5}
                fontWeight="900"
                textAnchor="middle"
                x={point.x}
                y={point.y + 3 - (isStart ? 11 : 0)}>
                {Math.round(tick)}
              </SvgText>
            );
          })}

          {/* Borderless cut-out wedge keeps the needle visually continuous. */}
          <Circle cx={CENTER} cy={READOUT_CENTER_Y} r={66} fill="url(#wedgeGlow)" />

          <G transform={`rotate(${needleAngle} ${CENTER} ${CENTER})`}>
            <Path
              d={`M 114.8 130 L ${CENTER} ${CENTER - NEEDLE_TIP} L 125.2 130 Z`}
              fill={cockpit.shadow}
              opacity={0.55}
              transform="translate(3 3)"
            />
            {/* Counterweight stays cool grey so it never reads as the green wedge edge. */}
            <Path d={`M 113.5 ${CENTER} L ${CENTER} 150 L 126.5 ${CENTER} Z`} fill={cockpit.metalDark} />
            <Path
              d={`M 114.8 130 L ${CENTER} ${CENTER - NEEDLE_TIP} L 125.2 130 Z`}
              fill="url(#needle)"
              stroke={cockpit.errorSoft}
              strokeWidth={1.4}
            />
            <Path
              d={`M ${CENTER - 3.4} ${CENTER - NEEDLE_TIP + 16} L ${CENTER} ${CENTER - NEEDLE_TIP} L ${CENTER + 3.4} ${CENTER - NEEDLE_TIP + 16} Z`}
              fill={cockpit.errorSoft}
            />
          </G>
          <Circle cx={CENTER} cy={CENTER} r={13} fill="url(#hub)" stroke={cockpit.error} strokeWidth={2.4} />
          <Circle cx={CENTER - 3} cy={CENTER - 4} r={3.2} fill={cockpit.metalMid} opacity={0.75} />

          <SvgText
            fill={cockpit.onSurface}
            fontFamily={fonts.headingExtraBold}
            fontSize={readoutFontSize}
            fontWeight="900"
            textAnchor="middle"
            x={CENTER}
            y={READOUT_CENTER_Y + readoutFontSize * 0.35}>
            {readout}
          </SvgText>
          {unit ? (
            <SvgText
              fill={cockpit.onSurfaceVariant}
              fontFamily={fonts.heading}
              fontSize={13}
              fontWeight="800"
              letterSpacing={1.2}
              textAnchor="middle"
              x={CENTER}
              y={202}>
              {unit}
            </SvgText>
          ) : null}
        </Svg>
      </View>
    </View>
  );
}

const createStyles = (cockpit: CockpitPalette) => StyleSheet.create({
  wrapper: { flex: 1, minWidth: 0, maxWidth: '46%', alignItems: 'center' },
  title: { color: cockpit.onSurface, fontFamily: fonts.heading, fontSize: 12, letterSpacing: 0.8, marginBottom: 3 },
  shadow: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cockpit.surfaceDim,
    shadowColor: cockpit.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 12,
    elevation: 10,
  },
});
