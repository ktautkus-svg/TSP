import { useCallback, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { ExportPilotRouteDiagnostic } from '@/application/routes/pilot-route-export';
import { GetRouteProgress, type RouteProgress } from '@/application/routes/route-workday';
import { BrandHeader } from '@/components/brand-header';
import { ScreenContainer } from '@/components/screen-container';
import { AppButton, AppCard } from '@/components/ui-primitives';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { formatWeightKg } from '@/ui/format-weight';
import { Alert } from '@/ui/alert';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { pullAssignedRoutes, pushRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';

let initialActiveRouteRestoreHandled = false;

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [active, setActive] = useState<Route | null>(null);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const initialRestoreHandled = useRef(initialActiveRouteRestoreHandled);

  const exportActiveDiagnostic = async () => {
    if (!active || !active.id || exporting) return;
    setExporting(true);
    try {
      const report = await new ExportPilotRouteDiagnostic(db).executeJson(
        active.id,
        Constants.expoConfig?.version ?? 'unknown',
      );
      await Share.share({ title: `Maršruto ${active.id} diagnostika`, message: report });
    } catch (error) {
      Alert.alert('Eksportas nepavyko', error instanceof Error ? error.message : 'Nežinoma klaida.');
    } finally {
      setExporting(false);
    }
  };

  useFocusEffect(useCallback(() => {
    if (profile.role === 'dispatcher') {
      router.replace('/dispatcher' as Href);
      return () => undefined;
    }
    let mounted = true;
    void (async () => {
      try {
        if (online && profile.role === 'driver') await pullAssignedRoutes(db, profile);
        const route = await repository.getActive();
        const nextProgress = route ? await new GetRouteProgress(db).execute(route.id) : null;
        if (online && route) void pushRouteAssignmentProgress(db, route.id).catch(() => undefined);
        if (!mounted) return;
        setActive(route);
        setProgress(nextProgress);
        if (!initialRestoreHandled.current && route?.status === 'in_progress') {
          initialRestoreHandled.current = true;
          initialActiveRouteRestoreHandled = true;
          const destination = resolveRoute(route);
          router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        } else {
          initialRestoreHandled.current = true;
          initialActiveRouteRestoreHandled = true;
        }
      } catch (error) {
        if (__DEV__) console.warn('ACTIVE_ROUTE_RESTORE_FAILED', error);
      }
    })();
    return () => { mounted = false; };
  }, [db, online, profile, repository, router]));

  return (
    <SafeAreaView style={styles.safeArea}>
      <BrandHeader />
      <ScreenContainer>
        <ScrollView contentContainerStyle={styles.content}>
          {active ? (
            <AppCard style={styles.activeCard}>
              <View style={styles.activeHeader}>
                <View style={styles.activeHeaderText}>
                  <Text style={styles.eyebrow}>AKTYVUS MARŠRUTAS</Text>
                  <Text style={styles.activeTitle}>{activeRouteTitle(active)}</Text>
                </View>
                {active.status === 'in_progress' && progress ? <Text style={styles.progressBadge}>{progress.deliveryPercent}%</Text> : null}
              </View>
              {active?.status !== 'in_progress' ? <Text style={styles.activeText}>{active?.totalStops ?? 0} taškai · {formatWeightKg(active?.totalWeightKg ?? 0)} kg žinomo svorio</Text> : null}
              {active?.unknownWeightStops ? <Text style={styles.activeText}>{active.unknownWeightStops} taškų svoris nežinomas</Text> : null}
              {active?.status === 'loading' && progress ? <Text style={styles.activeText}>Pakrauta {progress?.loadedStops ?? 0} / {progress?.totalStops ?? 0} ({progress?.loadingPercent ?? 0}%)</Text> : null}
              {active?.status === 'loaded' ? <Text style={styles.activeText}>{active?.startOdometer === null || active?.startOdometer === undefined ? 'Pradinis odometras neįvestas' : `Pradinis odometras: ${active.startOdometer}`}</Text> : null}
              {active?.status === 'in_progress' && progress ? (
                <>
                  <View style={styles.routeSummary} testID="dashboard-route-summary">
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>TAŠKAI</Text>
                      <View style={styles.summaryNumbers}>
                        <Text style={styles.summaryValue}>{progress.totalStops}</Text>
                        <Text style={styles.summaryRemaining}>Liko {progress.remainingStops}</Text>
                      </View>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>SVORIS</Text>
                      <View style={styles.summaryNumbers}>
                        <Text style={styles.summaryValue}>{formatWeightKg(progress.totalKnownWeightKg)} kg</Text>
                        <Text style={styles.summaryRemaining}>Liko {formatWeightKg(progress.remainingKnownWeightKg)} kg</Text>
                      </View>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>ATSTUMAS</Text>
                      <View style={styles.summaryNumbers}>
                        <Text style={styles.summaryValue}>{formatMetric(active.estimatedDistanceKm)} km</Text>
                        <Text style={styles.summaryRemaining}>Liko ~{formatMetric(progress.preliminaryRemainingDistanceKm)} km</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress.deliveryPercent}%` }]} /></View>
                  {progress.totalUnknownWeightStops > 0 ? <Text style={styles.summaryNote}>{progress.totalUnknownWeightStops} taškų svoris nenurodytas ir į kg sumą neįtrauktas.</Text> : null}
                  {active?.startOdometer === null || active?.startOdometer === undefined ? <Text style={styles.warningText}>Priminimas: įveskite pradinį odometrą</Text> : null}
                </>
              ) : null}
              <AppButton
                label={activeRouteAction(active)}
                onPress={() => {
                  const destination = resolveRoute(active);
                  router.push({ pathname: destination.pathname, params: destination.params } as Href);
                }}
                testID="active-route-card"
              />
              {__DEV__ || process.env.EXPO_PUBLIC_PILOT_MODE === '1' ? (
                <AppButton
                  disabled={exporting}
                  label={exporting ? 'Ruošiama…' : 'Eksportuoti piloto diagnostiką'}
                  loading={exporting}
                  onPress={() => void exportActiveDiagnostic()}
                  style={styles.pilotExportButton}
                  testID="active-route-pilot-export"
                  variant="secondary"
                />
              ) : null}
            </AppCard>
          ) : (
            <AppCard style={styles.emptyCard}><Text style={styles.activeTitle}>{profile.role === 'driver' ? 'Maršrutas dar nepriskirtas' : 'Aktyvaus maršruto nėra'}</Text><Text style={styles.activeText}>{profile.role === 'driver' ? 'Kai dispečeris priskirs maršrutą, jis automatiškai atsiras šiame įrenginyje.' : 'Importuokite dokumentą arba įveskite adresų sąrašą.'}</Text></AppCard>
          )}
          {!active && (profile.role !== 'driver' || profile.permissions?.canCreateRoutes) ? (
            <>
              <AppButton label="Naujas maršrutas" onPress={() => router.push('/import' as Href)} />
              <AppButton label="Įvesti adresus rankiniu būdu" onPress={() => router.push('/route/new' as Href)} variant="secondary" />
            </>
          ) : null}
          <View style={styles.navigationCard}>
            {profile.role === 'admin' ? <Link href={'/dispatcher' as Href} asChild><Pressable style={styles.navigationButton}><Text style={styles.historyLink}>Dispečeris</Text></Pressable></Link> : null}
            <Link href="/history" asChild><Pressable style={styles.navigationButton}><Text style={styles.historyLink}>Istorija</Text></Pressable></Link>
            <Link href={'/settings' as Href} asChild><Pressable style={styles.navigationButton}><Text style={styles.historyLink}>Nustatymai</Text></Pressable></Link>
          </View>
        </ScrollView>
      </ScreenContainer>
    </SafeAreaView>
  );
}

function activeRouteTitle(route?: Route | null): string {
  if (!route || !route.status) return 'Aktyvaus maršruto nėra';
  if (route.status === 'draft') return 'Ruošiamas maršrutas';
  if (route.status === 'planned') return 'Maršrutas suplanuotas';
  if (route.status === 'loading') return 'Vyksta krovimas';
  if (route.status === 'loaded') return 'Visi taškai pakrauti';
  return 'Aktyvus pristatymo maršrutas';
}

function activeRouteAction(route?: Route | null): string {
  if (!route || !route.status) return 'Naujas maršrutas';
  if (route.status === 'draft') return 'Tęsti paruošimą';
  if (route.status === 'planned') return 'Tęsti suplanuotą maršrutą';
  if (route.status === 'loading') return 'Tęsti krovimą';
  if (route.status === 'loaded') return 'Pradėti maršrutą';
  return route.completionStartedAt ? 'Tęsti užbaigimą' : 'Tęsti maršrutą';
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(value);
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 96, gap: spacing.md },
  eyebrow: { ...type.label, color: colors.textMuted },
  // One card style, one radius, one hairline border. No shadow: the border is
  // enough separation against a light grey page.
  activeCard: { gap: spacing.md },
  emptyCard: { gap: spacing.sm },
  activeHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  activeHeaderText: { flex: 1, minWidth: 0, gap: 2 },
  activeTitle: { ...type.sectionTitle, fontSize: 19, lineHeight: 24, color: colors.text },
  activeText: { ...type.body, color: colors.textMuted },
  progressBadge: { ...type.readout, fontSize: 26, lineHeight: 30, color: colors.primary },
  // Grouping panel, not decoration: it holds three related readouts together.
  routeSummary: { borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing.md, paddingVertical: 2 },
  summaryRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  summaryNumbers: { alignItems: 'flex-end', gap: 1 },
  summaryDivider: { height: 1, backgroundColor: colors.border },
  summaryLabel: { ...type.label, color: colors.textMuted },
  summaryValue: { ...type.readout, color: colors.text, textAlign: 'right' },
  summaryRemaining: { ...type.secondary, color: colors.textMuted, textAlign: 'right' },
  summaryNote: { ...type.meta, color: colors.textMuted },
  progressTrack: { height: 8, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.border },
  progressFill: { height: '100%', borderRadius: radius.sm, backgroundColor: colors.accent },
  warningText: { ...type.bodyStrong, color: colors.warning },
  pilotExportButton: { minHeight: 44 },
  // Tertiary navigation: deliberately quiet so it cannot compete with the
  // primary action above it.
  navigationCard: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  navigationButton: { flex: 1, minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  historyLink: { ...type.secondary, fontFamily: fonts.headingSemiBold, color: colors.textMuted },
});
