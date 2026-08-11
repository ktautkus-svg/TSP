import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { RouteBottomTabs } from '@/components/route-bottom-tabs';
import { resolveRoute } from '@/application/routes/route-navigation';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { formatLithuanianDate, routeStatusLabel } from '@/ui/history-labels';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { formatWeightKg } from '@/ui/format-weight';

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([repository.listHistory(), repository.getActive()]).then(([history, active]) => {
      if (!mounted) return;
      setRoutes(history);
      setActiveRoute(active);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('ROUTE_HISTORY_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Istorijos atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [repository]));

  const goHome = () => router.replace('/' as Href);
  const goActiveDashboard = () => {
    if (!activeRoute) return goHome();
    const destination = resolveRoute(activeRoute);
    router.replace({ pathname: destination.pathname, params: destination.params } as Href);
  };
  const goActiveStops = () => {
    if (!activeRoute) return goHome();
    if (activeRoute.status === 'in_progress') {
      router.replace({ pathname: '/route/[id]/delivery', params: { id: activeRoute.id, view: 'stops' } } as unknown as Href);
      return;
    }
    goActiveDashboard();
  };

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
      headerRight: () => null,
    }} />
    <View style={styles.screen}>
    <FoundationScreen showFoundationNotice={false} title="Maršrutų istorija" description="Užbaigti ir atšaukti maršrutai. Užbaigti duomenys yra tik skaitomi.">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {routes.length === 0 ? <View style={styles.empty}><Text style={styles.title}>Istorija tuščia</Text><Text style={styles.meta}>Užbaigti maršrutai atsiras čia.</Text></View> : null}
      {routes.map((route) => {
        const summary = route.completionSummary;
        return (
          <Pressable key={route.id} testID={`history-route-${route.id}`} style={styles.card} onPress={() => router.push(`/history/${route.id}` as Href)}>
            <View style={[styles.statusStripe, route.status === 'completed' ? styles.statusStripeCompleted : styles.statusStripeCancelled]} />
            <View style={styles.cardBody}>
              <Text style={styles.title}>{formatLithuanianDate(route.date)} · {routeStatusLabel(route.status)}</Text>
              <Text style={styles.meta}>Taškai: {route.totalStops} · sėkmingi {summary?.deliveredStops ?? 0} · nepavykę {summary?.failedStops ?? 0}</Text>
              <Text style={styles.meta}>Žinomas svoris: {formatWeightKg(route.totalWeightKg)} kg</Text>
              <Text style={styles.meta}>Planuota: {route.estimatedDistanceKm?.toFixed(1) ?? '—'} km · faktinė: {route.actualDistanceKm?.toFixed(1) ?? '—'} km</Text>
            </View>
          </Pressable>
        );
      })}
      <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
    </FoundationScreen>
    <RouteBottomTabs active="history" onDashboard={goActiveDashboard} onStops={goActiveStops} onHistory={() => undefined} />
    </View>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 900, backgroundColor: colors.background },
  empty: { padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.surface },
  card: { flexDirection: 'row', overflow: 'hidden', borderWidth: 1, borderRadius: radius.md, borderColor: colors.border, backgroundColor: colors.surface },
  statusStripe: { width: 5 },
  statusStripeCompleted: { backgroundColor: colors.accent },
  statusStripeCancelled: { backgroundColor: colors.border },
  cardBody: { flex: 1, padding: spacing.md, gap: spacing.xs },
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  homeButton: { minHeight: 52, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  homeText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.textInverse, fontFamily: fonts.heading },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
});
