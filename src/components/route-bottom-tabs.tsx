import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, fonts } from '@/ui/tokens';

export type RouteBottomTab = 'dashboard' | 'stops' | 'routes';

export interface RouteBottomTabsProps {
  readonly active: RouteBottomTab;
  readonly onDashboard: () => void;
  readonly onStops: () => void;
  readonly onRoutes: () => void;
}

export function RouteBottomTabs(props: RouteBottomTabsProps) {
  const { width } = useWindowDimensions();
  const barWidth = width >= 1100 ? 1120 : width >= 720 ? 760 : 430;
  const tabs = [
    { key: 'dashboard', label: 'Skydelis', onPress: props.onDashboard },
    { key: 'stops', label: 'Stotelės', onPress: props.onStops },
    { key: 'routes', label: 'Maršrutai', onPress: props.onRoutes },
  ] as const;

  return (
    <View style={[styles.tabBar, { maxWidth: barWidth }]} testID="route-bottom-tabs">
      {tabs.map((tab) => {
        const active = props.active === tab.key;
        return (
          <Pressable
            accessibilityLabel={tab.label.toLocaleLowerCase('lt-LT')}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={tab.key}
            onPress={tab.onPress}
            style={[styles.tabItem, active && styles.tabItemActive]}>
            <Svg width={23} height={23} viewBox="0 0 24 24">
              {tab.key === 'dashboard' ? (
                <Path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" fill={active ? colors.primary : colors.textMuted} />
              ) : tab.key === 'stops' ? (
                <>
                  <Path d="M12 21s6-5.2 6-12A6 6 0 0 0 6 9c0 6.8 6 12 6 12Z" fill="none" stroke={active ? colors.primary : colors.textMuted} strokeWidth={1.8} />
                  <Circle cx={12} cy={9} fill={active ? colors.primary : colors.textMuted} r={2.2} />
                </>
              ) : (
                <>
                  <Circle cx={12} cy={12} fill="none" r={8} stroke={active ? colors.primary : colors.textMuted} strokeWidth={1.8} />
                  <Path d="M12 7v5l-3 2M4 6v4h4" fill="none" stroke={active ? colors.primary : colors.textMuted} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
                </>
              )}
            </Svg>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    alignSelf: 'center',
    width: '100%',
    minHeight: 56,
    flexShrink: 0,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
  },
  tabItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2, borderTopWidth: 2, borderTopColor: 'transparent' },
  tabItemActive: { borderTopColor: colors.primary },
  tabLabel: { color: colors.textMuted, fontFamily: fonts.headingSemiBold, fontSize: 12, letterSpacing: 0.2 },
  tabLabelActive: { color: colors.primary },
});
