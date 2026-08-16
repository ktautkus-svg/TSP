import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { BackIcon, HomeIcon } from '@/components/app-icons';
import { CloudSyncStatus } from '@/components/cloud-sync-status';
import { colors, fonts, spacing, type } from '@/ui/tokens';

export function StackBackButton({ fallback = '/' }: { readonly fallback?: Href }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const showLabel = width >= 620;
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };
  return (
    <Pressable accessibilityLabel="Atgal" accessibilityRole="button" onPress={goBack} style={styles.action} testID="stack-back">
      <BackIcon />
      {showLabel ? <Text style={styles.label}>Atgal</Text> : null}
    </Pressable>
  );
}

export function StackHeaderActions() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  return (
    <View style={styles.actions}>
      {width >= 760 ? <CloudSyncStatus compact /> : null}
      <Pressable accessibilityLabel="Pradžia" accessibilityRole="button" onPress={() => router.replace('/' as Href)} style={styles.action} testID="stack-home">
        <HomeIcon />
        {width >= 520 ? <Text style={styles.label}>Pradžia</Text> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  action: { minWidth: 44, minHeight: 44, paddingHorizontal: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  label: { ...type.secondary, fontFamily: fonts.headingSemiBold, color: colors.brandNavy },
});
