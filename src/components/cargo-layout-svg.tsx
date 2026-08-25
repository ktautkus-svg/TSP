import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { VehicleIcon, WeightIcon } from '@/components/app-icons';
import type { CargoLayout, CargoSlot, PlacedPallet } from '@/domain/cargo-layout';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

/** Room around the body for the cabin, rear doors and dimension lines, in millimetres. */
const MARGIN_X_MM = 460;
const MARGIN_TOP_MM = 560;
const MARGIN_BOTTOM_MM = 600;

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
  /** Actual on-screen width, used only to size the SVG. */
  renderedWidthPx?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { lengthMm, widthMm, bodyType, wheelArch } = layout.vehicle;
  const viewWidth = widthMm + MARGIN_X_MM * 2;
  const viewHeight = lengthMm + MARGIN_TOP_MM + MARGIN_BOTTOM_MM;

  const orders = layout.placed.map((item) => item.deliveryOrder);
  const firstOrder = orders.length > 0 ? Math.min(...orders) : 1;
  const lastOrder = orders.length > 0 ? Math.max(...orders) : 1;
  const occupied = new Set(layout.placed.map((pallet) => pallet.slot.index));
  const remainingPercent = layout.slots.length === 0 ? 0 : Math.max(0, 100 - layout.usedSlotPercent);
  const payloadKg = layout.vehicle.maximumPayloadKg ?? null;
  const payloadExceeded = layout.warnings.some((warning) => warning.code === 'PAYLOAD_EXCEEDED');
  const floorFull = remainingPercent === 0 && layout.slots.length > 0;

  return (
    <View style={styles.card} testID="cargo-layout">
      <Text style={styles.sectionTitle}>Krovimo schema</Text>
      <View style={styles.dash} testID="cargo-layout-dashboard">
        <View style={styles.dashMetric}>
          <WeightIcon size={22} color={payloadExceeded ? colors.danger : colors.textSecondary} />
          <View style={styles.dashCopy}>
            <Text style={styles.dashLabel}>Bendras svoris</Text>
            <Text
              style={[styles.dashValue, payloadExceeded && styles.dashValueDanger]}
              testID="cargo-layout-weight">
              {formatWeightKg(layout.totalWeightKg)} kg
            </Text>
            {payloadKg ? (
              <Text style={styles.dashMeta}>iš {formatWeightKg(payloadKg)} kg keliamosios galios</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.dashSplit} />
        <View style={styles.dashMetric}>
          <VehicleIcon size={22} color={floorFull ? colors.warning : colors.textSecondary} />
          <View style={styles.dashCopy}>
            <Text style={styles.dashLabel}>Liko vietos</Text>
            <Text style={[styles.dashValue, floorFull && styles.dashValueWarn]} testID="cargo-layout-remaining">
              {remainingPercent}%
            </Text>
            <View style={styles.track} accessibilityLabel={`Užimta ${layout.usedSlotPercent} procentų grindų`}>
              <View style={[styles.trackFill, { width: `${Math.min(100, layout.usedSlotPercent)}%` }]} />
            </View>
            <Text style={styles.dashMeta}>
              {layout.placed.length} / {layout.slots.length} PLL užimta
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.hint}>
        Vaizdas iš viršaus. Kabina priekyje, galinės durys apačioje. Skaičius — pristatymo eilė (1 išeina pirmas).
      </Text>

      <Svg
        width="100%"
        height={renderedWidthPx * (viewHeight / viewWidth)}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        testID="cargo-layout-svg">
        <G x={MARGIN_X_MM} y={MARGIN_TOP_MM}>
          <Cabin widthMm={widthMm} colors={colors} />

          <Rect
            x={0}
            y={0}
            width={widthMm}
            height={lengthMm}
            fill={colors.surfaceMuted}
            stroke={colors.text}
            strokeWidth={16}
          />

          <Wheels lengthMm={lengthMm} widthMm={widthMm} archStartMm={wheelArch?.startMm} archEndMm={wheelArch?.endMm} colors={colors} />

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

          {layout.slots.filter((slot) => !occupied.has(slot.index)).map((slot) => (
            <EmptySlot key={`empty-${slot.index}`} slot={slot} colors={colors} />
          ))}

          {layout.placed.map((pallet) => (
            <OccupiedSlot
              key={`${pallet.itemId}-${pallet.palletOfItem}`}
              pallet={pallet}
              firstOrder={firstOrder}
              lastOrder={lastOrder}
            />
          ))}

          <RearDoors widthMm={widthMm} lengthMm={lengthMm} colors={colors} />
          <DimensionLines lengthMm={lengthMm} widthMm={widthMm} colors={colors} />
        </G>
      </Svg>

      {layout.warnings.filter((warning) => warning.code === 'ASSUMED_VEHICLE').map((warning) => (
        <Text key={warning.code} style={styles.assumedHint}>{warning.message}</Text>
      ))}

      <View style={styles.legend}>
        <LegendDot color={unloadColor(0)} label="Pirmas iškrauti" styles={styles} />
        <LegendDot color={unloadColor(0.5)} label="Vidurys" styles={styles} />
        <LegendDot color={unloadColor(1)} label="Paskutinis" styles={styles} />
      </View>

      {layout.warnings.some((warning) => warning.code !== 'ASSUMED_VEHICLE') ? (
        <View style={styles.warnings} testID="cargo-layout-warnings">
          {layout.warnings.filter((warning) => warning.code !== 'ASSUMED_VEHICLE').map((warning) => (
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

function Cabin({ widthMm, colors }: { widthMm: number; colors: ColorPalette }) {
  const seatW = Math.min(460, widthMm * 0.28);
  const seatH = 280;
  const seatY = -430;
  const leftX = widthMm * 0.12;
  const rightX = widthMm - leftX - seatW;
  return (
    <G>
      <Rect
        x={0}
        y={-500}
        width={widthMm}
        height={480}
        rx={90}
        fill={colors.surface}
        stroke={colors.borderStrong}
        strokeWidth={14}
      />
      <Rect x={leftX} y={seatY} width={seatW} height={seatH} rx={40} fill={colors.surfaceMuted} stroke={colors.borderStrong} strokeWidth={8} />
      <Rect x={rightX} y={seatY} width={seatW} height={seatH} rx={40} fill={colors.surfaceMuted} stroke={colors.borderStrong} strokeWidth={8} />
      <Circle
        cx={leftX + seatW / 2}
        cy={seatY + 70}
        r={78}
        fill="none"
        stroke={colors.textMuted}
        strokeWidth={16}
      />
      <SvgText
        x={widthMm / 2}
        y={-80}
        fontSize={120}
        fontWeight="600"
        fill={colors.textMuted}
        textAnchor="middle">
        KABINA
      </SvgText>
    </G>
  );
}

function Wheels({
  lengthMm,
  widthMm,
  archStartMm,
  archEndMm,
  colors,
}: {
  lengthMm: number;
  widthMm: number;
  archStartMm?: number;
  archEndMm?: number;
  colors: ColorPalette;
}) {
  const rx = 95;
  const ry = 220;
  const offset = 140;
  const frontY = 40;
  const rearY = archStartMm != null && archEndMm != null
    ? (archStartMm + archEndMm) / 2
    : lengthMm * 0.72;
  return (
    <G>
      {[{ x: -offset, y: frontY }, { x: widthMm + offset, y: frontY }, { x: -offset, y: rearY }, { x: widthMm + offset, y: rearY }].map((wheel) => (
        <Ellipse key={`${wheel.x}-${wheel.y}`} cx={wheel.x} cy={wheel.y} rx={rx} ry={ry} fill={colors.borderStrong} stroke={colors.text} strokeWidth={8} />
      ))}
    </G>
  );
}

function RearDoors({
  widthMm,
  lengthMm,
  colors,
}: {
  widthMm: number;
  lengthMm: number;
  colors: ColorPalette;
}) {
  const doorH = 110;
  const gap = 16;
  const doorW = (widthMm - gap) / 2;
  return (
    <G>
      <Rect x={0} y={lengthMm} width={doorW} height={doorH} rx={18} fill={colors.surface} stroke={colors.borderStrong} strokeWidth={12} />
      <Rect x={doorW + gap} y={lengthMm} width={doorW} height={doorH} rx={18} fill={colors.surface} stroke={colors.borderStrong} strokeWidth={12} />
      <SvgText
        x={widthMm / 2}
        y={lengthMm + 240}
        fontSize={120}
        fontWeight="600"
        fill={colors.textMuted}
        textAnchor="middle">
        GALINĖS DURYS
      </SvgText>
    </G>
  );
}

function EmptySlot({ slot, colors }: { slot: CargoSlot; colors: ColorPalette }) {
  const inset = 40;
  const x = slot.xMm + inset;
  const y = slot.yMm + inset;
  const width = slot.widthMm - inset * 2;
  const depth = slot.depthMm - inset * 2;
  return (
    <G>
      <Rect
        x={x}
        y={y}
        width={width}
        height={depth}
        rx={28}
        fill={colors.surface}
        stroke={colors.borderStrong}
        strokeWidth={12}
        strokeDasharray="70,45"
      />
      <SvgText
        x={x + width / 2}
        y={y + depth / 2 + 40}
        fontSize={110}
        fill={colors.textSubtle}
        textAnchor="middle">
        {`VIETA ${slot.index}`}
      </SvgText>
    </G>
  );
}

function OccupiedSlot({
  pallet,
  firstOrder,
  lastOrder,
}: {
  pallet: PlacedPallet;
  firstOrder: number;
  lastOrder: number;
}) {
  const { slot } = pallet;
  const inset = 30;
  const x = slot.xMm + inset;
  const y = slot.yMm + inset;
  const width = slot.widthMm - inset * 2;
  const depth = slot.depthMm - inset * 2;
  const progress = lastOrder === firstOrder
    ? 0
    : (pallet.deliveryOrder - firstOrder) / (lastOrder - firstOrder);
  const fill = unloadColor(progress);
  const text = progress > 0.62 ? '#FFFFFF' : '#171A2B';
  const weight = pallet.estimated ? '≈' : '';
  const kg = pallet.weightKg === null ? '— kg' : `${Math.round(pallet.weightKg)} kg`;
  const alongShort = Math.min(width, depth);
  const orderSize = Math.max(170, Math.min(260, alongShort * 0.36));
  const metaSize = Math.max(95, Math.min(140, alongShort * 0.18));

  return (
    <G>
      <Rect x={x} y={y} width={width} height={depth} rx={28} fill={fill} />
      <SvgText
        x={x + width / 2}
        y={y + depth * 0.42}
        fontSize={orderSize}
        fontWeight="700"
        fill={text}
        textAnchor="middle">
        {pallet.deliveryOrder}
        {pallet.palletsForItem > 1 ? `·${pallet.palletOfItem}` : ''}
      </SvgText>
      <SvgText
        x={x + width / 2}
        y={y + depth * 0.72}
        fontSize={metaSize}
        fill={text}
        textAnchor="middle">
        {weight}{kg}
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
  const radiusArc = Math.min(90, intrusionMm * 0.45);
  const left = [
    `M 0 ${top}`,
    `L ${intrusionMm - radiusArc} ${top}`,
    `Q ${intrusionMm} ${top} ${intrusionMm} ${top + radiusArc}`,
    `L ${intrusionMm} ${bottom - radiusArc}`,
    `Q ${intrusionMm} ${bottom} ${intrusionMm - radiusArc} ${bottom}`,
    `L 0 ${bottom} Z`,
  ].join(' ');
  const right = [
    `M ${widthMm} ${top}`,
    `L ${widthMm - intrusionMm + radiusArc} ${top}`,
    `Q ${widthMm - intrusionMm} ${top} ${widthMm - intrusionMm} ${top + radiusArc}`,
    `L ${widthMm - intrusionMm} ${bottom - radiusArc}`,
    `Q ${widthMm - intrusionMm} ${bottom} ${widthMm - intrusionMm + radiusArc} ${bottom}`,
    `L ${widthMm} ${bottom} Z`,
  ].join(' ');
  return (
    <G>
      <Path d={left} fill={colors.borderStrong} stroke={colors.text} strokeWidth={8} />
      <Path d={right} fill={colors.borderStrong} stroke={colors.text} strokeWidth={8} />
      <SvgText
        x={intrusionMm / 2}
        y={(top + bottom) / 2}
        fontSize={90}
        fill={colors.textInverse}
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

      <Line x1={0} y1={lengthMm + offset + 160} x2={widthMm} y2={lengthMm + offset + 160} />
      <Line x1={0} y1={lengthMm + offset + 90} x2={0} y2={lengthMm + offset + 230} />
      <Line x1={widthMm} y1={lengthMm + offset + 90} x2={widthMm} y2={lengthMm + offset + 230} />
      <SvgText
        x={widthMm / 2}
        y={lengthMm + offset + 340}
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
  sectionTitle: { ...type.cardTitle, color: colors.text },
  dash: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dashMetric: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minWidth: 0 },
  dashCopy: { flex: 1, minWidth: 0 },
  dashSplit: { width: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  dashLabel: { ...type.label, color: colors.textMuted },
  dashValue: { ...type.readout, color: colors.text },
  dashValueDanger: { color: colors.danger },
  dashValueWarn: { color: colors.warning },
  dashMeta: { ...type.meta, color: colors.textMuted },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: 4,
  },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  hint: { ...type.secondary, color: colors.textMuted },
  assumedHint: { ...type.secondary, color: colors.textMuted },
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
