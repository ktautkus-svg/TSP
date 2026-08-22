import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  vehicleCargoSummary,
  type LoadingBayView,
  type LoadingSchema,
  type VehicleCargoLayout,
} from '@/domain/loading-schema';
import { formatWeightKg } from '@/ui/format-weight';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

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

  return (
    <View style={styles.card} testID="loading-schema-card">
      <Text style={styles.title}>Krovimo schema</Text>
      <Text style={styles.hint}>
        Maršrutas jau sudėliotas — pirmo taško viduryje nedėti. Šoninės durys ir kėbulas imami iš
        priskirto automobilio techninių duomenų.
      </Text>
      <Text style={styles.vehicle} testID="loading-schema-vehicle">
        {vehicleCargoSummary(cargoLayout)}
      </Text>
      <Text style={styles.cab}>Kabina</Text>
      <View style={styles.frontRow}>
        {front.map((bay) => <BayCell key={bay.id} bay={bay} styles={styles} />)}
      </View>
      {rows.map((bay) => (
        <View key={bay.id} style={styles.rowWrap}>
          {bay.sideDoor ? <Text style={styles.sideTag}>Šonas</Text> : null}
          <BayCell bay={bay} styles={styles} wide />
        </View>
      ))}
      <Text style={styles.doors}>Galinės durys</Text>
      <Text style={styles.summary}>{schema.summary}</Text>
    </View>
  );
}

function BayCell({
  bay,
  styles,
  wide = false,
}: {
  bay: LoadingBayView;
  styles: ReturnType<typeof createStyles>;
  wide?: boolean;
}) {
  return (
    <View
      style={[
        styles.bay,
        wide && styles.bayWide,
        bay.nearDoors && styles.bayDoor,
        bay.sideDoor && styles.baySide,
      ]}
      testID={`loading-bay-${bay.id}`}>
      <Text style={[styles.bayLabel, bay.sideDoor && styles.bayLabelSide]}>{bay.label}</Text>
      {bay.placements.length === 0 ? (
        <Text style={styles.empty}>Tuščia</Text>
      ) : bay.placements.map((item) => (
        <Text key={item.stopId} style={styles.item}>
          {item.loadingSequence}. {formatWeightKg(item.weightKg)} kg · {item.stackLabel}
          {item.usePallet ? ' · PLL' : ''}
          {item.sideAccess ? ' · per šoną' : ''}
          {'\n'}
          {shortAddress(item.address)}
        </Text>
      ))}
    </View>
  );
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
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
    gap: spacing.sm,
  },
  title: { ...type.cardTitle, color: colors.text },
  hint: { ...type.secondary, color: colors.textSecondary },
  vehicle: { ...type.secondaryStrong, color: colors.text },
  cab: { ...type.label, color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase' },
  doors: { ...type.label, color: colors.textMuted, textAlign: 'center', textTransform: 'uppercase' },
  frontRow: { flexDirection: 'row', gap: spacing.sm },
  rowWrap: { gap: 4 },
  sideTag: { ...type.label, color: colors.warning, textTransform: 'uppercase' },
  bay: {
    flex: 1,
    minHeight: 56,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    gap: 4,
  },
  bayWide: { flex: 0, width: '100%' },
  bayDoor: { borderColor: colors.info },
  baySide: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  bayLabel: { ...type.label, color: colors.info, textTransform: 'uppercase' },
  bayLabelSide: { color: colors.warning },
  empty: { ...type.secondary, color: colors.textMuted },
  item: { ...type.secondaryStrong, color: colors.text },
  summary: { ...type.secondary, color: colors.textSecondary },
});
