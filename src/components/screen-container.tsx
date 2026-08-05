import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { layout } from '@/ui/tokens';

export function ScreenContainer({ children }: PropsWithChildren) {
  return (
    <View style={styles.outer}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    width: '100%',
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    overflow: 'hidden',
  },
});
