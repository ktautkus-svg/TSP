import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { FoundationScreen } from '@/components/foundation-screen';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { ChevronDownIcon, ChevronRightIcon } from '@/components/app-icons';
import { RouteListCard } from '@/components/route-list-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { formatWeightKg } from '@/ui/format-weight';
import { formatLithuanianDate, routeStatusLabel } from '@/ui/history-labels';
import { groupRouteCodes, routeCodeLabel, type RouteCodeRow } from '@/ui/route-numbers';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { pullAssignedRoutes, pushCompletedRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { devWarn } from '@/ui/dev-log';

export default function RoutesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const wideLayout = width >= 720;
  const contentWidth = width >= 1100 ? 980 : wideLayout ? 720 : 430;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [operationalRoutes, setOperationalRoutes] = useState<Route[]>([]);
  const [historyRoutes, setHistoryRoutes] = useState<Route[]>([]);
  const [routeCodes, setRouteCodes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    const refresh = async () => {
      if (profile.role === 'driver') {
        if (online) {
          await pushCompletedRouteAssignmentProgress(db).catch((reason) => {
            devWarn('ROUTES_COMPLETION_PUSH_FAILED', reason);
          });
        }
        await pullAssignedRoutes(db, profile).catch((reason) => {
          devWarn('ROUTES_ASSIGNMENT_PULL_FAILED', reason);
        });
      }
      const owner = profile.role === 'driver' ? profile.id : null;
      const [operational, history, codeRows] = await Promise.all([
        repository.listOperational(owner),
        repository.listHistory(50, owner),
        db.getAllAsync<RouteCodeRow>(`SELECT DISTINCT route_id, route_code FROM shipment_lines WHERE route_code IS NOT NULL AND TRIM(route_code) <> ''`),
      ]);
      if (!mounted) return;
      setOperationalRoutes(operational);
      setHistoryRoutes(history);
      setRouteCodes(groupRouteCodes(codeRows));
      setError(null);
    };
    void refresh().catch((reason) => {
      devWarn('ROUTES_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Maršrutų atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [db, online, profile, repository]));

  const goHome = () => router.replace(roleHomePath(profile.role) as Href);
  const activeRoutes = operationalRoutes.filter((route) => ['loading', 'loaded', 'in_progress'].includes(route.status));
  const plannedRoutes = operationalRoutes.filter((route) => !['loading', 'loaded', 'in_progress'].includes(route.status));
  const plannedGroups = groupRoutesByDate(plannedRoutes);
  const historyGroups = groupHistoryByMonth(historyRoutes);
  const openOperationalRoute = (route: Route, editOrder = false) => {
    router.push({ pathname: '/route/[id]/overview', params: { id: route.id, ...(editOrder ? { edit: 'order' } : {}) } } as unknown as Href);
  };
  const startOperationalRoute = (route: Route) => {
    const destination = resolveRoute(route);
    router.push({ pathname: destination.pathname, params: destination.params } as Href);
  };
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[styles.screen, { maxWidth: contentWidth }]}>
        <FoundationScreen contentMaxWidth={contentWidth} showFoundationNotice={false} title="Maršrutai" description="Vykdomi, suplanuoti ir užbaigti maršrutai aiškiai atskirti.">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {activeRoutes.length > 0 ? <Text style={styles.sectionLabel}>VYKDOMA DABAR</Text> : null}
          <View style={[styles.routeGrid, wideLayout && styles.routeGridWide]}>
          {activeRoutes.map((route) => <RouteListCard
            actionLabel={route.status === 'in_progress' ? 'Tęsti' : 'Pradėti'}
            dateLabel={formatLithuanianDate(route.date)}
            distanceLabel={`${route.estimatedDistanceKm?.toFixed(1) ?? '—'} km`}
            key={route.id}
            numberLabel={routeCodeLabel(route.id, routeCodes)}
            onPress={() => startOperationalRoute(route)}
            onSecondaryPress={() => openOperationalRoute(route, ['planned', 'in_progress'].includes(route.status))}
            secondaryActionLabel={['planned', 'in_progress'].includes(route.status) ? 'Redaguoti' : 'Informacija'}
            statusLabel={operationalRouteLabel(route)}
            statusTone={route.status === 'in_progress' ? 'active' : 'planned'}
            style={wideLayout ? styles.routeCardWide : undefined}
            stopsLabel={String(route.totalStops)}
            testID={`operational-route-${route.id}`}
            weightLabel={`${formatWeightKg(route.totalWeightKg)} kg`}
          />)}
          </View>

          {plannedRoutes.length > 0 ? <CollapsibleRouteGroup
            count={plannedRoutes.length}
            description={`${plannedGroups.length} ${plannedGroups.length === 1 ? 'data' : 'datos'} · atverkite tik kai reikia`}
            expanded={plannedOpen}
            onPress={() => setPlannedOpen((current) => !current)}
            styles={styles}
            testID="planned-routes-group"
            title="Suplanuoti maršrutai">
            {plannedGroups.map((group) => <View key={group.key} style={styles.dateGroup}>
              <View style={styles.dateGroupHeading}><Text style={styles.dateGroupTitle}>{formatLithuanianDate(group.key)}</Text><Text style={styles.groupCount}>{group.routes.length}</Text></View>
              <View style={[styles.routeGrid, wideLayout && styles.routeGridWide]}>{group.routes.map((route) => <RouteListCard
                actionLabel="Pradėti"
                dateLabel={formatLithuanianDate(route.date)}
                distanceLabel={`${route.estimatedDistanceKm?.toFixed(1) ?? '—'} km`}
                key={route.id}
                numberLabel={routeCodeLabel(route.id, routeCodes)}
                onPress={() => startOperationalRoute(route)}
                onSecondaryPress={() => openOperationalRoute(route, ['planned', 'in_progress'].includes(route.status))}
                secondaryActionLabel={['planned', 'in_progress'].includes(route.status) ? 'Redaguoti' : 'Informacija'}
                statusLabel={operationalRouteLabel(route)}
                statusTone="planned"
                style={wideLayout ? styles.routeCardWide : undefined}
                stopsLabel={String(route.totalStops)}
                testID={`operational-route-${route.id}`}
                weightLabel={`${formatWeightKg(route.totalWeightKg)} kg`}
              />)}</View>
            </View>)}
          </CollapsibleRouteGroup> : null}

          {historyRoutes.length > 0 ? <CollapsibleRouteGroup
            count={historyRoutes.length}
            description={`${historyGroups.length} ${historyGroups.length === 1 ? 'mėnuo' : 'mėnesiai'} · užbaigti ir atšaukti maršrutai`}
            expanded={historyOpen}
            onPress={() => setHistoryOpen((current) => !current)}
            styles={styles}
            testID="completed-routes-history"
            title="Užbaigtų maršrutų istorija">
            {historyGroups.map((group) => <View key={group.key} style={styles.dateGroup}>
              <View style={styles.dateGroupHeading}><Text style={styles.dateGroupTitle}>{group.label}</Text><Text style={styles.groupCount}>{group.routes.length}</Text></View>
              <View style={[styles.routeGrid, wideLayout && styles.routeGridWide]}>{group.routes.map((route) => (
              <RouteListCard
                actionLabel="Peržiūrėti rezultatą"
                dateLabel={formatLithuanianDate(route.date)}
                distanceLabel={`${(route.actualDistanceKm ?? route.estimatedDistanceKm)?.toFixed(1) ?? '—'} km`}
                key={route.id}
                numberLabel={routeCodeLabel(route.id, routeCodes)}
                onPress={() => router.push(`/history/${route.id}` as Href)}
                statusLabel={routeStatusLabel(route.status)}
                statusTone={route.status === 'completed' ? 'completed' : 'cancelled'}
                style={wideLayout ? styles.routeCardWide : undefined}
                stopsLabel={String(route.totalStops)}
                testID={`history-route-${route.id}`}
                weightLabel={`${formatWeightKg(route.totalWeightKg)} kg`}
              />
              ))}</View>
            </View>)}
          </CollapsibleRouteGroup> : null}

          {operationalRoutes.length === 0 && historyRoutes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.title}>Maršrutų dar nėra</Text>
              <Text style={styles.meta}>Priskirti, suplanuoti ir užbaigti maršrutai atsiras čia.</Text>
            </View>
          ) : null}

          {profile.role !== 'driver' ? <Pressable accessibilityLabel="Grįžti į skydelį" accessibilityRole="button" style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į skydelį</Text></Pressable> : null}
        </FoundationScreen>
        {profile.role === 'driver' ? <DriverAppTabs active="routes" /> : null}
      </View>
    </>
  );
}

