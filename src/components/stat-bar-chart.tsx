import { Text, useWindowDimensions, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { fonts, spacing } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';

export type StatBarChartDatum = { label: string; value: number };

const CHART_HEIGHT = 120;
const BAR_GAP = 3;
const BAR_RADIUS = 2;
// FoundationScreen content padding (spacing.lg) + card padding (spacing.md), both sides.
const HORIZONTAL_CHROME = (spacing.lg + spacing.md) * 2;

/**
 * Minimal hand-drawn bar chart, following DashboardGauge's house style
 * (module-level geometry, flat react-native-svg primitives, no external
 * charting library — none exists in this project's dependencies).
 *
 * Uses useWindowDimensions rather than onLayout to size the chart: onLayout
 * has no working precedent anywhere else in this codebase and didn't fire
 * reliably in this project's react-native-web setup during testing.
 */
export function StatBarChart({
  data,
  color,
  colors,
  valueFormatter = (value) => value.toFixed(0),
}: {
  data: StatBarChartDatum[];
  color: string;
  colors: ColorPalette;
  valueFormatter?: (value: number) => string;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.max(200, Math.min(windowWidth, 900) - HORIZONTAL_CHROME);
  const maxValue = Math.max(1, ...data.map((item) => item.value));
  const barWidth = data.length > 0 ? Math.max(2, (width - BAR_GAP * (data.length - 1)) / data.length) : 0;

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>
          Maks.: {valueFormatter(maxValue)}
        </Text>
      </View>
      <View style={{ height: CHART_HEIGHT, marginTop: 4 }}>
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line x1={0} y1={CHART_HEIGHT - 1} x2={width} y2={CHART_HEIGHT - 1} stroke={colors.border} strokeWidth={1} />
            {data.map((item, index) => {
              const barHeight = maxValue > 0 ? Math.max(item.value > 0 ? 2 : 0, (item.value / maxValue) * (CHART_HEIGHT - 4)) : 0;
              const x = index * (barWidth + BAR_GAP);
              const isLast = index === data.length - 1;
              return (
                <Rect
                  key={item.label}
                  x={x}
                  y={CHART_HEIGHT - 1 - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={BAR_RADIUS}
                  fill={isLast ? color : colors.border}
                  opacity={isLast ? 1 : 0.65}
                />
              );
            })}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.mono }}>{data[0]?.label ?? ''}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.mono }}>{data.at(-1)?.label ?? ''}</Text>
      </View>
    </View>
  );
}
