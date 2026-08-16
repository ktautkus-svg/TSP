import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import { stitchColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';
import { fonts, radius } from '@/ui/tokens';

type DriverPalette = ReturnType<typeof stitchColorsFor>['driverNow'];

export type DriverAppTab = 'now' | 'routes' | 'statistics' | 'settings';

export interface DriverAppTabsProps {
  readonly active: DriverAppTab;
}

const tabs: ReadonlyArray<{ key: DriverAppTab; label: string; href: Href }> = [
  { key: 'routes', label: 'Maršrutai', href: '/history' },
  { key: 'statistics', label: 'Statistika', href: '/statistics' },
  { key: 'settings', label: 'Nustatymai', href: '/settings' },
];

export function DriverAppTabs({ active }: DriverAppTabsProps) {
  const router = useRouter();
  const { scheme } = useTheme();
  const palette = stitchColorsFor(scheme).driverNow;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { width } = useWindowDimensions();
  const barWidth = width >= 1100 ? 900 : width >= 720 ? 720 : 430;
  return (
    <View style={[styles.tabBar, { maxWidth: barWidth }]} testID="driver-app-tabs">
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <Pressable
            accessibilityLabel={tab.label.toLocaleLowerCase('lt-LT')}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={tab.key}
            onPress={() => { if (!selected) router.replace(tab.href); }}
            style={[styles.tab, selected && styles.tabActive]}>
            <TabIcon active={selected} palette={palette} tab={tab.key} />
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TabIcon({ active, palette, tab }: { readonly active: boolean; readonly palette: DriverPalette; readonly tab: DriverAppTab }) {
  const color = active ? palette.surface : palette.muted;
  return (
    <Svg accessibilityLabel="" height={22} viewBox="0 0 24 24" width={22}>
      {tab === 'routes' ? <Path d="M6 4v4m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v8m0 0v4m0-4c7 0 5-8 12-8m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v12" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.8} /> : null}
      {tab === 'statistics' ? <Path d="M5 20v-6h3v6Zm6 0V5h3v15Zm6 0V10h3v10Z" fill={color} /> : null}
      {tab === 'settings' ? <><Circle cx={12} cy={12} fill="none" r={3.2} stroke={color} strokeWidth={1.8} /><Path d="m12 3 1.2 2.2 2.5.6 2.2-1.1 1.4 1.4-1.1 2.2.6 2.5L21 12l-2.2 1.2-.6 2.5 1.1 2.2-1.4 1.4-2.2-1.1-2.5.6L12 21l-1.2-2.2-2.5-.6-2.2 1.1-1.4-1.4 1.1-2.2-.6-2.5L3 12l2.2-1.2.6-2.5-1.1-2.2 1.4-1.4 2.2 1.1 2.5-.6Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.3} /></> : null}
    </Svg>
  );
}

const createStyles = (palette: DriverPalette) => StyleSheet.create({
  tabBar: { alignSelf: 'center', width: '100%', minHeight: 64, flexShrink: 0, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 4 },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2, borderRadius: radius.md },
  tabActive: { backgroundColor: palette.routeBlue },
  label: { color: palette.muted, fontFamily: fonts.headingSemiBold, fontSize: 9, letterSpacing: 0.1 },
  labelActive: { color: palette.surface },
});
