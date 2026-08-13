import { StyleSheet, Text, View } from 'react-native';

import { TspBrand } from '@/components/tsp-brand';
import { colors, spacing, type } from '@/ui/tokens';

export interface StackBrandTitleProps {
  readonly title?: string;
}

export function StackBrandTitle({ title }: StackBrandTitleProps) {
  return (
    <View style={styles.row}>
      <TspBrand compact inverse={false} />
      {title ? <View style={styles.divider} /> : null}
      {title ? <Text numberOfLines={1} style={styles.title}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { width: 1, height: 24, backgroundColor: colors.border },
  title: { ...type.secondaryStrong, flexShrink: 1, color: colors.brandNavy },
});
