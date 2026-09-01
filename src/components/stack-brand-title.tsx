import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { FiroBrand } from '@/components/firo-brand';
import { colors, spacing, type } from '@/ui/tokens';

export interface StackBrandTitleProps {
  readonly title?: string;
}

export function StackBrandTitle({ title }: StackBrandTitleProps) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { profile } = useLocalAccess();
  const showTitle = width >= 760;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel="Į pradžią"
        accessibilityRole="button"
        onPress={() => router.replace(roleHomePath(profile.role) as Href)}
        style={({ pressed }) => [styles.brandButton, pressed && styles.pressed]}
        testID="stack-brand-home">
        <FiroBrand compact />
      </Pressable>
      {title && showTitle ? <View style={styles.divider} /> : null}
      {title && showTitle ? <Text numberOfLines={1} style={styles.title}>{title}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandButton: { minHeight: 48, minWidth: 84, justifyContent: 'center' },
  pressed: { opacity: 0.72 },
  divider: { width: 1, height: 24, backgroundColor: colors.border },
  title: { ...type.bodyStrong, flexShrink: 1, color: colors.brandNavy },
});
