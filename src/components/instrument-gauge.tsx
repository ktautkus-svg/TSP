import { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';

import { fonts } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

type InstrumentGaugeProps = {
  value: number;
  maximum: number;
  unit?: string;
  title: string;
  colors: ColorPalette;
  size?: number;
};

const VIEW = 240;
const CENTER = 120;
const DIAL_MIN_ANGLE = 220;
const DIAL_SWEEP = 280;

export function InstrumentGauge({ value, maximum, unit = '', title, colors, size: requestedSize }: InstrumentGaugeProps) {
  const { width } = useWindowDimensions();
  const responsiveSize = width < 700
    ? Math.min(164, Math.max(108, (Math.min(width, 480) - 92) / 2))
    : Math.min(250, Math.max(180, (Math.min(width, 760) - 96) / 2));
  const size = requestedSize ?? responsiveSize;
  const safeMaximum = maximum > 0 ? maximum : 1;
  const fraction = Math.max(0, Math.min(1, value / safeMaximum));
  const completionFraction = 1 - fraction;
  const needleAngle = DIAL_MIN_ANGLE + DIAL_SWEEP * fraction;
  const formattedValue = useMemo(() => new Intl.NumberFormat('lt-LT', {
    maximumFractionDigits: value >= 100 ? 0 : 1,
    useGrouping: false,
  }).format(Math.max(0, value)), [value]);
  const tickMaximum = maximum > 0 ? maximum : title.toLowerCase() === 'svoris' ? 1_000 : 10;
  const ticks = Array.from({ length: 25 }, (_, index) => ({
    angle: DIAL_MIN_ANGLE + (DIAL_SWEEP / 24) * index,
    major: index % 4 === 0,
    value: (tickMaximum / 24) * index,
    index,
  }));
  const isWeightGauge = title.toLowerCase() === 'svoris';
  const readoutFontSize = formattedValue.length >= 5 ? 24 : 28;
  const labelTicks = ticks.filter(({ major, index }) => major && index !== 12);

  return (
    <View style={styles.wrapper} testID={`instrument-gauge-${title.toLowerCase()}`}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2 }]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <Defs>
            <RadialGradient id="dial" cx="42%" cy="35%" r="68%">
              <Stop offset="0" stopColor="#303632" />
              <Stop offset="0.55" stopColor="#121613" />
              <Stop offset="1" stopColor="#030504" />
            </RadialGradient>
            <LinearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F2F4F1" />
              <Stop offset="0.22" stopColor="#505752" />
              <Stop offset="0.48" stopColor="#D7DBD7" />
              <Stop offset="0.75" stopColor="#252A27" />
              <Stop offset="1" stopColor="#F6F7F5" />
            </LinearGradient>
            <LinearGradient id="needle" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#D8DDD9" />
            <Stop offset="0.45" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#8C948E" />
            </LinearGradient>
          </Defs>

          <Circle cx={CENTER} cy={CENTER} r={116} fill="#050706" />
          <Circle cx={CENTER} cy={CENTER} r={111} fill="none" stroke="url(#bezel)" strokeWidth={7} />
          <Circle cx={CENTER} cy={CENTER} r={104} fill="none" stroke="#050706" strokeWidth={5} />
          <Circle cx={CENTER} cy={CENTER} r={99} fill="url(#dial)" stroke="#909893" strokeOpacity={0.65} strokeWidth={2} />
          <Circle cx={CENTER} cy={CENTER} r={93} fill="none" stroke="#38403B" strokeWidth={2} />

          <Path
            d="M 51 178 A 88 88 0 1 1 189 178"
            fill="none"
            stroke="#243027"
            strokeWidth={9}
            strokeLinecap="round"
          />
          <Path
            d="M 51 178 A 88 88 0 1 1 189 178"
            fill="none"
            stroke="#78A83D"
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(1, Math.round(417 * completionFraction))} 417`}
          />

          {ticks.filter(({ index }) => index !== 12).map(({ angle, major }, index) => (
            <Line
              key={index}
              x1={CENTER}
              y1={major ? 26 : 30}
              x2={CENTER}
              y2={major ? 42 : 38}
              stroke={major ? '#FFFFFF' : '#AAB1AC'}
              strokeWidth={major ? 2.6 : 1.1}
              rotation={angle}
              origin={`${CENTER}, ${CENTER}`}
            />
          ))}

          {labelTicks.map(({ angle, value: tickValue }, index) => {
            const radians = (angle * Math.PI) / 180;
            const labelRadius = isWeightGauge ? 70 : 68;
            const x = CENTER + Math.sin(radians) * labelRadius;
            const endpointLift = index === 0 || index === labelTicks.length - 1 ? 10 : 0;
            const y = CENTER - Math.cos(radians) * labelRadius + 3 - endpointLift;
            return (
              <SvgText
                key={`label-${index}`}
                fill="#D8DEDA"
                fontFamily={fonts.headingSemiBold}
                fontSize={isWeightGauge ? 8 : 10}
                fontWeight="700"
                textAnchor="middle"
                x={x}
                y={y}>
                {Math.round(tickValue)}
              </SvgText>
            );
          })}

          <G rotation={needleAngle} origin={`${CENTER}, ${CENTER}`}>
            <Path d="M116 122 L120 56 L124 122 Z" fill="#000" opacity={0.55} transform="translate(3 3)" />
            <Path d="M116 122 L120 56 L124 122 Z" fill="url(#needle)" stroke="#E9EDEA" strokeWidth={0.7} />
          </G>
          <Circle cx={CENTER} cy={CENTER} r={10} fill="#080B09" stroke="#AEB5B0" strokeWidth={2} />
          <Circle cx={CENTER - 2} cy={CENTER - 3} r={3.4} fill="#39413B" opacity={0.8} />
          <SvgText
            fill="#FFFFFF"
            fontFamily={fonts.headingExtraBold}
            fontSize={readoutFontSize}
            fontWeight="900"
            textAnchor="middle"
            x={CENTER}
            y={207}>
            {formattedValue}
          </SvgText>
          {unit ? (
            <SvgText fill="#FFFFFF" fontFamily={fonts.headingExtraBold} fontSize={14} fontWeight="900" textAnchor="middle" x={CENTER} y={204}>
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
