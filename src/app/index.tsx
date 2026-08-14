import { useCallback, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import { Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { resolveRoute } from '@/application/routes/route-navigation';
import { ExportPilotRouteDiagnostic } from '@/application/routes/pilot-route-export';
import { GetRouteProgress, type RouteProgress } from '@/application/routes/route-workday';
import { AccountMenuSheet } from '@/components/account-menu-sheet';
import { BrandHeader } from '@/components/brand-header';
import { DriverNowDashboard } from '@/components/driver-now-dashboard';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { ScreenContainer } from '@/components/screen-container';
import { AppButton, AppCard } from '@/components/ui-primitives';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { stitchTheme } from '@/theme';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { formatWeightKg } from '@/ui/format-weight';
import { groupRouteCodes, routeCodeLabel, type RouteCodeRow } from '@/ui/route-numbers';
import { Alert } from '@/ui/alert';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { pullAssignedRoutes, pushCompletedRouteAssignmentProgress, pushRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online } = useLocalAccess();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [active, setActive] = useState<Route | null>(null);
  const [activeStops, setActiveStops] = useState<DeliveryStop[]>([]);
  const [routeCodes, setRouteCodes] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

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
    if (profile.role === 'quality') {
      router.replace('/quality-control' as Href);
      return () => undefined;
    }
    let mounted = true;
    void (async () => {
      try {
        if (online && profile.role === 'driver') {
          await pullAssignedRoutes(db, profile);
          await pushCompletedRouteAssignmentProgress(db);
        }
        await requestSync('home-focus');
        const operational = profile.role === 'admin'
          ? []
          : await repository.listOperational(profile.role === 'driver' ? profile.id : null);
        const route = operational[0] ?? null;
        const nextProgress = route ? await new GetRouteProgress(db).execute(route.id) : null;
        const nextStops = route ? await repository.getStops(route.id) : [];
        if (online && route) void pushRouteAssignmentProgress(db, route.id).catch(() => undefined);
        if (!mounted) return;
        setActive(route);
        const codeRows = await db.getAllAsync<RouteCodeRow>(
          `SELECT DISTINCT route_id, route_code FROM shipment_lines
           WHERE route_code IS NOT NULL AND TRIM(route_code) <> ''`,
        );
        setRouteCodes(groupRouteCodes(codeRows));
        setProgress(nextProgress);
        setActiveStops(nextStops);
      } catch (error) {
        if (__DEV__) console.warn('ACTIVE_ROUTE_RESTORE_FAILED', error);
      }
    })();
    return () => { mounted = false; };
  }, [db, online, profile, repository, requestSync, router]));

  useEffect(() => {
    if (syncRevision === 0) return;
    let mounted = true;
    void (async () => {
      if (online && profile.role === 'driver') await pushCompletedRouteAssignmentProgress(db);
      const operational = profile.role === 'admin'
        ? []
        : await repository.listOperational(profile.role === 'driver' ? profile.id : null);
      const route = operational[0] ?? null;
      const nextProgress = route ? await new GetRouteProgress(db).execute(route.id) : null;
      const nextStops = route ? await repository.getStops(route.id) : [];
      const codeRows = await db.getAllAsync<RouteCodeRow>(
        `SELECT DISTINCT route_id, route_code FROM shipment_lines
         WHERE route_code IS NOT NULL AND TRIM(route_code) <> ''`,
      );
      if (mounted) {
        setActive(route);
        setRouteCodes(groupRouteCodes(codeRows));
        setProgress(nextProgress);
        setActiveStops(nextStops);
      }
    })().catch((reason) => {
      if (__DEV__) console.warn('ACTIVE_ROUTE_SYNC_REFRESH_FAILED', reason);
    });
    return () => { mounted = false; };
  }, [db, online, profile.id, profile.role, repository, syncRevision]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {profile.role === 'driver'
        ? <BrandHeader showNotifications={false} showSyncStatus={false} variant="driver" />
        : <BrandHeader onMenuPress={() => setAccountMenuOpen(true)} />}
      <AccountMenuSheet visible={accountMenuOpen} onClose={() => setAccountMenuOpen(false)} />
      <ScreenContainer>
        <ScrollView contentContainerStyle={[styles.content, profile.role === 'driver' && styles.driverContent]}>
          {profile.role === 'admin' ? (
            <View style={styles.adminMenu} testID="admin-home-menu">
              <View style={styles.adminMenuHeading}>
                <Text style={styles.eyebrow}>ADMINISTRATORIAUS MENIU</Text>
                <Text style={styles.adminMenuTitle}>Pasirinkite darbo sritį</Text>
                <Text style={styles.activeText}>Maršrutai administratoriaus vardu automatiškai nepradedami.</Text>
              </View>
              <View style={styles.adminMenuGrid}>
                <AdminMenuLink href="/dispatcher" label="Dispečeris" styles={styles} />
                <AdminMenuLink href="/quality-control" label="Kokybės kontrolė" styles={styles} />
                <AdminMenuLink href="/execute-route" label="Vykdyti maršrutą" primary styles={styles} />
                <AdminMenuLink href="/history" label="Maršrutai" styles={styles} />
                <AdminMenuLink href="/settings" label="Nustatymai" styles={styles} />
              </View>
            </View>
          ) : profile.role === 'driver' ? active && progress ? (
            <DriverNowDashboard
              onContinue={() => {
                const destination = resolveRoute(active);
                router.push({ pathname: destination.pathname, params: destination.params } as Href);
              }}
              onOpenMap={() => {
                const destination = resolveRoute(active);
                router.push({ pathname: destination.pathname, params: destination.params } as Href);
              }}
              progress={progress}
              route={active}
              routeLabel={routeCodeLabel(active.id, routeCodes)}
              stops={activeStops}
            />
          ) : (
            <AppCard style={styles.emptyCard}>
              <Text style={styles.activeTitle}>Maršrutas dar nepriskirtas</Text>
              <Text style={styles.activeText}>Kai administratorius priskirs maršrutą, jis automatiškai atsiras šiame įrenginyje.</Text>
            </AppCard>
          ) : active ? (
            <AppCard style={styles.activeCard} testID="active-route-card">
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
            <AppCard style={styles.emptyCard}><Text style={styles.activeTitle}>Aktyvaus maršruto nėra</Text><Text style={styles.activeText}>Importuokite dokumentą arba įveskite adresų sąrašą.</Text></AppCard>
          )}
          {!active && profile.role !== 'driver' && profile.role !== 'admin' ? (
            <>
              <AppButton label="Naujas maršrutas" onPress={() => router.push('/import' as Href)} />
              <AppButton label="Įvesti adresus rankiniu būdu" onPress={() => router.push('/route/new' as Href)} variant="secondary" />
            </>
          ) : null}
          {profile.role !== 'driver' && profile.role !== 'admin' ? <View style={styles.navigationCard}>
            <Link href="/history" asChild><Pressable style={styles.navigationButton}><Text style={styles.historyLink}>Maršrutai</Text></Pressable></Link>
            <Link href={'/settings' as Href} asChild><Pressable style={styles.navigationButton}><Text style={styles.historyLink}>Nustatymai</Text></Pressable></Link>
          </View> : null}
        </ScrollView>
      </ScreenContainer>
      {profile.role === 'driver' ? <DriverAppTabs active="now" /> : null}
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

function AdminMenuLink({ href, label, primary = false, styles }: {
  href: string;
  label: string;
  primary?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return <Link href={href as Href} asChild>
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      style={({ pressed }) => [styles.adminMenuButton, primary && styles.adminMenuButtonPrimary, pressed && styles.adminMenuButtonPressed]}>
      <Text style={[styles.adminMenuButtonText, primary && styles.adminMenuButtonTextPrimary]}>{label}</Text>
      <Text style={[styles.adminMenuArrow, primary && styles.adminMenuButtonTextPrimary]}>→</Text>
    </Pressable>
  </Link>;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 96, gap: spacing.md },
  driverContent: { paddingTop: spacing.sm, backgroundColor: stitchTheme.driverNow.background },
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
  adminMenu: { gap: spacing.lg },
  adminMenuHeading: { gap: spacing.xs },
  adminMenuTitle: { ...type.pageTitle, color: colors.text, fontSize: 28, lineHeight: 34 },
  adminMenuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  adminMenuButton: { minWidth: 230, flexBasis: 230, flexGrow: 1, minHeight: 72, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  adminMenuButtonPrimary: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  adminMenuButtonPressed: { opacity: 0.82 },
  adminMenuButtonText: { ...type.cardTitle, color: colors.text },
  adminMenuButtonTextPrimary: { color: colors.textInverse },
  adminMenuArrow: { ...type.sectionTitle, color: colors.info },
  // Tertiary navigation: deliberately quiet so it cannot compete with the
  // primary action above it.
  navigationCard: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  navigationButton: { flex: 1, minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  historyLink: { ...type.secondary, fontFamily: fonts.headingSemiBold, color: colors.textMuted },
});
