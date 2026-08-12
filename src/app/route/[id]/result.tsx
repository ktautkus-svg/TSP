import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { FoundationScreen } from '@/components/foundation-screen';
import { AppButton } from '@/components/ui-primitives';
import { RouteResultSummary } from '@/components/route-result-summary';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { spacing, type } from '@/ui/tokens';
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
          <RouteResultSummary
            actualDistance={`${route.actualDistanceKm?.toFixed(1) ?? '—'} km`}
            deliveredStops={route.completionSummary?.deliveredStops ?? 0}
            distanceDeviation={formatSigned(route.completionSummary?.distanceDeviationKm, 'km', 1)}
            duration={formatMinutes(route.completionSummary?.actualDurationMinutes)}
            durationDeviation={formatSigned(route.completionSummary?.durationDeviationMinutes, 'min')}
            endOdometer={route.endOdometer == null ? 'neįvestas' : String(route.endOdometer)}
            failedStops={route.completionSummary?.failedStops ?? 0}
            plannedDistance={`${route.estimatedDistanceKm?.toFixed(1) ?? '—'} km`}
            startOdometer={route.startOdometer == null ? 'neįvestas' : String(route.startOdometer)}
          />
        ) : null}
        {route ? (
          <AppButton label="Peržiūrėti maršrutą" onPress={() => router.replace(`/history/${route.id}` as Href)} />
        ) : null}
        <AppButton label="Į pradžią" onPress={goHome} variant="secondary" />
      </FoundationScreen>
    </>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minWidth: 84, minHeight: 44, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.textInverse },
  error: { ...type.secondaryStrong, color: colors.danger },
});

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return hours > 0 ? `${hours} val. ${minutes} min.` : `${minutes} min.`;
}

function formatSigned(value: number | null | undefined, unit: string, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)} ${unit}`;
}
