import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  vehicleCargoSummary,
  type LoadingBayView,
  type LoadingPlacement,
  type LoadingSchema,
  type VehicleCargoLayout,
} from '@/domain/loading-schema';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

import { unloadColor } from './cargo-layout-svg';

export function LoadingSchemaCard({
  schema,
  cargoLayout,
}: {
  schema: LoadingSchema;
  cargoLayout: VehicleCargoLayout;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const front = schema.bays.filter((bay) => bay.orientation === 'vertical');
  const rows = schema.bays.filter((bay) => bay.orientation === 'horizontal');
  const compact = rows.length >= 5;
  const orders = schema.placements.map((item) => item.deliveryOrder);
  const firstOrder = orders.length > 0 ? Math.min(...orders) : 1;
  const lastOrder = orders.length > 0 ? Math.max(...orders) : 1;
  const manifest = [...schema.placements].sort((left, right) => left.deliveryOrder - right.deliveryOrder);

  return (
    <View style={styles.card} testID="loading-schema-card">
      <Text style={styles.title}>Krovimo schema</Text>
      <Text style={styles.hint}>
        Vaizdas iš viršaus. Kabina priekyje, galinės durys apačioje. Skaičius ant krovinio — pristatymo eilė
        (1 išeina pirmas).
      </Text>
      <Text style={styles.vehicle} testID="loading-schema-vehicle">
        {vehicleCargoSummary(cargoLayout)}
      </Text>

      <View
        accessibilityLabel="Automobilio kėbulas iš viršaus: kabina priekyje, galinės durys apačioje"
        accessibilityRole="image"
        style={styles.van}
        testID="loading-schema-van">
        <View style={styles.cabin}>
          <View style={styles.mirrorRow}>
            <View style={styles.mirror} />
            <View style={styles.mirrorSpacer} />
            <View style={styles.mirror} />
          </View>
          <View style={styles.windshield}>
            <Text style={styles.cab}>Kabina</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.chassis}>
            <View style={styles.rail}>
              <View style={styles.wheel} />
              <View style={[styles.wheel, styles.wheelRear]} />
            </View>

            <View style={styles.hold}>
              <View style={styles.frontRow}>
                {front.map((bay) => (
                  <BayCell
                    key={bay.id}
                    bay={bay}
                    compact={compact}
                    firstOrder={firstOrder}
                    lastOrder={lastOrder}
                    styles={styles}
                    colors={colors}
                  />
                ))}
              </View>
              {rows.map((bay) => (
                <BayCell
                  key={bay.id}
                  bay={bay}
                  compact={compact}
                  firstOrder={firstOrder}
                  lastOrder={lastOrder}
                  styles={styles}
                  colors={colors}
                  wide
                />
              ))}
            </View>

            <View style={styles.rail}>
              <View style={styles.wheel} />
              {cargoLayout.hasSideDoor ? <View style={styles.sideDoor} /> : null}
              <View style={[styles.wheel, styles.wheelRear]} />
            </View>
          </View>

          <View style={styles.rear}>
            <View style={styles.doorRow}>
              <View style={styles.doorLeaf} />
              <View style={styles.doorGap} />
              <View style={styles.doorLeaf} />
            </View>
            <Text style={styles.doors}>Galinės durys</Text>
          </View>
        </View>
      </View>
      {cargoLayout.hasSideDoor ? (
        <Text style={styles.sideDoorCaption}>Geltona juosta dešinėje — šoninės durys.</Text>
      ) : null}

      <View style={styles.legend}>
        <LegendDot color={unloadColor(0)} label="Pirmas iškrauti" styles={styles} />
        <LegendDot color={unloadColor(0.5)} label="Vidurys" styles={styles} />
        <LegendDot color={unloadColor(1)} label="Paskutinis" styles={styles} />
      </View>

      {manifest.length > 0 ? (
        <View style={styles.manifest} testID="loading-schema-manifest">
          <Text style={styles.manifestTitle}>Kroviniai pagal iškrovimą</Text>
          {manifest.map((item) => (
            <View key={item.stopId} style={styles.manifestRow}>
              <View
                style={[
                  styles.manifestBadge,
                  { backgroundColor: unloadColor(unloadProgress(item.deliveryOrder, firstOrder, lastOrder)) },
                ]}>
                <Text
                  style={[
                    styles.manifestBadgeText,
                    { color: badgeForeground(item.deliveryOrder, firstOrder, lastOrder, colors) },
                  ]}>
                  {item.deliveryOrder}
                </Text>
              </View>
              <View style={styles.manifestBody}>
                <Text style={styles.manifestLine}>
                  {formatWeightKg(item.weightKg)} kg
                  {item.usePallet ? ' · PLL' : ''}
                  {item.sideAccess ? ' · per šoną' : ''}
                  {' · '}
                  {item.bayLabel}
                </Text>
                <Text style={styles.manifestAddress}>{shortAddress(item.address)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {schema.warnings.length > 0 ? (
        <View style={styles.warnings} testID="loading-schema-warnings">
          {schema.warnings.map((warning) => (
            <Text
              key={`${warning.code}:${warning.bayId ?? 'all'}`}
              accessibilityRole={warning.severity === 'critical' ? 'alert' : undefined}
              style={warning.severity === 'critical' ? styles.warningCritical : styles.warning}>
              {warning.severity === 'critical' ? '⚠ ' : '• '}{warning.message}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.summary}>{schema.summary}</Text>
    </View>
  );
}

function BayCell({
  bay,
  styles,
  colors,
  compact,
  firstOrder,
  lastOrder,
  wide = false,
}: {
  bay: LoadingBayView;
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  compact: boolean;
  firstOrder: number;
  lastOrder: number;
  wide?: boolean;
}) {
  const empty = bay.placements.length === 0;
  return (
    <View
      style={[
        styles.bay,
        wide && styles.bayWide,
        compact && styles.bayCompact,
        empty && styles.bayEmpty,
        bay.nearDoors && styles.bayDoor,
        bay.sideDoor && styles.baySide,
      ]}
      testID={`loading-bay-${bay.id}`}>
      <Text style={[styles.bayLabel, bay.sideDoor && styles.bayLabelSide]}>{bay.label}</Text>
      {empty ? (
        <Text style={styles.empty}>Tuščia</Text>
      ) : bay.placements.map((item) => (
        <CargoChip
          key={item.stopId}
          item={item}
          colors={colors}
          firstOrder={firstOrder}
          lastOrder={lastOrder}
          styles={styles}
        />
      ))}
    </View>
  );
}

function CargoChip({
  item,
  colors,
  firstOrder,
  lastOrder,
  styles,
}: {
  item: LoadingPlacement;
  colors: ColorPalette;
  firstOrder: number;
  lastOrder: number;
  styles: ReturnType<typeof createStyles>;
}) {
  const progress = unloadProgress(item.deliveryOrder, firstOrder, lastOrder);
  const accent = unloadColor(progress);
  return (
    <View style={[styles.cargo, { borderColor: accent }]}>
      <View style={[styles.cargoIndex, { backgroundColor: accent }]}>
        <Text style={[styles.cargoIndexText, { color: badgeForeground(item.deliveryOrder, firstOrder, lastOrder, colors) }]}>
          {item.deliveryOrder}
        </Text>
      </View>
      <View style={styles.cargoMeta}>
        <Text style={styles.cargoWeight}>{formatWeightKg(item.weightKg)} kg</Text>
        <Text style={styles.cargoStack}>
          {item.stackLabel}
          {item.usePallet ? ' · PLL' : ''}
          {item.sideAccess ? ' · per šoną' : ''}
        </Text>
      </View>
    </View>
  );
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

function unloadProgress(order: number, firstOrder: number, lastOrder: number): number {
  if (lastOrder === firstOrder) return 0;
  return (order - firstOrder) / (lastOrder - firstOrder);
}

function badgeForeground(
  order: number,
  firstOrder: number,
  lastOrder: number,
  colors: ColorPalette,
): string {
  return unloadProgress(order, firstOrder, lastOrder) > 0.55 ? colors.textInverse : colors.text;
}

function shortAddress(value: string): string {
  const text = value.trim();
  if (text.length <= 42) return text;
  return `${text.slice(0, 40)}…`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  title: { ...type.cardTitle, color: colors.text },
  hint: { ...type.secondary, color: colors.textSecondary },
  vehicle: { ...type.secondaryStrong, color: colors.text },
  van: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    paddingHorizontal: 10,
    overflow: 'visible',
  },
  cabin: {
    alignSelf: 'center',
    width: '78%',
    backgroundColor: colors.text,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    marginBottom: -1,
  },
  mirrorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: -18,
    marginBottom: 6,
  },
  mirror: {
    width: 14,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  mirrorSpacer: { flex: 1 },
  windshield: {
    minHeight: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cab: { ...type.label, color: colors.textMuted, textTransform: 'uppercase' },
  body: {
    backgroundColor: colors.text,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingBottom: 8,
  },
  chassis: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 4,
  },
  rail: {
    width: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    marginHorizontal: -4,
  },
  wheel: {
    width: 16,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  wheelRear: { height: 32 },
  sideDoor: {
    width: 10,
    flex: 1,
    maxHeight: 76,
    marginVertical: 12,
    borderRadius: 2,
    backgroundColor: colors.warning,
  },
  hold: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 4,
    padding: 6,
    gap: 6,
  },
  frontRow: { flexDirection: 'row', gap: 6 },
  rear: {
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 4,
    gap: 6,
  },
  doorRow: { flexDirection: 'row', gap: 4, minHeight: 18 },
  doorLeaf: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: colors.warningSoft,
    borderWidth: 2,
    borderColor: colors.warning,
  },
  doorGap: { width: 4, backgroundColor: colors.text },
  doors: { ...type.label, color: colors.textInverse, textAlign: 'center', textTransform: 'uppercase' },
  bay: {
    flex: 1,
    minHeight: 64,
    padding: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  bayWide: { flex: 0, width: '100%' },
  bayCompact: { minHeight: 52 },
  bayEmpty: {
    borderStyle: 'dashed',
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
  },
  bayDoor: { borderColor: colors.warning },
  baySide: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  bayLabel: { ...type.label, color: colors.textMuted, textTransform: 'uppercase' },
  bayLabelSide: { color: colors.warning },
  empty: { ...type.meta, color: colors.textSubtle },
  cargo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 6,
    borderRadius: radius.sm,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  cargoIndex: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  cargoIndexText: { ...type.bodyStrong, fontVariant: ['tabular-nums'] },
  cargoMeta: { flex: 1, gap: 1 },
  cargoWeight: { ...type.secondaryStrong, color: colors.text },
  cargoStack: { ...type.meta, color: colors.textMuted },
  sideDoorCaption: { ...type.meta, color: colors.textMuted, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendSwatch: { width: 14, height: 14, borderRadius: 3 },
  legendLabel: { ...type.secondary, color: colors.textMuted },
  manifest: { gap: spacing.sm },
  manifestTitle: { ...type.label, color: colors.textMuted, textTransform: 'uppercase' },
  manifestRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  manifestBadge: {
    minWidth: 28,
    minHeight: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  manifestBadgeText: { ...type.secondaryStrong, fontVariant: ['tabular-nums'] },
  manifestBody: { flex: 1, gap: 1 },
  manifestLine: { ...type.secondaryStrong, color: colors.text },
  manifestAddress: { ...type.secondary, color: colors.textSecondary },
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
  summary: { ...type.secondary, color: colors.textSecondary },
});
