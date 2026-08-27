import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, fonts } from '@/ui/tokens';

export type RouteBottomTab = 'dashboard' | 'stops' | 'contacts';

export interface RouteBottomTabsProps {
  readonly active: RouteBottomTab;
  readonly onDashboard: () => void;
  readonly onStops: () => void;
  readonly onContacts: () => void;
}

export function RouteBottomTabs(props: RouteBottomTabsProps) {
  const { width } = useWindowDimensions();
  const barWidth = width >= 1100 ? 1120 : width >= 720 ? 760 : 430;
  const tabs = [
    { key: 'dashboard', label: 'Skydelis', onPress: props.onDashboard },
    { key: 'stops', label: 'Stotelės', onPress: props.onStops },
    { key: 'contacts', label: 'Kontaktai', onPress: props.onContacts },
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
                <Path
                  d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9c.3-.3.7-.4 1.1-.2 1.1.4 2.3.6 3.6.6.6 0 1.1.5 1.1 1.1v3.4c0 .6-.5 1.1-1.1 1.1C9.7 20.5 3.5 14.3 3.5 6.3c0-.6.5-1.1 1.1-1.1H8c.6 0 1.1.5 1.1 1.1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1.1L6.6 10.8Z"
                  fill="none"
                  stroke={active ? colors.primary : colors.textMuted}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                />
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
