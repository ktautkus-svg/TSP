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

type HistoryFilter = 'planned' | 'active' | 'done';

const ACTIVE_STATUSES = new Set(['loading', 'loaded', 'in_progress', 'draft']);

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [operational, setOperational] = useState<Route[]>([]);
  const [history, setHistory] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>('done');
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void Promise.all([
      repository.listOperational(),
      repository.listHistory(),
      repository.getActive(),
    ]).then(([ops, done, active]) => {
      if (!mounted) return;
      setOperational(ops);
      setHistory(done);
      setActiveRoute(active);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('ROUTE_HISTORY_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Istorijos atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [repository]));

  const plannedRoutes = useMemo(
    () => operational.filter((route) => route.status === 'planned'),
    [operational],
  );
  const activeRoutes = useMemo(
    () => operational.filter((route) => ACTIVE_STATUSES.has(route.status)),
    [operational],
  );

  const visibleRoutes = filter === 'planned'
    ? plannedRoutes
    : filter === 'active'
      ? activeRoutes
      : history;

  const goHome = () => router.replace('/' as Href);
  const openRoute = (route: Route) => {
    if (route.status === 'completed' || route.status === 'cancelled') {
      router.push(`/history/${route.id}` as Href);
      return;
    }
    const destination = resolveRoute(route);
    router.push({ pathname: destination.pathname, params: destination.params } as Href);
  };
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

  const emptyCopy = filter === 'planned'
    ? { title: 'Nėra suplanuotų', meta: 'Atidėti ar patvirtinti maršrutai atsiras čia.' }
    : filter === 'active'
      ? { title: 'Nėra aktyvių', meta: 'Krovimo ar vykdomi maršrutai atsiras čia.' }
      : { title: 'Istorija tuščia', meta: 'Užbaigti maršrutai atsiras čia.' };

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
      headerRight: () => null,
    }} />
    <View style={styles.screen}>
    <FoundationScreen showFoundationNotice={false} title="Maršrutai" description="Suplanuoti, aktyvūs ir užbaigti maršrutai.">
      <View style={styles.filterRow}>
        <Pressable
          testID="history-filter-planned"
          onPress={() => setFilter('planned')}
          style={[styles.filterChip, filter === 'planned' && styles.filterChipActive]}>
          <Text style={[styles.filterText, filter === 'planned' && styles.filterTextActive]}>
            Suplanuoti ({plannedRoutes.length})
          </Text>
        </Pressable>
        <Pressable
          testID="history-filter-active"
          onPress={() => setFilter('active')}
          style={[styles.filterChip, filter === 'active' && styles.filterChipActive]}>
          <Text style={[styles.filterText, filter === 'active' && styles.filterTextActive]}>
            Aktyvūs ({activeRoutes.length})
          </Text>
        </Pressable>
        <Pressable
          testID="history-filter-done"
          onPress={() => setFilter('done')}
          style={[styles.filterChip, filter === 'done' && styles.filterChipActive]}>
          <Text style={[styles.filterText, filter === 'done' && styles.filterTextActive]}>
            Užbaigti ({history.length})
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {visibleRoutes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.title}>{emptyCopy.title}</Text>
          <Text style={styles.meta}>{emptyCopy.meta}</Text>
        </View>
      ) : null}
      {visibleRoutes.map((route) => {
        const summary = route.completionSummary;
        const isDone = route.status === 'completed' || route.status === 'cancelled';
        return (
          <Pressable key={route.id} testID={`history-route-${route.id}`} style={styles.card} onPress={() => openRoute(route)}>
            <View style={[
              styles.statusStripe,
              route.status === 'completed' ? styles.statusStripeCompleted
                : route.status === 'cancelled' ? styles.statusStripeCancelled
                  : route.status === 'planned' ? styles.statusStripePlanned
                    : styles.statusStripeActive,
            ]} />
            <View style={styles.cardBody}>
              <Text style={styles.title}>{formatLithuanianDate(route.date)} · {routeStatusLabel(route.status)}</Text>
              {isDone ? (
                <Text style={styles.meta}>Taškai: {route.totalStops} · sėkmingi {summary?.deliveredStops ?? 0} · nepavykę {summary?.failedStops ?? 0}</Text>
              ) : (
                <Text style={styles.meta}>Taškai: {route.totalStops} · likę {route.remainingStops}</Text>
              )}
              <Text style={styles.meta}>Žinomas svoris: {formatWeightKg(route.totalWeightKg)} kg</Text>
              <Text style={styles.meta}>Planuota: {route.estimatedDistanceKm?.toFixed(1) ?? '—'} km · faktinė: {route.actualDistanceKm?.toFixed(1) ?? '—'}</Text>
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
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterChip: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { borderColor: colors.brandNavy, backgroundColor: colors.infoSoft },
  filterText: { ...type.secondaryStrong, color: colors.textSecondary },
  filterTextActive: { color: colors.brandNavy },
  empty: { padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.surface },
  card: { flexDirection: 'row', overflow: 'hidden', borderWidth: 1, borderRadius: radius.md, borderColor: colors.border, backgroundColor: colors.surface },
  statusStripe: { width: 5 },
  statusStripeCompleted: { backgroundColor: colors.accent },
  statusStripeCancelled: { backgroundColor: colors.border },
  statusStripePlanned: { backgroundColor: colors.info },
  statusStripeActive: { backgroundColor: colors.warning },
  cardBody: { flex: 1, padding: spacing.md, gap: spacing.xs },
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  homeButton: { minHeight: 52, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  homeText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.textInverse, fontFamily: fonts.heading },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
});
