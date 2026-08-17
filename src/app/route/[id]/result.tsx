import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { pushRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { employeeApi, type CompensationBreakdown, type ServerTripSheet } from '@/infrastructure/auth/employee-session';

export default function RouteResultScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const router = useRouter();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compensation, setCompensation] = useState<CompensationBreakdown | null>(null);

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

  useFocusEffect(useCallback(() => {
    if (!online || profile.role !== 'driver') return undefined;
    let active = true;
    void pushRouteAssignmentProgress(db, routeId)
      .catch((reason) => {
        if (__DEV__) console.warn('COMPLETED_ASSIGNMENT_SYNC_FAILED', reason);
      })
      .then(() => active ? requestSync('mutation') : undefined);
    return () => { active = false; };
  }, [db, online, profile.role, requestSync, routeId]));

  useFocusEffect(useCallback(() => {
    if (!online || (profile.role === 'driver' && !profile.permissions?.canViewCompensation)) return undefined;
    let mounted = true;
    void (async () => {
      const response = await employeeApi<{ tripSheets: ServerTripSheet[] }>('/api/trip-sheets');
      const sheet = response.tripSheets.find((item) => item.routeId === routeId);
      if (mounted) setCompensation(sheet?.compensation ?? null);
    })().catch(() => undefined);
    return () => { mounted = false; };
  }, [online, profile.permissions?.canViewCompensation, profile.role, routeId]));

  const goHome = () => router.replace(roleHomePath(profile.role) as Href);

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, title: 'Maršruto rezultatas' }} />
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
        {compensation ? <View style={styles.compensation} testID="route-result-compensation">
          <Text style={styles.compensationLabel}>{compensation.preliminary ? 'PRELIMINARUS DIENOS ATLYGIS' : 'GALUTINIS DIENOS ATLYGIS'}</Text>
          <Text style={styles.compensationValue}>{formatMoney(compensation.totalNetEur)} netto</Text>
          <Text style={styles.compensationMeta}>€23,00 diena + {compensation.distanceKm.toFixed(1)} km + {Math.round(compensation.weightKg)} kg + {compensation.stops} tašk.</Text>
        </View> : null}
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
  headerText: { ...type.button, color: colors.brandNavy },
  error: { ...type.secondaryStrong, color: colors.danger },
  compensation: { padding: spacing.lg, borderRadius: 16, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surface, gap: spacing.xs },
  compensationLabel: { ...type.label, color: colors.success },
  compensationValue: { ...type.pageTitle, color: colors.text },
  compensationMeta: { ...type.secondary, color: colors.textMuted },
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

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`;
}
