import { useCallback, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { nextPendingStop, RefreshRouteEtas } from '@/application/routes/route-eta';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import { ExportPilotRouteDiagnostic } from '@/application/routes/pilot-route-export';
import { GetRouteProgress, type RouteProgress } from '@/application/routes/route-workday';
import { ScreenContainer } from '@/components/screen-container';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';
import { etaLabel, legLabel, offlineEtaLabel, scheduleLabel } from '@/ui/route-eta-labels';

let initialActiveRouteRestoreHandled = false;

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [active, setActive] = useState<Route | null>(null);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [nextStop, setNextStop] = useState<DeliveryStop | null>(null);
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
        let route = await repository.getActive();
        if (route?.status === 'in_progress') {
          await new RefreshRouteEtas(db).execute(route.id);
          route = await repository.getById(route.id);
        }
        const nextProgress = route ? await new GetRouteProgress(db).execute(route.id) : null;
        const stops = route ? await repository.getStops(route.id) : [];
        if (!mounted) return;
        setActive(route);
        setProgress(nextProgress);
        setNextStop(nextPendingStop(stops));
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
  }, [db, repository, router]));

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScreenContainer>
        <ScrollView contentContainerStyle={styles.content}>
          <View><Text style={styles.eyebrow}>ŠIANDIEN</Text><Text style={styles.title}>Mano pristatymai</Text></View>
          {active ? (
            <View style={styles.activeCard} testID="active-route-card">
              <Text style={styles.activeTitle}>{activeRouteTitle(active)}</Text>
              {active?.status !== 'in_progress' ? <Text style={styles.activeText}>{active?.totalStops ?? 0} taškai · {(active?.totalWeightKg ?? 0).toFixed(1)} kg žinomo svorio</Text> : null}
              {active?.unknownWeightStops ? <Text style={styles.activeText}>{active.unknownWeightStops} taškų svoris nežinomas</Text> : null}
              {active?.status === 'loading' && progress ? <Text style={styles.activeText}>Pakrauta {progress?.loadedStops ?? 0} / {progress?.totalStops ?? 0} ({progress?.loadingPercent ?? 0}%)</Text> : null}
              {active?.status === 'loaded' ? <Text style={styles.activeText}>{active?.startOdometer === null || active?.startOdometer === undefined ? 'Pradinis odometras neįvestas' : `Pradinis odometras: ${active.startOdometer}`}</Text> : null}
              {active?.status === 'in_progress' && progress ? (
                <>
                  {nextStop ? (
                    <View style={styles.nextStop} testID="dashboard-next-stop">
                      <Text style={styles.nextLabel}>KITAS PRISTATYMAS</Text>
                      <Text style={styles.nextAddress}>{nextStop?.normalizedAddress ?? nextStop?.originalAddress ?? 'Nenurodytas adresas'}</Text>
                      <Text style={styles.nextWeight}>{nextStop?.weightKg === null || nextStop?.weightKg === undefined ? 'Svoris nežinomas' : `${nextStop.weightKg} kg`}</Text>
                      <Text style={styles.nextEta}>{etaLabel(nextStop)}</Text>
                      <Text style={styles.activeText}>{legLabel(nextStop)}</Text>
                      <Text style={styles.nextSchedule}>{scheduleLabel(nextStop)}</Text>
                      {offlineEtaLabel(nextStop) ? <Text style={styles.warningText}>{offlineEtaLabel(nextStop)}</Text> : null}
                    </View>
                  ) : null}
                  {active?.startOdometer === null || active?.startOdometer === undefined ? <Text style={styles.warningText}>Priminimas: įveskite pradinį odometrą</Text> : null}
                </>
              ) : null}
              <Pressable style={styles.primaryButton} onPress={() => {
                const destination = resolveRoute(active);
                router.push({ pathname: destination.pathname, params: destination.params } as Href);
              }}>
                <Text style={styles.primaryButtonText}>{activeRouteAction(active)}</Text>
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={() => {
                Alert.alert('Išvalyti maršrutą?', 'Ar tikrai norite išvalyti šį maršrutą ir pradėti naujo kūrimą?', [
                  { text: 'Ne', style: 'cancel' },
                  { text: 'Taip, išvalyti', style: 'destructive', onPress: () => {
                    void (async () => {
                      try {
                        if (active?.id) {
                          await new CancelDraftRoute(db).execute(active.id);
                        }
                        setActive(null);
                        setProgress(null);
                        setNextStop(null);
                      } catch (err) {
                        Alert.alert('Klaida', err instanceof Error ? err.message : 'Nepavyko išvalyti maršruto.');
                      }
                    })();
                  }},
                ]);
              }}>
                <Text style={styles.cancelButtonText}>Išvalyti ir pradėti iš naujo</Text>
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
          <View style={styles.later}>
            <Text style={styles.laterText}>Statistika, kelionės lapas, transportas ir degalai šiame etape nėra aktyvūs.</Text>
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
  if (route.status === 'planned' || route.status === 'loading') return 'Tęsti krovimą';
  if (route.status === 'loaded') return 'Pradėti maršrutą';
  return route.completionStartedAt ? 'Tęsti užbaigimą' : 'Tęsti maršrutą';
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: 80, gap: spacing.lg },
  eyebrow: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', marginTop: spacing.xs },
  activeCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: 20, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  emptyCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  activeTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  activeText: { color: colors.textMuted, lineHeight: 20 },
  nextStop: { gap: spacing.xs, paddingVertical: spacing.sm },
  nextLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  nextAddress: { color: colors.text, fontSize: 18, fontWeight: '800' },
  nextWeight: { color: colors.text, fontSize: 16, fontWeight: '700' },
  nextEta: { color: colors.primary, fontSize: 17, fontWeight: '800' },
  nextSchedule: { color: colors.text, fontWeight: '700' },
  warningText: { color: colors.warning, fontWeight: '800' },
  primaryButton: { minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  secondaryButton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  pilotExportButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  pilotExportText: { color: colors.primary, fontWeight: '800' },
  navigationCard: { flexDirection: 'row', gap: spacing.sm },
  navigationButton: { flex: 1, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  later: { gap: spacing.sm, padding: spacing.md, borderRadius: 14, backgroundColor: colors.surface },
  historyLink: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  laterText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  cancelButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger ?? '#ef4444', marginTop: spacing.xs },
  cancelButtonText: { color: colors.danger ?? '#ef4444', fontWeight: '800', fontSize: 15 },
});
