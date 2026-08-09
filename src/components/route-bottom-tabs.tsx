import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { fonts } from '@/ui/tokens';

export type RouteBottomTab = 'dashboard' | 'stops' | 'history';

export function RouteBottomTabs(props: {
  active: RouteBottomTab;
  onDashboard: () => void;
  onStops: () => void;
  onHistory: () => void;
}) {
  const tabs = [
    { key: 'dashboard', label: 'SKYDELIS', onPress: props.onDashboard },
    { key: 'stops', label: 'STOTELĖS', onPress: props.onStops },
    { key: 'history', label: 'ISTORIJA', onPress: props.onHistory },
  ] as const;

  return (
    <View style={styles.tabBar} testID="route-bottom-tabs">
      {tabs.map((tab) => {
        const active = props.active === tab.key;
        return (
          <Pressable
            accessibilityRole="button"
            key={tab.key}
            onPress={tab.onPress}
            style={[styles.tabItem, active && styles.tabItemActive]}>
            <Svg width={23} height={23} viewBox="0 0 24 24">
              {tab.key === 'dashboard' ? (
                <Path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" fill={active ? '#0A5A31' : '#777E79'} />
              ) : tab.key === 'stops' ? (
                <>
                  <Path d="M12 21s6-5.2 6-12A6 6 0 0 0 6 9c0 6.8 6 12 6 12Z" fill="none" stroke={active ? '#0A5A31' : '#777E79'} strokeWidth={1.8} />
                  <Circle cx={12} cy={9} fill={active ? '#0A5A31' : '#777E79'} r={2.2} />
                </>
              ) : (
                <>
                  <Circle cx={12} cy={12} fill="none" r={8} stroke={active ? '#0A5A31' : '#777E79'} strokeWidth={1.8} />
                  <Path d="M12 7v5l-3 2M4 6v4h4" fill="none" stroke={active ? '#0A5A31' : '#777E79'} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
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
    maxWidth: 430,
    minHeight: 52,
    flexShrink: 0,
    paddingBottom: 2,
    borderTopWidth: 1,
    borderTopColor: '#E2E5E1',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1, borderTopWidth: 2, borderTopColor: 'transparent' },
  tabItemActive: { borderTopColor: '#0A5A31' },
  tabLabel: { color: '#777E79', fontFamily: fonts.headingSemiBold, fontSize: 9 },
  tabLabelActive: { color: '#0A5A31' },
});
