import Constants from 'expo-constants';
import { Link, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pullAssignedRoutes, pullAssignedRoutesForActingDriver, pushCompletedRouteAssignmentProgress, pushRouteAssignmentProgress } from '@/application/auth/route-assignment-sync';
import { ExportPilotRouteDiagnostic } from '@/application/routes/pilot-route-export';
import { resolveRoute } from '@/application/routes/route-navigation';
import { GetRouteProgress, type RouteProgress } from '@/application/routes/route-workday';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { AccountMenuSheet } from '@/components/account-menu-sheet';
import { BrandHeader } from '@/components/brand-header';
import { DriverAppTabs } from '@/components/driver-app-tabs';
import { DriverNowDashboard } from '@/components/driver-now-dashboard';
import { GroupedMenuRow, GroupedMenuSection } from '@/components/grouped-menu';
import { MenuArtwork } from '@/components/menu-artwork';
import { ScreenContainer } from '@/components/screen-container';
import { AppButton, AppCard } from '@/components/ui-primitives';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import { Alert } from '@/ui/alert';
import { devWarn } from '@/ui/dev-log';
import { formatWeightKg } from '@/ui/format-weight';
import { groupRouteCodes, routeCodeLabel, type RouteCodeRow } from '@/ui/route-numbers';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { profile, online, actingDriver, setActingDriver } = useLocalAccess();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [active, setActive] = useState<Route | null>(null);
  const [activeStops, setActiveStops] = useState<DeliveryStop[]>([]);
  const [routeCodes, setRouteCodes] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // An admin who switched this device into "driving as" a chosen driver sees
  // exactly what that driver would see, without logging out of the admin
  // account — only admin can do this; dispatchers already work primarily
  // through the dispatcher screen.
  const drivingAsProxy = profile.role === 'admin' && actingDriver !== null;
  const showDriverDashboard = profile.role === 'driver' || drivingAsProxy;
  const effectiveDriverId = profile.role === 'driver' ? profile.id : actingDriver?.id ?? null;

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
        } else if (online && drivingAsProxy && actingDriver) {
          // /api/assignments (used by pullAssignedRoutes) is driver-only, so a
          // route assigned to the acting driver from a different device would
          // otherwise never reach this device's local copy.
          await pullAssignedRoutesForActingDriver(db, actingDriver.id);
          await pushCompletedRouteAssignmentProgress(db);
        }
        await requestSync('home-focus');
        const operational = showDriverDashboard
          ? await repository.listOperational(effectiveDriverId)
          : [];
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
        devWarn('ACTIVE_ROUTE_RESTORE_FAILED', error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [actingDriver, db, drivingAsProxy, effectiveDriverId, online, profile, repository, requestSync, router, showDriverDashboard]));

  useEffect(() => {
    if (syncRevision === 0) return;
    let mounted = true;
    void (async () => {
      if (online && profile.role === 'driver') await pushCompletedRouteAssignmentProgress(db);
      const operational = showDriverDashboard
        ? await repository.listOperational(effectiveDriverId)
        : [];
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
      devWarn('ACTIVE_ROUTE_SYNC_REFRESH_FAILED', reason);
    });
    return () => { mounted = false; };
  }, [db, effectiveDriverId, online, profile.id, profile.role, repository, showDriverDashboard, syncRevision]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {showDriverDashboard
        ? <BrandHeader showNotifications={false} showSyncStatus={false} variant="driver" />
        : <BrandHeader onMenuPress={() => setAccountMenuOpen(true)} />}
      {drivingAsProxy ? (
        <View style={styles.actingBanner} testID="acting-driver-banner">
          <Text style={styles.actingBannerText}>Vairuojate kaip {actingDriver?.displayName}</Text>
          <Pressable accessibilityRole="button" onPress={() => void setActingDriver(null)} style={styles.actingBannerButton}>
            <Text style={styles.actingBannerButtonText}>Grįžti į administratorių</Text>
          </Pressable>
        </View>
      ) : null}
      <AccountMenuSheet visible={accountMenuOpen} onClose={() => setAccountMenuOpen(false)} />
      <ScreenContainer>
        <ScrollView contentContainerStyle={[styles.content, showDriverDashboard && styles.driverContent]}>
          {!showDriverDashboard && profile.role === 'admin' ? (
            <View style={styles.adminMenu} testID="admin-home-menu">
              <View style={styles.adminMenuHeading}>
                <Text style={styles.adminMenuEyebrow}>ADMINISTRATORIAUS MENIU</Text>
                <Text style={styles.adminMenuTitle}>TSP valdymo centras</Text>
                <Text style={styles.adminMenuText}>{profile.displayName}</Text>
              </View>
              <View style={styles.adminMenuFeatured}><GroupedMenuSection label="SKUBŪS DARBAI">
                <GroupedMenuRow description="Kurti, redaguoti, vykdyti ir stebėti maršrutus." icon={<MenuArtwork kind="dispatch" />} onPress={() => router.push('/dispatcher' as Href)} title="Dispečerio skydelis" tone="success" />
                <GroupedMenuRow description="Pasirinkti vairuotoją ir atidaryti jam priskirtą maršrutą šiame įrenginyje." icon={<MenuArtwork kind="drivers" />} onPress={() => router.push('/execute-route' as Href)} title="Vykdyti vairuotojo maršrutą" tone="info" />
              </GroupedMenuSection></View>
              <View style={styles.adminMenuSections}>
                <View style={styles.adminMenuGroup}><GroupedMenuSection label="STEBĖJIMAS IR APSKAITA">
                  <GroupedMenuRow description="Taškų seka, laikai ir pristatymo kokybė." icon={<MenuArtwork kind="quality" />} onPress={() => router.push('/quality-control' as Href)} title="Kokybės kontrolė" tone="success" />
                  <GroupedMenuRow description="Kilometrai, taškai, svoris ir kokybė pagal laikotarpį." icon={<MenuArtwork kind="statistics" />} onPress={() => router.push({ pathname: '/statistics', params: { returnTo: 'home' } } as Href)} title="Statistika" tone="info" />
                  <GroupedMenuRow description="Reiso savikaina, kuras ir atlygis pagal laikotarpį." icon={<MenuArtwork kind="finance" />} onPress={() => router.push({ pathname: '/finance', params: { returnTo: 'home' } } as unknown as Href)} title="Finansai" tone="neutral" />
                </GroupedMenuSection></View>
                <View style={styles.adminMenuGroup}><GroupedMenuSection label="IŠTEKLIAI">
                  <GroupedMenuRow description="Duomenys, prisijungimai ir leidimai." icon={<MenuArtwork kind="drivers" />} onPress={() => router.push({ pathname: '/admin', params: { section: 'employees', returnTo: 'home' } } as Href)} title="Vairuotojai" />
                  <GroupedMenuRow description="Terminai, techniniai duomenys, kilometražas ir kuras." icon={<MenuArtwork kind="vehicles" />} onPress={() => router.push({ pathname: '/fleet', params: { returnTo: 'home' } } as unknown as Href)} title="Automobiliai" tone="neutral" />
                </GroupedMenuSection></View>
                <View style={styles.adminMenuGroup}><GroupedMenuSection label="SISTEMA">
                  <GroupedMenuRow description="Klientai, administracija ir skambinimas iš maršruto." icon={<MenuArtwork kind="navigation" />} onPress={() => router.push({ pathname: '/directory', params: { returnTo: 'home' } } as unknown as Href)} title="Kontaktai" tone="info" />
                  <GroupedMenuRow description="Vietos, navigacija ir programėlė." icon={<MenuArtwork kind="settings" />} onPress={() => router.push('/settings' as Href)} title="Nustatymai" tone="neutral" />
                </GroupedMenuSection></View>
              </View>
            </View>
          ) : showDriverDashboard ? loading ? (
            <View style={styles.loadingState} testID="home-loading-state"><ActivityIndicator color={colors.primary} size="large" /></View>
          ) : active && progress ? (
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
          ) : loading ? (
            <View style={styles.loadingState} testID="home-loading-state"><ActivityIndicator color={colors.primary} size="large" /></View>
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
      {showDriverDashboard ? <DriverAppTabs active="now" /> : null}
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
  driverContent: { paddingTop: spacing.sm, backgroundColor: colors.background },
  eyebrow: { ...type.label, color: colors.textMuted },
  // One card style, one radius, one hairline border. No shadow: the border is
  // enough separation against a light grey page.
  activeCard: { gap: spacing.md },
  emptyCard: { gap: spacing.sm },
  loadingState: { paddingVertical: spacing.xl, alignItems: 'center', justifyContent: 'center' },
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
  adminMenu: { gap: spacing.md },
  adminMenuHeading: { gap: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.md },
  adminMenuEyebrow: { ...type.label, color: colors.textMuted },
  adminMenuTitle: { ...type.pageTitle, color: colors.text, fontSize: 32, lineHeight: 38 },
  adminMenuText: { ...type.bodyStrong, color: colors.info },
  actingBanner: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, backgroundColor: colors.primary },
  actingBannerText: { ...type.secondaryStrong, color: colors.textInverse },
  actingBannerButton: { minHeight: 32, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  actingBannerButtonText: { ...type.meta, fontFamily: fonts.headingSemiBold, color: colors.primary },
  adminMenuFeatured: { marginBottom: spacing.md },
  adminMenuSections: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.md },
  adminMenuGroup: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
  // Tertiary navigation: deliberately quiet so it cannot compete with the
  // primary action above it.
  navigationCard: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  navigationButton: { flex: 1, minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  historyLink: { ...type.secondary, fontFamily: fonts.headingSemiBold, color: colors.textMuted },
});
