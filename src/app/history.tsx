import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { formatLithuanianDate, routeStatusLabel } from '@/ui/history-labels';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function HistoryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void repository.listHistory().then((history) => {
      if (!mounted) return;
      setRoutes(history);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('ROUTE_HISTORY_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Istorijos atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [repository]));

  const goHome = () => router.replace('/' as Href);

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
      headerRight: () => null,
    }} />
    <FoundationScreen showFoundationNotice={false} title="Maršrutų istorija" description="Užbaigti ir atšaukti maršrutai. Užbaigti duomenys yra tik skaitomi.">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {routes.length === 0 ? <View style={styles.empty}><Text style={styles.title}>Istorija tuščia</Text><Text style={styles.meta}>Užbaigti maršrutai atsiras čia.</Text></View> : null}
      {routes.map((route) => {
        const summary = route.completionSummary;
        return (
          <Pressable key={route.id} testID={`history-route-${route.id}`} style={styles.card} onPress={() => router.push(`/history/${route.id}` as Href)}>
            <Text style={styles.title}>{formatLithuanianDate(route.date)} · {routeStatusLabel(route.status)}</Text>
            <Text style={styles.meta}>Taškai: {route.totalStops} · sėkmingi {summary?.deliveredStops ?? 0} · nepavykę {summary?.failedStops ?? 0}</Text>
            <Text style={styles.meta}>Žinomas svoris: {route.totalWeightKg.toFixed(1)} kg</Text>
            <Text style={styles.meta}>Planuota: {route.estimatedDistanceKm?.toFixed(1) ?? '—'} km · faktinė: {route.actualDistanceKm?.toFixed(1) ?? '—'} km</Text>
          </Pressable>
        );
      })}
      <Pressable style={styles.homeButton} onPress={goHome}><Text style={styles.homeText}>Į pradžią</Text></Pressable>
    </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  empty: { padding: spacing.lg, borderRadius: 16, backgroundColor: colors.surface },
  card: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.textMuted, lineHeight: 20 },
  homeButton: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  homeText: { color: colors.primary, fontWeight: '800' },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.primary, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
});