function CollapsibleRouteGroup({ children, count, description, expanded, onPress, styles, testID, title }: {
  children: ReactNode;
  count: number;
  description: string;
  expanded: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  testID: string;
  title: string;
}) {
  return <View style={styles.collapsibleGroup} testID={testID}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => [styles.collapsibleHeader, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Text style={styles.collapsibleDescription}>{description}</Text>
      </View>
      <Text style={styles.collapsibleCount}>{count}</Text>
      {expanded ? <ChevronDownIcon size={20} /> : <ChevronRightIcon size={20} />}
    </Pressable>
    {expanded ? <View style={styles.collapsibleContent}>{children}</View> : null}
  </View>;
}

function groupRoutesByDate(routes: Route[]): { key: string; routes: Route[] }[] {
  const groups = new Map<string, Route[]>();
  for (const route of routes) groups.set(route.date, [...(groups.get(route.date) ?? []), route]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, grouped]) => ({ key, routes: grouped }));
}

function groupHistoryByMonth(routes: Route[]): { key: string; label: string; routes: Route[] }[] {
  const groups = new Map<string, Route[]>();
  for (const route of routes) {
    const source = route.completedAt ?? route.cancelledAt ?? route.date;
    const key = source.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([key, grouped]) => ({
    key,
    label: formatHistoryMonth(key),
    routes: grouped,
  }));
}

function formatHistoryMonth(value: string): string {
  const date = new Date(`${value}-01T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('lt-LT', { timeZone: 'Europe/Vilnius', year: 'numeric', month: 'long' }).format(date);
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
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  collapsibleGroup: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  collapsibleHeader: { minHeight: 72, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  collapsibleTitle: { ...type.sectionTitle, color: colors.text },
  collapsibleDescription: { ...type.secondary, color: colors.textMuted, marginTop: 2 },
  collapsibleCount: { minWidth: 34, textAlign: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, overflow: 'hidden', ...type.secondaryStrong, color: colors.info, backgroundColor: colors.infoSoft },
  collapsibleContent: { padding: spacing.md, paddingTop: 0, gap: spacing.lg },
  dateGroup: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  dateGroupHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  dateGroupTitle: { ...type.bodyStrong, color: colors.text },
  groupCount: { ...type.secondaryStrong, color: colors.textMuted },
  empty: { padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  sectionLabel: { ...type.label, color: colors.textMuted, marginTop: spacing.sm },
  title: { ...type.sectionTitle, color: colors.text },
  meta: { ...type.secondary, color: colors.textMuted },
  homeButton: { minHeight: 52, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  homeText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 96, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.brandNavy, fontFamily: fonts.heading },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
});
