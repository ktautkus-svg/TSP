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
import { RouteRepository } from '@/database/repositories/route-repository';
import type { Route } from '@/domain/route';
import { spacing } from '@/ui/tokens';
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
            <View style={styles.activeCard} testID="active-route-card">
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
              <Pressable style={styles.primaryButton} onPress={() => {
                const destination = resolveRoute(active);
                router.push({ pathname: destination.pathname, params: destination.params } as Href);
              }}>
                <Text style={styles.primaryButtonText}>{activeRouteAction(active)}</Text>
              </Pressable>
              {__DEV__ || process.env.EXPO_PUBLIC_PILOT_MODE === '1' ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={exporting}
                  onPress={() => void exportActiveDiagnostic()}
                  style={styles.pilotExportButton}
                  testID="active-route-pilot-export"
                >
                  <Text style={styles.pilotExportText}>{exporting ? 'Ruošiama…' : 'Eksportuoti piloto diagnostiką'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyCard}><Text style={styles.activeTitle}>Aktyvaus maršruto nėra</Text><Text style={styles.activeText}>Importuokite dokumentą arba įveskite adresų sąrašą.</Text></View>
          )}
          {!active ? (
            <>
              <Link href={'/import' as Href} asChild><Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>Naujas maršrutas</Text></Pressable></Link>
              <Link href="/route/new" asChild><Pressable style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Įvesti adresus rankiniu būdu</Text></Pressable></Link>
            </>
          ) : null}
          <View style={styles.navigationCard}>
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
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 96, gap: 18, backgroundColor: '#FFFFFF' },
  eyebrow: { color: '#65716A', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  activeCard: { gap: 14, padding: 20, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDE4DF', shadowColor: '#183525', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 3 },
  emptyCard: { gap: 12, padding: 20, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDE4DF', shadowColor: '#183525', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 3 },
  activeHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  activeHeaderText: { flex: 1, minWidth: 0, gap: 4 },
  activeTitle: { color: '#17251D', fontSize: 21, lineHeight: 26, fontWeight: '900' },
  activeText: { color: '#65716A', fontSize: 15, lineHeight: 21 },
  progressBadge: { color: '#0A5A31', fontSize: 30, lineHeight: 34, fontWeight: '900' },
  routeSummary: { borderRadius: 16, backgroundColor: '#EDF5EE', paddingHorizontal: 16, paddingVertical: 6 },
  summaryRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  summaryNumbers: { alignItems: 'flex-end', gap: 2 },
  summaryDivider: { height: 1, backgroundColor: '#D7E3D9' },
  summaryLabel: { color: '#526158', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  summaryValue: { color: '#17251D', fontSize: 22, lineHeight: 25, fontWeight: '900', textAlign: 'right' },
  summaryRemaining: { color: '#0A5A31', fontSize: 14, fontWeight: '800', textAlign: 'right' },
  summaryNote: { color: '#65716A', fontSize: 13, lineHeight: 18 },
  progressTrack: { height: 9, borderRadius: 5, overflow: 'hidden', backgroundColor: '#DDE4DF' },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: '#6A973D' },
  warningText: { color: '#9B6A16', fontWeight: '800' },
  primaryButton: { minHeight: 60, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#073B22' },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  secondaryButton: { minHeight: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#C9D4CD' },
  secondaryButtonText: { color: '#17251D', fontSize: 16, fontWeight: '700' },
  pilotExportButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  pilotExportText: { color: colors.primary, fontWeight: '800' },
  navigationCard: { flexDirection: 'row', gap: 12 },
  navigationButton: { flex: 1, minHeight: 58, borderRadius: 10, borderWidth: 1, borderColor: '#C9D4CD', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  historyLink: { color: '#0A5A31', fontWeight: '900', fontSize: 16 },
});
