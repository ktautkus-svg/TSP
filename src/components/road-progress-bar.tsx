import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';

import { fonts, spacing } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

const AnimatedG = Animated.createAnimatedComponent(G);

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 120;
const GRASS_HEIGHT = 16;
const ASPHALT_TOP = GRASS_HEIGHT + 4;
const ASPHALT_BOTTOM = VIEW_HEIGHT - GRASS_HEIGHT - 4;
const WHEEL_CY = ASPHALT_BOTTOM - 4;
const WHEEL_R = 12;
const TRUCK_WIDTH = 138;
const TRUCK_MARGIN = 14;
const TRUCK_MIN_X = TRUCK_MARGIN;
const TRUCK_MAX_X = VIEW_WIDTH - TRUCK_WIDTH - TRUCK_MARGIN;

export function RoadProgressBar({ fraction, colors }: { fraction: number; colors: ColorPalette }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const animatedFraction = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedFraction, {
      toValue: clamped,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [animatedFraction, clamped]);

  const truckX = animatedFraction.interpolate({
    inputRange: [0, 1],
    outputRange: [TRUCK_MIN_X, TRUCK_MAX_X],
  });

  const dashCount = 14;
  const dashes = Array.from({ length: dashCount }, (_, index) => index);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>PRISTATYMO EIGA</Text>
        <Text style={[styles.percent, { color: colors.accent }]}>{Math.round(clamped * 100)}%</Text>
      </View>
      <Svg width="100%" height={VIEW_HEIGHT * 0.62} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none">
        {/* Grass shoulders, top and bottom */}
        <Rect x={0} y={0} width={VIEW_WIDTH} height={GRASS_HEIGHT} fill="#3f7d3a" />
        <Rect x={0} y={VIEW_HEIGHT - GRASS_HEIGHT} width={VIEW_WIDTH} height={GRASS_HEIGHT} fill="#3f7d3a" />
        {Array.from({ length: 40 }, (_, index) => (
          <Path
            key={`blade-top-${index}`}
            d={`M${index * 15 + 4} ${GRASS_HEIGHT} l2 -6`}
            stroke="#356b31"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        ))}
        {Array.from({ length: 40 }, (_, index) => (
          <Path
            key={`blade-bottom-${index}`}
            d={`M${index * 15 + 11} ${VIEW_HEIGHT - GRASS_HEIGHT} l2 6`}
            stroke="#356b31"
            strokeWidth={1.4}
            strokeLinecap="round"
          />
        ))}

        {/* Curb strips */}
        <Rect x={0} y={GRASS_HEIGHT} width={VIEW_WIDTH} height={4} fill="#c7c4bd" />
        <Rect x={0} y={VIEW_HEIGHT - GRASS_HEIGHT - 4} width={VIEW_WIDTH} height={4} fill="#c7c4bd" />

        {/* Asphalt base + subtle flat-toned patch bands (no gradients) */}
        <Rect x={0} y={ASPHALT_TOP} width={VIEW_WIDTH} height={ASPHALT_BOTTOM - ASPHALT_TOP} fill="#33363c" />
        <Rect x={0} y={ASPHALT_TOP} width={VIEW_WIDTH} height={6} fill="#3b3e45" />
        <Rect x={140} y={ASPHALT_TOP + 10} width={120} height={ASPHALT_BOTTOM - ASPHALT_TOP - 20} fill="#2c2f35" opacity={0.6} />
        <Rect x={380} y={ASPHALT_TOP + 6} width={90} height={ASPHALT_BOTTOM - ASPHALT_TOP - 12} fill="#3a3d44" opacity={0.5} />

        {/* Edge lines */}
        <Rect x={0} y={ASPHALT_TOP + 5} width={VIEW_WIDTH} height={1.6} fill="#e8e6df" opacity={0.85} />
        <Rect x={0} y={ASPHALT_BOTTOM - 6.6} width={VIEW_WIDTH} height={1.6} fill="#e8e6df" opacity={0.85} />

        {/* Dashed center line */}
        {dashes.map((index) => (
          <Rect
            key={`dash-${index}`}
            x={(VIEW_WIDTH / dashCount) * index + 10}
            y={(ASPHALT_TOP + ASPHALT_BOTTOM) / 2 - 1.6}
            width={26}
            height={3.2}
            fill="#e8c93a"
          />
        ))}

        {/* Start sign */}
        <G>
          <Rect x={30} y={ASPHALT_TOP - 2} width={3} height={30} fill="#8a8f98" />
          <Rect x={18} y={ASPHALT_TOP - 20} width={28} height={20} rx={2} fill={colors.brandNavy} stroke="#fff" strokeWidth={1.5} />
        </G>

        {/* Finish sign near the end, checkered flag */}
        <G>
          <Rect x={VIEW_WIDTH - 42} y={ASPHALT_TOP - 2} width={3} height={30} fill="#8a8f98" />
          <G x={VIEW_WIDTH - 40}>
            {[0, 1, 2, 3].map((col) =>
              [0, 1].map((row) => (
                <Rect
                  key={`flag-${col}-${row}`}
                  x={col * 6}
                  y={ASPHALT_TOP - 22 + row * 6}
                  width={6}
                  height={6}
                  fill={(col + row) % 2 === 0 ? '#f3f2f2' : '#201e1d'}
                />
              )),
            )}
          </G>
        </G>

        {/* Truck */}
        <AnimatedG x={truckX}>
          {/* Grounding shadow */}
          <Rect x={-6} y={WHEEL_CY + WHEEL_R - 3} width={TRUCK_WIDTH + 12} height={6} rx={3} fill="#000" opacity={0.22} />

          {/* Rear wheel well + wheel */}
          <Circle cx={22} cy={WHEEL_CY} r={WHEEL_R + 3} fill="#1c1e22" />
          <Circle cx={22} cy={WHEEL_CY} r={WHEEL_R} fill="#141517" />
          <Circle cx={22} cy={WHEEL_CY} r={5} fill="#9aa0a8" />
          <Circle cx={22} cy={WHEEL_CY} r={2} fill="#4b4f57" />

          {/* Front wheel well + wheel */}
          <Circle cx={112} cy={WHEEL_CY} r={WHEEL_R + 3} fill="#1c1e22" />
          <Circle cx={112} cy={WHEEL_CY} r={WHEEL_R} fill="#141517" />
          <Circle cx={112} cy={WHEEL_CY} r={5} fill="#9aa0a8" />
          <Circle cx={112} cy={WHEEL_CY} r={2} fill="#4b4f57" />

          {/* Cargo box */}
          <Rect x={2} y={44} width={86} height={44} fill={colors.accent} />
          <Rect x={2} y={44} width={86} height={6} fill={colors.accentStrong} opacity={0.55} />
          <Rect x={2} y={80} width={86} height={8} fill={colors.accentStrong} />
          <Rect x={2} y={62} width={86} height={2} fill={colors.accentStrong} opacity={0.4} />
          <Rect x={2} y={44} width={4} height={44} fill={colors.accentStrong} opacity={0.5} />

          {/* Cab */}
          <Rect x={88} y={58} width={34} height={30} fill={colors.brandNavy} />
          <Rect x={88} y={80} width={34} height={8} fill="#001f03" />
          <Polygon points="92,58 118,58 114,68 96,68" fill="#bfe4f5" opacity={0.9} />
          <Rect x={92} y={69} width={22} height={2} fill="#001f03" opacity={0.5} />
          <Rect x={86} y={62} width={4} height={4} fill="#5c6570" />

          {/* Bumper + lights */}
          <Rect x={120} y={76} width={10} height={10} fill="#22262c" />
          <Circle cx={128} cy={66} r={3} fill="#ffe28a" />
          <Rect x={0} y={70} width={4} height={6} fill="#c23b3b" />
        </AnimatedG>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 12, fontFamily: fonts.headingSemiBold, letterSpacing: 1 },
  percent: { fontSize: 16, fontFamily: fonts.headingExtraBold },
});
