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
import type { ColorPalette } from '@/ui/theme-palette';

type InstrumentGaugeProps = {
  /** Amount already handed over. Drives the needle and the progress arc. */
  value: number;
  /** Amount still on board. Drives the readout inside the cut-out wedge. */
  remaining?: number;
  maximum: number;
  unit?: string;
  title: string;
  colors: ColorPalette;
  size?: number;
};

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
  colors,
  size: requestedSize,
}: InstrumentGaugeProps) {
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
              <Stop offset="0" stopColor="#454E48" />
              <Stop offset="0.55" stopColor="#242B26" />
              <Stop offset="1" stopColor="#141915" />
            </RadialGradient>
            <LinearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F2F4F1" />
              <Stop offset="0.22" stopColor="#505752" />
              <Stop offset="0.48" stopColor="#D7DBD7" />
              <Stop offset="0.75" stopColor="#252A27" />
              <Stop offset="1" stopColor="#F6F7F5" />
            </LinearGradient>
            <LinearGradient id="progress" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#1F5A18" />
              <Stop offset="0.45" stopColor="#4FA82A" />
              <Stop offset="1" stopColor="#D4FF6E" />
            </LinearGradient>
            <LinearGradient id="needle" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#C45A12" />
              <Stop offset="0.4" stopColor="#FFB24A" />
              <Stop offset="1" stopColor="#FFF0C8" />
            </LinearGradient>
            <RadialGradient id="hub" cx="38%" cy="32%" r="70%">
              <Stop offset="0" stopColor="#4B534D" />
              <Stop offset="1" stopColor="#0A0D0B" />
            </RadialGradient>
            <RadialGradient id="wedgeGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#78C43C" stopOpacity={0.22} />
              <Stop offset="0.6" stopColor="#78C43C" stopOpacity={0.06} />
              <Stop offset="1" stopColor="#78C43C" stopOpacity={0} />
            </RadialGradient>
          </Defs>

          <Circle cx={CENTER} cy={CENTER} r={116} fill="#050706" />
          <Circle cx={CENTER} cy={CENTER} r={111} fill="none" stroke="url(#bezel)" strokeWidth={7} />
          <Circle cx={CENTER} cy={CENTER} r={104} fill="none" stroke="#050706" strokeWidth={5} />

          <Path d={WEDGE_PATH} fill="#000000" />
          <Path d={FACE_PATH} fill="url(#dial)" stroke="#C2CBC4" strokeOpacity={0.5} strokeWidth={1.6} />
          <Path d={GLASS_PATH} fill="none" stroke="#FFFFFF" strokeOpacity={0.07} strokeWidth={9} />

          <Path d={TRACK_PATH} fill="none" stroke="#141A12" strokeWidth={ARC_WIDTH + 1} strokeLinecap="round" />
          {fraction > 0 ? (
            <>
              <Path
                d={TRACK_PATH}
                fill="none"
                stroke="#D4FF6E"
                strokeOpacity={0.22}
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
              stroke="#98A19A"
              strokeWidth={1.2}
              rotation={angleFor(tick)}
              origin={`${CENTER}, ${CENTER}`}
            />
          ))}
          {majors.map((tick) => (
            <Line
              key={`major-${tick}`}
              x1={CENTER}
              y1={CENTER - TICK_OUTER}
              x2={CENTER}
              y2={CENTER - TICK_MAJOR_INNER}
              stroke="#FFFFFF"
              strokeWidth={2.8}
              strokeLinecap="round"
              rotation={angleFor(tick)}
              origin={`${CENTER}, ${CENTER}`}
            />
          ))}

          {majors.map((tick, index) => {
            // The first and last labels sit on the cut edges, so they are lifted
            // clear of the wedge instead of hugging its accent line.
            const isEndpoint = index === 0 || index === majors.length - 1;
            const point = polar(angleFor(tick), isEndpoint ? LABEL_RADIUS - 4 : LABEL_RADIUS);
            return (
              <SvgText
                key={`label-${tick}`}
                fill="#FFFFFF"
                fontFamily={fonts.headingExtraBold}
                fontSize={labelFontSize + 1.5}
                fontWeight="900"
                textAnchor="middle"
                x={point.x}
                y={point.y + 3 - (isEndpoint ? 11 : 0)}>
                {Math.round(tick)}
              </SvgText>
            );
          })}

          {/* Cut-out wedge: accent edges plus the remaining-quantity readout. */}
          <Circle cx={CENTER} cy={READOUT_CENTER_Y} r={66} fill="url(#wedgeGlow)" />
          {[FACE_START, FACE_END].map((edge) => (
            <Line
              key={`edge-${edge.x.toFixed(1)}`}
              x1={CENTER}
              y1={CENTER}
              x2={edge.x}
              y2={edge.y}
              stroke="#5A8F48"
              strokeOpacity={0.7}
              strokeWidth={1.4}
            />
          ))}

          <G rotation={needleAngle} origin={`${CENTER}, ${CENTER}`}>
            <Path
              d={`M 115.8 128 L ${CENTER} ${CENTER - NEEDLE_TIP} L 124.2 128 Z`}
              fill="#000000"
              opacity={0.45}
              transform="translate(2.5 2.5)"
            />
            {/* Counterweight stays cool grey so it never reads as the green wedge edge. */}
            <Path d={`M 114.5 ${CENTER} L ${CENTER} 148 L 125.5 ${CENTER} Z`} fill="#5A6260" />
            <Path
              d={`M 115.8 128 L ${CENTER} ${CENTER - NEEDLE_TIP} L 124.2 128 Z`}
              fill="url(#needle)"
              stroke="#FFD27A"
              strokeWidth={0.9}
            />
            <Path
              d={`M ${CENTER - 2.8} ${CENTER - NEEDLE_TIP + 14} L ${CENTER} ${CENTER - NEEDLE_TIP} L ${CENTER + 2.8} ${CENTER - NEEDLE_TIP + 14} Z`}
              fill="#FFF6D6"
            />
          </G>
          <Circle cx={CENTER} cy={CENTER} r={12} fill="url(#hub)" stroke="#D0A45A" strokeWidth={2} />
          <Circle cx={CENTER - 3} cy={CENTER - 4} r={3.2} fill="#69726B" opacity={0.75} />

          <SvgText
            fill="#FFFFFF"
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
              fill="#C8D4C4"
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

const styles = StyleSheet.create({
  wrapper: { flex: 1, minWidth: 0, maxWidth: '46%', alignItems: 'center' },
  title: { color: '#E7EBE7', fontFamily: fonts.heading, fontSize: 12, letterSpacing: 0.8, marginBottom: 3 },
  shadow: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D0C',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 12,
    elevation: 10,
  },
});
