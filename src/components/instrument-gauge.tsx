import { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { cockpitColors, fonts } from '@/ui/tokens';

type InstrumentGaugeProps = {
  /** Amount already handed over. Drives the precision needle and progress arc. */
  value: number;
  /** Amount still on board. This is the primary operational readout. */
  remaining?: number;
  maximum: number;
  unit?: string;
  title: string;
  size?: number;
};

const VIEW = 240;
const CENTER = 120;
const DIAL_START = 225;
const DIAL_SWEEP = 270;
const FACE_RADIUS = 106;
const ARC_RADIUS = 91;
const ARC_WIDTH = 6;
const CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;
const ARC_LENGTH = CIRCUMFERENCE * (DIAL_SWEEP / 360);
const TICK_COUNT = 30;

function polar(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + Math.sin(radians) * radius,
    y: CENTER - Math.cos(radians) * radius,
  };
}

function formatScaleValue(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
}

export function InstrumentGauge({
  value,
  remaining,
  maximum,
  unit = '',
  title,
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
  const needleAngle = DIAL_START + DIAL_SWEEP * fraction;
  const needleTip = polar(needleAngle, 70);
  const scaleStart = polar(DIAL_START, 70);
  const scaleEnd = polar(DIAL_START + DIAL_SWEEP, 70);

  const readout = useMemo(() => new Intl.NumberFormat('lt-LT', {
    maximumFractionDigits: stillOnBoard >= 100 ? 0 : 1,
    useGrouping: false,
  }).format(stillOnBoard), [stillOnBoard]);
  const readoutFontSize = readout.length >= 6 ? 28 : readout.length >= 5 ? 33 : readout.length >= 4 ? 38 : 44;

  return (
    <View
      accessibilityLabel={`${title}: liko ${readout} ${unit}`.trim()}
      style={styles.wrapper}
      testID={`instrument-gauge-${title.toLowerCase()}`}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <Defs>
            <RadialGradient id="dialFace" cx="38%" cy="28%" r="78%">
              <Stop offset="0" stopColor={cockpitColors.panelSoft} />
              <Stop offset="0.58" stopColor={cockpitColors.panel} />
              <Stop offset="1" stopColor={cockpitColors.canvas} />
            </RadialGradient>
            <LinearGradient id="steelRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#AAB5BF" />
              <Stop offset="0.22" stopColor={cockpitColors.metalSoft} />
              <Stop offset="0.5" stopColor="#667684" />
              <Stop offset="0.78" stopColor="#25323E" />
              <Stop offset="1" stopColor="#9AA7B2" />
            </LinearGradient>
            <LinearGradient id="routeProgress" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor={cockpitColors.routeBlueStrong} />
              <Stop offset="1" stopColor={cockpitColors.routeBlue} />
            </LinearGradient>
            <RadialGradient id="hub" cx="38%" cy="32%" r="70%">
              <Stop offset="0" stopColor="#70808D" />
              <Stop offset="0.5" stopColor="#263440" />
              <Stop offset="1" stopColor={cockpitColors.canvas} />
            </RadialGradient>
          </Defs>

          <Circle cx={CENTER} cy={CENTER} r={116} fill={cockpitColors.canvas} />
          <Circle cx={CENTER} cy={CENTER} r={112} fill="none" stroke="url(#steelRing)" strokeWidth={4} />
          <Circle cx={CENTER} cy={CENTER} r={FACE_RADIUS} fill="url(#dialFace)" stroke={cockpitColors.border} strokeWidth={1.5} />
          <Circle cx={CENTER} cy={CENTER} r={FACE_RADIUS - 7} fill="none" stroke="#FFFFFF" strokeOpacity={0.045} strokeWidth={1} />

          <Circle
            cx={CENTER}
            cy={CENTER}
            r={ARC_RADIUS}
            fill="none"
            stroke={cockpitColors.metalSoft}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
            strokeLinecap="round"
            strokeWidth={ARC_WIDTH}
            transform={`rotate(${DIAL_START - 90} ${CENTER} ${CENTER})`}
          />
          {fraction > 0 ? (
            <Circle
              cx={CENTER}
              cy={CENTER}
              r={ARC_RADIUS}
              fill="none"
              stroke="url(#routeProgress)"
              strokeDasharray={`${Math.max(1, ARC_LENGTH * fraction)} ${CIRCUMFERENCE}`}
              strokeLinecap="round"
              strokeWidth={ARC_WIDTH}
              transform={`rotate(${DIAL_START - 90} ${CENTER} ${CENTER})`}
            />
          ) : null}

          {Array.from({ length: TICK_COUNT + 1 }, (_, index) => {
            const angle = DIAL_START + (DIAL_SWEEP * index) / TICK_COUNT;
            const major = index % 5 === 0;
            const outer = polar(angle, 82);
            const inner = polar(angle, major ? 72 : 77);
            return (
              <Line
                key={index}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={major ? cockpitColors.text : cockpitColors.metal}
                strokeOpacity={major ? 0.95 : 0.55}
                strokeWidth={major ? 2.2 : 1}
                strokeLinecap="round"
              />
            );
          })}

          <Line x1={CENTER + 2} y1={CENTER + 3} x2={needleTip.x + 2} y2={needleTip.y + 3} stroke="#000000" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" />
          <Line x1={CENTER} y1={CENTER} x2={needleTip.x} y2={needleTip.y} stroke={cockpitColors.text} strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx={CENTER} cy={CENTER} r={10} fill="url(#hub)" stroke={cockpitColors.routeBlue} strokeWidth={1.6} />
          <Circle cx={CENTER - 2.8} cy={CENTER - 3.2} r={2.2} fill="#DDE7EE" opacity={0.48} />

          <SvgText fill={cockpitColors.textMuted} fontFamily={fonts.headingSemiBold} fontSize={9} letterSpacing={1.2} textAnchor="middle" x={CENTER} y={83}>
            LIKO
          </SvgText>
          <SvgText fill={cockpitColors.text} fontFamily={fonts.heading} fontSize={readoutFontSize} fontWeight="700" textAnchor="middle" x={CENTER} y={130}>
            {readout}
          </SvgText>
          {unit ? (
            <SvgText fill={cockpitColors.textSecondary} fontFamily={fonts.bodyMedium} fontSize={12} letterSpacing={0.8} textAnchor="middle" x={CENTER} y={151}>
              {unit}
            </SvgText>
          ) : null}
          <SvgText fill={cockpitColors.textMuted} fontFamily={fonts.bodyMedium} fontSize={8.5} textAnchor="middle" x={scaleStart.x} y={scaleStart.y + 4}>
            0
          </SvgText>
          <SvgText fill={cockpitColors.textMuted} fontFamily={fonts.bodyMedium} fontSize={8.5} textAnchor="middle" x={scaleEnd.x} y={scaleEnd.y + 4}>
            {formatScaleValue(maximum)}
          </SvgText>
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, minWidth: 0, maxWidth: '44%', alignItems: 'center' },
  title: { color: cockpitColors.textSecondary, fontFamily: fonts.headingSemiBold, fontSize: 11, letterSpacing: 1.4, marginBottom: 5 },
  shadow: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cockpitColors.canvas,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 10,
  },
});
