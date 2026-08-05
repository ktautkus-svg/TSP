import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

export default function RouteResultScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void repository.getById(routeId).then((persisted) => {
      if (!mounted) return;
      if (!persisted) {
        setError('Maršrutas nerastas.');
        return;
      }
      if (persisted.status !== 'completed') {
        const destination = resolveRoute(persisted);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      setRoute(persisted);
      setError(null);
    }).catch((reason) => {
      if (__DEV__) console.warn('ROUTE_RESULT_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Rezultato atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [repository, routeId, router]));

  const goHome = () => router.replace('/' as Href);

  return (
    <>
      <Stack.Screen options={{
        gestureEnabled: false,
        headerBackVisible: false,
        headerLeft: () => <Pressable onPress={goHome} style={styles.headerAction}><Text style={styles.headerText}>← Pradžia</Text></Pressable>,
        headerRight: () => null,
      }} />
      <FoundationScreen showFoundationNotice={false} title="Maršrutas užbaigtas" description="Darbo dienos rezultatas išsaugotas istorijoje.">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {route ? (
          <View style={styles.summary} testID="route-completion-result">
            <Text style={styles.title}>Maršrutas užbaigtas</Text>
            <Text style={styles.meta}>Pristatyta: {route.completionSummary?.deliveredStops ?? 0}</Text>
            <Text style={styles.meta}>Nepavyko pristatyti: {route.completionSummary?.failedStops ?? 0}</Text>
            <Text style={styles.meta}>Faktinis kilometražas: {route.actualDistanceKm?.toFixed(1) ?? '—'} km</Text>
            <Text style={styles.meta}>Planuotas kilometražas: {route.estimatedDistanceKm?.toFixed(1) ?? '—'} km</Text>
            <Text style={styles.meta}>Pradinis odometras: {route.startOdometer ?? 'neįvestas'}</Text>
            <Text style={styles.meta}>Galutinis odometras: {route.endOdometer ?? 'neįvestas'}</Text>
          </View>
        ) : null}
        {route ? (
          <Pressable style={styles.primaryButton} onPress={() => router.replace(`/history/${route.id}` as Href)}>
            <Text style={styles.primaryText}>Peržiūrėti istoriją</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondaryButton} onPress={goHome}>
          <Text style={styles.secondaryText}>Į pradžią</Text>
        </Pressable>
      </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  summary: { padding: spacing.lg, borderRadius: 18, backgroundColor: colors.primarySoft, gap: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: 16, lineHeight: 22 },
  primaryButton: { minHeight: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryButton: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.primary, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
});
