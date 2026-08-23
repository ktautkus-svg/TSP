import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { CargoLayout, PlacedPallet } from '@/domain/cargo-layout';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

/** Room around the body for the dimension lines, in millimetres. */
const MARGIN_X_MM = 460;
const MARGIN_TOP_MM = 300;
const MARGIN_BOTTOM_MM = 380;

/**
 * Below this on-screen width a pallet is a smudge, so the deck boards are
 * dropped and only the outline, the order colour and the number remain.
 */
const PLANK_DETAIL_MIN_PX = 46;

const WOOD_DECK = '#C9A227';
const WOOD_DECK_DARK = '#A8861B';
const WOOD_BEARER = '#8A6D14';
const WOOD_EDGE = '#6B540F';

/**
 * The van or box floor seen from above, drawn to scale from real millimetres.
 *
 * The SVG viewBox is the body itself, so one SVG unit is one millimetre and no
 * pixel arithmetic is needed anywhere: a 1200 mm pallet is 1200 units wide
 * whatever size the card ends up.
 */
export function CargoLayoutSvg({
  layout,
  renderedWidthPx = 320,
}: {
  layout: CargoLayout;
  /** Actual on-screen width, used only to decide how much pallet detail to draw. */
  renderedWidthPx?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { lengthMm, widthMm, bodyType, wheelArch } = layout.vehicle;
  const viewWidth = widthMm + MARGIN_X_MM * 2;
  const viewHeight = lengthMm + MARGIN_TOP_MM + MARGIN_BOTTOM_MM;

  // Millimetres per on-screen pixel, so the detail threshold is about real size.
  const mmPerPx = viewWidth / Math.max(1, renderedWidthPx);
  const showPlanks = 800 / mmPerPx >= PLANK_DETAIL_MIN_PX;

  const orders = layout.placed.map((item) => item.deliveryOrder);
  const firstOrder = orders.length > 0 ? Math.min(...orders) : 1;
  const lastOrder = orders.length > 0 ? Math.max(...orders) : 1;

  return (
    <View style={styles.card} testID="cargo-layout">
      <View style={styles.headerRow}>
        <Text style={styles.headerValue} testID="cargo-layout-weight">
          {formatWeightKg(layout.totalWeightKg)}
        </Text>
        <Text style={styles.headerMeta}>
          {layout.placed.length}/{layout.slots.length} vietų · {layout.usedSlotPercent} %
        </Text>
      </View>

      <Svg
        width="100%"
        height={renderedWidthPx * (viewHeight / viewWidth)}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        testID="cargo-layout-svg">
        <G x={MARGIN_X_MM} y={MARGIN_TOP_MM}>
          {/* Cabin end */}
          <Rect
            x={0}
            y={-190}
            width={widthMm}
            height={170}
            rx={60}
            fill={colors.surfaceMuted}
            stroke={colors.borderStrong}
            strokeWidth={12}
          />
          <SvgText
            x={widthMm / 2}
            y={-70}
            fontSize={130}
            fill={colors.textMuted}
            textAnchor="middle">
            KABINA
          </SvgText>

          {/* Cargo floor */}
          <Rect
            x={0}
            y={0}
            width={widthMm}
            height={lengthMm}
            fill={colors.surface}
            stroke={colors.text}
            strokeWidth={16}
          />

          {bodyType === 'van' && wheelArch ? (
            <WheelArches
              lengthMm={lengthMm}
              widthMm={widthMm}
              startMm={wheelArch.startMm}
              endMm={wheelArch.endMm}
              intrusionMm={wheelArch.intrusionMm}
              colors={colors}
            />
          ) : null}

          {layout.placed.map((pallet) => (
            <PalletShape
              key={`${pallet.itemId}-${pallet.palletOfItem}`}
              pallet={pallet}
              showPlanks={showPlanks}
              firstOrder={firstOrder}
              lastOrder={lastOrder}
            />
          ))}

          {/* Rear doors */}
          <Line
            x1={0}
            y1={lengthMm}
            x2={widthMm}
            y2={lengthMm}
            stroke={colors.warning}
            strokeWidth={26}
          />
          <SvgText
            x={widthMm / 2}
            y={lengthMm + 165}
            fontSize={130}
            fill={colors.textMuted}
            textAnchor="middle">
            GALINĖS DURYS
          </SvgText>

          <DimensionLines lengthMm={lengthMm} widthMm={widthMm} colors={colors} />
        </G>
      </Svg>

      <View style={styles.legend}>
        <LegendDot color={unloadColor(0)} label="Pirmas iškrauti" styles={styles} />
        <LegendDot color={unloadColor(0.5)} label="Vidurys" styles={styles} />
        <LegendDot color={unloadColor(1)} label="Paskutinis" styles={styles} />
      </View>

      {layout.warnings.length > 0 ? (
        <View style={styles.warnings} testID="cargo-layout-warnings">
          {layout.warnings.map((warning) => (
            <Text
              key={warning.code}
              accessibilityRole={warning.severity === 'critical' ? 'alert' : undefined}
              style={warning.severity === 'critical' ? styles.warningCritical : styles.warning}>
              {warning.severity === 'critical' ? '⚠ ' : '• '}{warning.message}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A euro pallet as it actually looks from above: three bearers running the long
 * way, five deck boards across them, and the order colour carried on the edge
 * rather than flooding the whole pallet, so it still reads as timber.
 */
function PalletShape({
  pallet,
  showPlanks,
  firstOrder,
  lastOrder,
}: {
  pallet: PlacedPallet;
  showPlanks: boolean;
  firstOrder: number;
  lastOrder: number;
}) {
  const { slot } = pallet;
  const inset = 30;
  const x = slot.xMm + inset;
  const y = slot.yMm + inset;
  const width = slot.widthMm - inset * 2;
  const depth = slot.depthMm - inset * 2;

  // Deck boards always run across the pallet's short side.
  const alongX = slot.orientation === 'crosswise';
  const longSide = alongX ? width : depth;
  const shortSide = alongX ? depth : width;

  const progress = lastOrder === firstOrder
    ? 0
    : (pallet.deliveryOrder - firstOrder) / (lastOrder - firstOrder);
  const edge = unloadColor(progress);

  const boardCount = 5;
  const boardThickness = longSide * 0.1;
  const gap = (longSide - boardCount * boardThickness) / (boardCount - 1);

  return (
    <G>
      <Rect x={x} y={y} width={width} height={depth} fill={WOOD_BEARER} rx={14} />

      {showPlanks ? (
        <>
          {[0, 0.5, 1].map((position) => {
            const bearerThickness = shortSide * 0.14;
            const offset = position * (shortSide - bearerThickness);
            return alongX ? (
              <Rect
                key={`bearer-${position}`}
                x={x}
                y={y + offset}
                width={longSide}
                height={bearerThickness}
                fill={WOOD_EDGE}
              />
            ) : (
              <Rect
                key={`bearer-${position}`}
                x={x + offset}
                y={y}
                width={bearerThickness}
                height={longSide}
                fill={WOOD_EDGE}
              />
            );
          })}
          {Array.from({ length: boardCount }, (_, index) => {
            const offset = index * (boardThickness + gap);
            const wide = index === 0 || index === boardCount - 1 || index === 2;
            const fill = wide ? WOOD_DECK : WOOD_DECK_DARK;
            return alongX ? (
              <Rect
                key={`deck-${index}`}
                x={x + offset}
                y={y}
                width={boardThickness}
                height={depth}
                fill={fill}
              />
            ) : (
              <Rect
                key={`deck-${index}`}
                x={x}
                y={y + offset}
                width={width}
                height={boardThickness}
                fill={fill}
              />
            );
          })}
        </>
      ) : (
        <Rect x={x} y={y} width={width} height={depth} fill={WOOD_DECK} rx={14} />
      )}

      {/* Order colour on the rim, and a dashed rim when the pallet count is a guess. */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={depth}
        rx={14}
        fill="none"
        stroke={edge}
        strokeWidth={46}
        strokeDasharray={pallet.estimated ? '110,70' : undefined}
      />

      <SvgText
        x={x + width / 2}
        y={y + depth / 2 - 10}
        fontSize={190}
        fontWeight="bold"
        fill="#1A1206"
        textAnchor="middle">
        {pallet.deliveryOrder}
        {pallet.palletsForItem > 1 ? `·${pallet.palletOfItem}` : ''}
      </SvgText>
      <SvgText
        x={x + width / 2}
        y={y + depth / 2 + 150}
        fontSize={130}
        fill="#3A2C10"
        textAnchor="middle">
        {pallet.estimated ? '≈' : ''}{pallet.weightKg === null ? '— kg' : `${Math.round(pallet.weightKg)} kg`}
      </SvgText>
    </G>
  );
}

function WheelArches({
  lengthMm,
  widthMm,
  startMm,
  endMm,
  intrusionMm,
  colors,
}: {
  lengthMm: number;
  widthMm: number;
  startMm: number;
  endMm: number;
  intrusionMm: number;
  colors: ColorPalette;
}) {
  const top = Math.max(0, startMm);
  const bottom = Math.min(lengthMm, endMm);
  const arc = (left: boolean) => {
    const outer = left ? 0 : widthMm;
    const inner = left ? intrusionMm : widthMm - intrusionMm;
    return `M ${outer} ${top} L ${inner} ${top} L ${inner} ${bottom} L ${outer} ${bottom} Z`;
  };
  return (
    <G>
      {[true, false].map((left) => (
        <Path
          key={left ? 'left' : 'right'}
          d={arc(left)}
          fill={colors.surfaceMuted}
          stroke={colors.borderStrong}
          strokeWidth={10}
        />
      ))}
      <SvgText
        x={intrusionMm / 2}
        y={(top + bottom) / 2}
        fontSize={95}
        fill={colors.textMuted}
        textAnchor="middle"
        transform={`rotate(-90 ${intrusionMm / 2} ${(top + bottom) / 2})`}>
        RATO ARKA
      </SvgText>
    </G>
  );
}

function DimensionLines({
  lengthMm,
  widthMm,
  colors,
}: {
  lengthMm: number;
  widthMm: number;
  colors: ColorPalette;
}) {
  const offset = 220;
  return (
    <G stroke={colors.textMuted} strokeWidth={8}>
      {/* Length, down the left */}
      <Line x1={-offset} y1={0} x2={-offset} y2={lengthMm} />
      <Line x1={-offset - 70} y1={0} x2={-offset + 70} y2={0} />
      <Line x1={-offset - 70} y1={lengthMm} x2={-offset + 70} y2={lengthMm} />
      <SvgText
        x={-offset - 60}
        y={lengthMm / 2}
        fontSize={140}
        fill={colors.textMuted}
        stroke="none"
        textAnchor="middle"
        transform={`rotate(-90 ${-offset - 60} ${lengthMm / 2})`}>
        {lengthMm} mm
      </SvgText>

      {/* Width, along the bottom */}
      <Line x1={0} y1={lengthMm + offset + 90} x2={widthMm} y2={lengthMm + offset + 90} />
      <Line x1={0} y1={lengthMm + offset + 20} x2={0} y2={lengthMm + offset + 160} />
      <Line x1={widthMm} y1={lengthMm + offset + 20} x2={widthMm} y2={lengthMm + offset + 160} />
      <SvgText
        x={widthMm / 2}
        y={lengthMm + offset + 290}
        fontSize={140}
        fill={colors.textMuted}
        stroke="none"
        textAnchor="middle">
        {widthMm} mm
      </SvgText>
    </G>
  );
}

/** Yellow at the doors (first out) through orange to deep blue at the cabin. */
export function unloadColor(progress: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [244, 196, 48]],
    [0.5, [232, 132, 42]],
    [1, [23, 42, 92]],
  ];
  const clamped = Math.min(1, Math.max(0, progress));
  for (let index = 0; index < stops.length - 1; index += 1) {
    const [fromStop, fromColor] = stops[index]!;
    const [toStop, toColor] = stops[index + 1]!;
    if (clamped <= toStop) {
      const span = toStop - fromStop || 1;
      const ratio = (clamped - fromStop) / span;
      const channel = (position: number) =>
        Math.round(fromColor[position]! + (toColor[position]! - fromColor[position]!) * ratio);
      return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
    }
  }
  return 'rgb(23, 42, 92)';
}

function LegendDot({
  color,
  label,
  styles,
}: {
  color: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  headerValue: { ...type.readout, color: colors.text },
  headerMeta: { ...type.secondary, color: colors.textMuted },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendSwatch: { width: 14, height: 14, borderRadius: 3 },
  legendLabel: { ...type.secondary, color: colors.textMuted },
  warnings: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warning: { ...type.secondary, color: colors.text },
  warningCritical: { ...type.secondaryStrong, color: colors.danger },
});
