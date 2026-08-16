import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { TspBrand } from '@/components/tsp-brand';
import { colors, spacing, type } from '@/ui/tokens';

export interface StackBrandTitleProps {
  readonly title?: string;
}

export function StackBrandTitle({ title }: StackBrandTitleProps) {
  const { width } = useWindowDimensions();
  const showTitle = width >= 760;
  return (
    <View style={styles.row}>
      <TspBrand compact inverse={false} />
      {title && showTitle ? <View style={styles.divider} /> : null}
      {title && showTitle ? <Text numberOfLines={1} style={styles.title}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { width: 1, height: 24, backgroundColor: colors.border },
  title: { ...type.secondaryStrong, flexShrink: 1, color: colors.brandNavy },
});
