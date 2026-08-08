import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Polygon, Rect } from 'react-native-svg';

import { fonts, spacing } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

const AnimatedG = Animated.createAnimatedComponent(G);

// Mirrors the design mockup's road illustration 1:1 (viewBox 0 0 600 90,
// same band positions, same van shape/proportions) — only the fill colors
// are theme-driven instead of the mockup's hardcoded oklch() values.
const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 90;
// FoundationScreen content padding (spacing.lg), both sides — the road bar
// has no card padding of its own, it sits directly in the dashboard gap.
const HORIZONTAL_CHROME = spacing.lg * 2;
const VAN_MIN_X = 20;
const VAN_MAX_X = 520;

export function RoadProgressBar({ fraction, colors }: { fraction: number; colors: ColorPalette }) {
  const { width: windowWidth } = useWindowDimensions();
  // Deriving height from the measured width via the exact 600:90 viewBox
  // ratio (rather than a fixed CSS height) keeps every shape's proportions
  // correct at any container width — a fixed height paired with
  // preserveAspectRatio="none" previously stretched circles into ellipses.
  const width = Math.max(200, Math.min(windowWidth, 900) - HORIZONTAL_CHROME);
  const height = width * (VIEW_HEIGHT / VIEW_WIDTH);

  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const animatedFraction = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedFraction, {
      toValue: clamped,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [animatedFraction, clamped]);

  const vanX = animatedFraction.interpolate({
    inputRange: [0, 1],
    outputRange: [VAN_MIN_X, VAN_MAX_X],
  });

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>PRISTATYMO EIGA</Text>
        <Text style={[styles.percent, { color: colors.text }]}>{Math.round(clamped * 100)}%</Text>
      </View>
      <Svg width={width} height={height} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        <Rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#4e9a52" />
        <Rect x={0} y={30} width={VIEW_WIDTH} height={34} fill="#2f3338" />
        <Rect x={0} y={30} width={VIEW_WIDTH} height={2.5} fill="#44484d" />
        <Rect x={0} y={61.5} width={VIEW_WIDTH} height={2.5} fill="#44484d" />
        <Line x1={8} y1={47} x2={592} y2={47} stroke="#efcc36" strokeWidth={2.5} strokeDasharray="14 12" />

        {/* Roadside marker near the start */}
        <G x={2} y={14}>
          <Rect x={0} y={12} width={24} height={20} fill="#7b6f66" />
          <Polygon points="-3,12 12,0 27,12" fill="#544438" />
          <Rect x={6} y={18} width={12} height={10} fill="#dd8736" />
        </G>

        {/* Finish flag near the end */}
        <G x={568} y={6}>
          <Line x1={8} y1={0} x2={8} y2={32} stroke="#44484d" strokeWidth={3} />
          <Polygon points="8,0 26,6 8,12" fill={colors.danger} />
        </G>

        {/* Van, sliding by delivered-weight fraction */}
        <AnimatedG x={vanX} y={14}>
          <Ellipse cx={20} cy={34} rx={21} ry={3.5} fill="#000" opacity={0.25} />
          <Rect x={1} y={9} width={37} height={19} rx={2.5} fill={colors.accent} />
          <Rect x={1} y={9} width={37} height={5} rx={2.5} fill={colors.accentSoft} opacity={0.6} />
          <Rect x={4} y={2} width={18} height={12} rx={2} fill={colors.brandNavy} />
          <Rect x={6.5} y={4.5} width={12} height={7} fill="#73d3f1" />
          <Rect x={1} y={9} width={37} height={19} rx={2.5} fill="none" stroke="#001d01" strokeWidth={1} />
          <Circle cx={7} cy={12} r={2} fill="#fee484" />
          <Rect x={34} y={18} width={3} height={4} fill={colors.danger} />
          <Circle cx={11} cy={30} r={6} fill="#1a1512" />
          <Circle cx={11} cy={30} r={2.6} fill="#998d83" />
          <Circle cx={30} cy={30} r={6} fill="#1a1512" />
          <Circle cx={30} cy={30} r={2.6} fill="#998d83" />
        </AnimatedG>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 12, fontFamily: fonts.headingSemiBold, letterSpacing: 1 },
  percent: { fontSize: 16, fontFamily: fonts.mono, fontWeight: '600' },
});
