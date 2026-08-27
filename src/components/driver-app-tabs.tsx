import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import Svg, { Circle, Path } from 'react-native-svg';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { resolveRoute } from '@/application/routes/route-navigation';
import { RouteRepository } from '@/database/repositories/route-repository';
import { stitchColorsFor } from '@/theme';
import { useTheme } from '@/ui/theme';
import { fonts, radius } from '@/ui/tokens';

type DriverPalette = ReturnType<typeof stitchColorsFor>['driverNow'];

export type DriverAppTab = 'now' | 'continue' | 'statistics' | 'settings';

export interface DriverAppTabsProps {
  /** null when the current screen (e.g. the full route history list) isn't one of these four destinations. */
  readonly active: DriverAppTab | null;
}

export function DriverAppTabs({ active }: DriverAppTabsProps) {
  const router = useRouter();
  const db = useSQLiteContext();
  const { profile } = useLocalAccess();
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const { scheme } = useTheme();
  const palette = stitchColorsFor(scheme).driverNow;
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { width } = useWindowDimensions();
  const barWidth = width >= 1100 ? 900 : width >= 720 ? 720 : 430;
  // "Tęsti" jumps straight into whichever route is currently active, instead
  // of duplicating the "Dabar" screen's own route card via a separate list.
  const [continueHref, setContinueHref] = useState<Href | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void repository.listOperational(profile.id).then((routes) => {
      if (!mounted) return;
      const current = routes[0] ?? null;
      if (!current) { setContinueHref(null); return; }
      const destination = resolveRoute(current);
      setContinueHref({ pathname: destination.pathname, params: destination.params } as Href);
    }).catch(() => { if (mounted) setContinueHref(null); });
    return () => { mounted = false; };
  }, [profile.id, repository]));

  const tabs: readonly { key: DriverAppTab; label: string; href: Href | null }[] = [
    { key: 'now', label: 'Dabar', href: '/' },
    { key: 'continue', label: 'Tęsti', href: continueHref },
    { key: 'statistics', label: 'Statistika', href: '/statistics' },
    { key: 'settings', label: 'Nustatymai', href: '/settings' },
  ];

  return (
    <View style={[styles.tabBar, { maxWidth: barWidth }]} testID="driver-app-tabs">
      {tabs.map((tab) => {
        const selected = active === tab.key;
        const disabled = tab.href === null;
        return (
          <Pressable
            accessibilityLabel={tab.label.toLocaleLowerCase('lt-LT')}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            key={tab.key}
            onPress={() => { if (!selected && tab.href) router.replace(tab.href); }}
            style={[styles.tab, selected && styles.tabActive, disabled && styles.tabDisabled]}>
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
      {tab === 'now' ? <Path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.8} /> : null}
      {tab === 'continue' ? <Path d="M8 5v14l11-7Z" fill={color} /> : null}
      {tab === 'statistics' ? <Path d="M5 20v-6h3v6Zm6 0V5h3v15Zm6 0V10h3v10Z" fill={color} /> : null}
      {tab === 'settings' ? <><Circle cx={12} cy={12} fill="none" r={3.2} stroke={color} strokeWidth={1.8} /><Path d="m12 3 1.2 2.2 2.5.6 2.2-1.1 1.4 1.4-1.1 2.2.6 2.5L21 12l-2.2 1.2-.6 2.5 1.1 2.2-1.4 1.4-2.2-1.1-2.5.6L12 21l-1.2-2.2-2.5-.6-2.2 1.1-1.4-1.4 1.1-2.2-.6-2.5L3 12l2.2-1.2.6-2.5-1.1-2.2 1.4-1.4 2.2 1.1 2.5-.6Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={1.3} /></> : null}
    </Svg>
  );
}

const createStyles = (palette: DriverPalette) => StyleSheet.create({
  tabBar: { alignSelf: 'center', width: '100%', minHeight: 64, flexShrink: 0, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 4 },
  tab: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2, borderRadius: radius.md },
  tabActive: { backgroundColor: palette.routeBlue },
  tabDisabled: { opacity: 0.4 },
  label: { color: palette.muted, fontFamily: fonts.headingSemiBold, fontSize: 12, letterSpacing: 0.1 },
  labelActive: { color: palette.surface },
});
