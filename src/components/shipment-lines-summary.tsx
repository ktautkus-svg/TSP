import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ShipmentLine } from '@/domain/shipment-line';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export function ShipmentLinesSummary({ lines }: { lines: ShipmentLine[] }) {
  const [expanded, setExpanded] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!lines.length) return null;
  const knownWeightGrams = lines.reduce((sum, line) => sum + (line.weightGrams ?? 0), 0);
  const unknownWeightCount = lines.filter((line) => line.weightGrams === null).length;
  return (
    <View style={styles.container} testID="shipment-lines-summary">
      <Text style={styles.title}>{lines.length} Excel eilutės · {formatWeight(knownWeightGrams)}</Text>
      {unknownWeightCount ? <Text style={styles.muted}>{unknownWeightCount} eilučių svoris nežinomas</Text> : null}
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => setExpanded((current) => !current)}>
        <Text style={styles.buttonText}>{expanded ? 'Slėpti detales' : 'Rodyti detales'}</Text>
      </Pressable>
      {expanded ? lines.map((line) => (
        <View key={line.id} style={styles.line}>
          <Text style={styles.lineTitle}>Excel eilutė {line.sourceRowNumber}</Text>
          <Text style={styles.muted}>{line.recipient ?? 'Gavėjas nenurodytas'} · {line.weightGrams === null ? 'svoris nežinomas' : formatWeight(line.weightGrams)}</Text>
          {line.deliveryTimeFrom ? <Text style={styles.muted}>Laikas {line.deliveryTimeFrom}{line.deliveryTimeTo ? `–${line.deliveryTimeTo}` : ''}</Text> : null}
        </View>
      )) : null}
    </View>
  );
}

function formatWeight(grams: number): string {
  return `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 3 }).format(grams / 1000)} kg`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  container: { marginTop: spacing.xs, gap: spacing.xs, padding: spacing.sm, borderRadius: 12, backgroundColor: colors.background },
  title: { color: colors.text, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  button: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  buttonText: { color: colors.primary, fontWeight: '800' },
  line: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
  lineTitle: { color: colors.text, fontWeight: '700' },
});
