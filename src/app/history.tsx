import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { FoundationScreen } from '@/components/foundation-screen';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { RouteListCard } from '@/components/route-list-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { formatWeightKg } from '@/ui/format-weight';
import { formatLithuanianDate, routeStatusLabel } from '@/ui/history-labels';
import { groupRouteNumbers, routeNumberLabel, type RouteNumberRow } from '@/ui/route-numbers';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { useLocalAccess } from '@/application/auth/local-access-context';

export default function RoutesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile } = useLocalAccess();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const wideLayout = width >= 720;
  const contentWidth = width >= 1100 ? 980 : wideLayout ? 720 : 430;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [operationalRoutes, setOperationalRoutes] = useState<Route[]>([]);
  const [historyRoutes, setHistoryRoutes] = useState<Route[]>([]);
  const [routeNumbers, setRouteNumbers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    const owner = profile.role === 'driver' ? profile.id : null;
    void Promise.all([
      repository.listOperational(owner),
      repository.listHistory(50, owner),
      db.getAllAsync<RouteNumberRow>(`SELECT route_id, order_number FROM delivery_stops WHERE order_number IS NOT NULL AND TRIM(order_number) <> ''`),
    ]).then(([operational, history, numberRows]) => {
      if (!mounted) return;
      setOperationalRoutes(operational);
      setHistoryRoutes(history);
      setRouteNumbers(groupRouteNumbers(numberRows));
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('ROUTES_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Maršrutų atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [db, profile.id, profile.role, repository]));

  const goHome = () => router.replace('/' as Href);
  const openOperationalRoute = (route: Route) => {
    const destination = resolveRoute(route);
    router.push({ pathname: destination.pathname, params: destination.params } as Href);
  };

  return (
    <>
      <Stack.Screen options={{
        gestureEnabled: false,
        headerBackVisible: false,
        headerLeft: () => <Pressable accessibilityLabel="Grįžti į skydelį" accessibilityRole="button" onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Skydelis</Text></Pressable>,
        headerRight: () => null,
      }} />
      <View style={[styles.screen, { maxWidth: contentWidth }]}>
        <FoundationScreen contentMaxWidth={contentWidth} showFoundationNotice={false} title="Maršrutai" description="Aktyvūs, būsimi ir ankstesni jūsų maršrutai vienoje vietoje.">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {operationalRoutes.length > 0 ? <Text style={styles.sectionLabel}>DABAR IR TOLIAU</Text> : null}
          <View style={[styles.routeGrid, wideLayout && styles.routeGridWide]}>
          {operationalRoutes.map((route) => <RouteListCard
            actionLabel={route.status === 'in_progress' ? 'Tęsti maršrutą' : 'Peržiūrėti'}
            dateLabel={formatLithuanianDate(route.date)}
            distanceLabel={`${route.estimatedDistanceKm?.toFixed(1) ?? '—'} km`}
            key={route.id}
            numberLabel={routeNumberLabel(route.id, routeNumbers)}
            onPress={() => openOperationalRoute(route)}
            statusLabel={operationalRouteLabel(route)}
            statusTone={route.status === 'in_progress' ? 'active' : 'planned'}
            style={wideLayout ? styles.routeCardWide : undefined}
            stopsLabel={String(route.totalStops)}
            testID={`operational-route-${route.id}`}
            weightLabel={`${formatWeightKg(route.totalWeightKg)} kg`}
          />)}
          </View>

          {historyRoutes.length > 0 ? <Text style={styles.sectionLabel}>ANKSTESNI</Text> : null}
          <View style={[styles.routeGrid, wideLayout && styles.routeGridWide]}>
          {historyRoutes.map((route) => {
            return (
              <RouteListCard
                actionLabel="Peržiūrėti rezultatą"
                dateLabel={formatLithuanianDate(route.date)}
                distanceLabel={`${(route.actualDistanceKm ?? route.estimatedDistanceKm)?.toFixed(1) ?? '—'} km`}
                key={route.id}
                numberLabel={routeNumberLabel(route.id, routeNumbers)}
                onPress={() => router.push(`/history/${route.id}` as Href)}
                statusLabel={routeStatusLabel(route.status)}
                statusTone={route.status === 'completed' ? 'completed' : 'cancelled'}
                style={wideLayout ? styles.routeCardWide : undefined}
                stopsLabel={String(route.totalStops)}
                testID={`history-route-${route.id}`}
                weightLabel={`${formatWeightKg(route.totalWeightKg)} kg`}
              />
            );
          })}
          </View>

          {operationalRoutes.length === 0 && historyRoutes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.title}>Maršrutų dar nėra</Text>
              <Text style={styles.meta}>Priskirti, suplanuoti ir užbaigti maršrutai atsiras čia.</Text>
            </View>
          ) : null}

          <Pressable accessibilityLabel="Grįžti į skydelį" accessibilityRole="button" style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į skydelį</Text></Pressable>
        </FoundationScreen>
        {profile.role === 'driver' ? <DriverAppTabs active="routes" /> : null}
      </View>
    </>
  );
}

function operationalRouteLabel(route: Route): string {
  if (route.status === 'in_progress') return 'Vykdomas';
  if (route.status === 'loaded') return 'Paruoštas';
  if (route.status === 'loading') return 'Kraunamas';
  if (route.status === 'planned') return 'Suplanuotas';
  return 'Ruošiamas';
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  screen: { flex: 1, alignSelf: 'center', width: '100%', backgroundColor: colors.background },
  routeGrid: { gap: spacing.md },
  routeGridWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  routeCardWide: { flexGrow: 1, flexBasis: 320, minWidth: 0, maxWidth: 470 },
  empty: { padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  sectionLabel: { ...type.label, color: colors.textMuted, marginTop: spacing.sm },
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  homeButton: { minHeight: 52, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  homeText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 96, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.textInverse, fontFamily: fonts.heading },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
});
