import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';

import { Alert } from '@/ui/alert';
import { buildNavigationUrls, navigationTargetFromStop } from '@/application/navigation/navigation-url-builder';
import { navigationUrlForProvider, openWebNavigationInSameContext } from '@/application/navigation/navigation-launcher';
import { NavigationPreference } from '@/application/settings/navigation-preference';
import {
  ProposeRemainingRouteRecalculation,
  ResolveRouteRecalculation,
  type RouteRecalculationProposal,
} from '@/application/routes/route-recalculation';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import {
  AddStopDuringDelivery,
  BeginRouteCompletion,
  CompleteRoute,
  GetLatestUndoableAction,
  GetRouteProgress,
  MarkStopDelivered,
  MarkStopFailed,
  parseOdometer,
  SaveStartOdometer,
  SaveCompletionOdometerDraft,
  UndoRouteAction,
  type RouteProgress,
  type UndoableAction,
} from '@/application/routes/route-workday';
import { resolveRoute } from '@/application/routes/route-navigation';
import { RefreshRouteEtas } from '@/application/routes/route-eta';
import { loadRouteWeatherScene, type RouteWeatherScene } from '@/application/weather/route-weather';
import { FoundationScreen } from '@/components/foundation-screen';
import { BrandHeader } from '@/components/brand-header';
import { ClockIcon, DeliveredIcon, DistanceIcon, FailedIcon, NavigateIcon } from '@/components/dashboard-icons';
import { InstrumentGauge } from '@/components/instrument-gauge';
import { RoadProgressBar } from '@/components/road-progress-bar';
import { RouteBottomTabs } from '@/components/route-bottom-tabs';
import { SwipeActionCard } from '@/components/swipe-action-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import { GatewayGeocodingProvider } from '@/infrastructure/routing/providers/gateway-geocoding-provider';
import { DELIVERY_FAILURE_REASONS, deliveryMatchesFilter, type DeliveryFailureReason } from '@/domain/delivery-failure';
import type { DeliveryFilter, DeliveryStop, Route } from '@/domain/route';
import { cockpitColors, colors as instrumentColors, fonts, layout, radius, spacing, type } from '@/ui/tokens';
import type { ColorPalette } from '@/ui/theme-palette';
import { formatWeightKg } from '@/ui/format-weight';
import { failedDeliveryLabel, userVisibleStopNote } from '@/ui/route-labels';
import { arrivalWindowStatus, deliveryWindowValue, durationLabel, etaLabel, legLabel, offlineEtaLabel, scheduleLabel, windowLabel, windowUrgencyColor } from '@/ui/route-eta-labels';

function ScheduleDot({ stop, colors, routeDate }: { stop?: DeliveryStop | null; colors: ColorPalette; routeDate?: string | null }) {
  const color = windowUrgencyColor(stop, routeDate);
  if (!color) return null;
  return <View testID="schedule-dot" style={{ width: 9, height: 9, backgroundColor: colors[color] }} />;
}

function cockpitStatusColor(color: keyof ColorPalette): string {
  if (color === 'danger') return cockpitColors.danger;
  if (color === 'warning') return cockpitColors.warning;
  if (color === 'success' || color === 'accent' || color === 'primary') return cockpitColors.success;
  return cockpitColors.routeBlue;
}

type DeliveryView = 'dashboard' | 'stops';

// Whichever of deliveredAt/failedAt is set is when the stop was resolved.
function recalcTimestamp(stop: DeliveryStop): string | null {
  return stop.deliveryStatus === 'delivered' ? stop.deliveredAt : stop.deliveryStatus === 'failed' ? stop.failedAt : null;
}

export default function DeliveryScreen() {
  const { profile } = useLocalAccess();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const { id: routeId = '', redirectReason, view } = useLocalSearchParams<{ id: string; redirectReason?: string; view?: string }>();
  // Route execution keeps a stable light palette for forms and stop lists;
  // only the dashboard itself uses the focused cockpit palette.
  const colors: ColorPalette = instrumentColors;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [filter, setFilter] = useState<DeliveryFilter>('undelivered');
  const [undo, setUndo] = useState<UndoableAction | null>(null);
  const [failedStopId, setFailedStopId] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<DeliveryFailureReason>('Nedirba');
  const [failureComment, setFailureComment] = useState('');
  const [showFinish, setShowFinish] = useState(false);
  const [recalculation, setRecalculation] = useState<RouteRecalculationProposal | null>(null);
  const [startOdometer, setStartOdometer] = useState('');
  const [endOdometer, setEndOdometer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopAddress, setNewStopAddress] = useState('');
  const [newStopWeight, setNewStopWeight] = useState('');
  const [addingStop, setAddingStop] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenuExpanded, setActiveMenuExpanded] = useState(false);
  const [activeView, setActiveView] = useState<DeliveryView>(view === 'stops' ? 'stops' : 'dashboard');
  const [weatherScene, setWeatherScene] = useState<RouteWeatherScene | null>(null);
  const completionDismissed = useRef(false);
  // See alternatives.tsx: keeps the periodic reload from resolving a route we
  // just cancelled ourselves into a /history redirect mid-navigation.
  const selfCancelled = useRef(false);
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const geocoder = useMemo(() => new GatewayGeocodingProvider(), []);

  const load = useCallback(async () => {
    if (selfCancelled.current) return;
    try {
      const persisted = await repository.getWithStops(routeId);
      if (!persisted) return setError('Maršrutas nerastas.');
      if (persisted.route.status !== 'in_progress') {
        const destination = resolveRoute(persisted.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      await new RefreshRouteEtas(db).execute(routeId);
      const refreshed = await repository.getWithStops(routeId);
      if (!refreshed) return setError('Maršrutas nerastas.');
      setRoute(refreshed.route);
      setStops(refreshed.stops);
      setProgress(await new GetRouteProgress(db).execute(routeId));
      setUndo(await new GetLatestUndoableAction(db).execute(routeId));
      setStartOdometer(refreshed.route.startOdometer === null ? '' : String(refreshed.route.startOdometer));
      setEndOdometer(refreshed.route.completionEndOdometerDraft ?? '');
      const weatherStop = refreshed.stops.find((stop) => stop.deliveryStatus === 'pending');
      const weatherLatitude = weatherStop?.latitude ?? refreshed.route.startLocation?.latitude ?? null;
      const weatherLongitude = weatherStop?.longitude ?? refreshed.route.startLocation?.longitude ?? null;
      if (weatherLatitude !== null && weatherLongitude !== null) {
        void loadRouteWeatherScene(db, weatherLatitude, weatherLongitude)
          .then(setWeatherScene)
          .catch((weatherError) => {
            if (__DEV__) console.warn('ROUTE_WEATHER_SCENE_FAILED', weatherError);
          });
      }
      if (refreshed.route.completionStartedAt && !completionDismissed.current) setShowFinish(true);
      setError(null);
    } catch (reason) {
      if (__DEV__) console.warn('DELIVERY_ROUTE_LOAD_FAILED', reason);
      setError(reason instanceof Error ? reason.message : 'Maršruto atkurti nepavyko.');
    }
  }, [db, repository, routeId, router]);

  useEffect(() => {
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    setActiveView(view === 'stops' ? 'stops' : 'dashboard');
  }, [view]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (syncRevision > 0) void load();
  }, [load, syncRevision]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
    window.scrollTo({ left: 0, top: window.scrollY, behavior: 'auto' });
  }, [activeView, routeId]);

  const delivered = async (stopId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await new MarkStopDelivered(db).execute(routeId, stopId);
      setExpandedStopId(null);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Nepavyko pažymėti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setBusy(false);
    }
  };

  const beginFailed = (stopId: string) => {
    setFailedStopId(stopId);
    setFailureReason('Nedirba');
    setFailureComment('');
  };

  const saveFailed = async () => {
    if (!failedStopId) return;
    if (busy) return;
    setBusy(true);
    try {
      await new MarkStopFailed(db).execute(routeId, failedStopId, { reason: failureReason, comment: failureComment });
      setFailedStopId(null);
      setExpandedStopId(null);
      await load();
      void requestSync('mutation');
      Alert.alert('Pristatymas pažymėtas kaip nepavykęs', 'Taškas pašalintas iš likusių pristatymų. Esama seka nepakeista.');
    } catch (reason) {
      Alert.alert('Nepavyko išsaugoti', reason instanceof Error ? reason.message : 'Patikrinkite komentarą.');
    } finally {
      setBusy(false);
    }
  };

  const proposeRecalculation = async (currentStopId: string) => {
    try {
      const proposal = await new ProposeRemainingRouteRecalculation(db).execute(routeId, currentStopId);
      setRecalculation(proposal);
    } catch (reason) {
      if (__DEV__) console.warn('ROUTE_RECALCULATION_FAILED', reason);
      Alert.alert('Perskaičiuoti nepavyko', 'Esama seka išsaugota. Galite tęsti pristatymus ir bandyti vėliau.');
    }
  };

  const resolveRecalculation = async (accept: boolean) => {
    if (!recalculation) return;
    try {
      await new ResolveRouteRecalculation(db).execute(routeId, recalculation.id, accept);
      setRecalculation(null);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Sekos pakeisti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const addStop = async () => {
    const address = newStopAddress.trim();
    if (!address || addingStop) return;
    setAddingStop(true);
    try {
      const response = await geocoder.geocode(address);
      if (!response.isUnambiguous || !response.result) {
        Alert.alert(
          'Adresas neatpažintas vienareikšmiškai',
          'Pabandykite įvesti tikslesnį adresą (su miestu ar gatvės numeriu).',
        );
        return;
      }
      const weightText = newStopWeight.trim().replace(',', '.');
      const weightKg = weightText ? Number(weightText) : null;
      if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0)) {
        Alert.alert('Neteisingas svoris', 'Įveskite teigiamą skaičių arba palikite tuščią.');
        return;
      }
      await new AddStopDuringDelivery(db).execute(routeId, {
        originalAddress: address,
        normalizedAddress: response.result.normalizedAddress,
        latitude: response.result.latitude,
        longitude: response.result.longitude,
        weightKg,
      });
      setNewStopAddress('');
      setNewStopWeight('');
      setShowAddStop(false);
      await load();
      void requestSync('mutation');
      // Anchor recalculation on the most recently completed stop, so the new
      // stop gets positioned "according to the route" (per closest-to-current
      // travel cost) rather than just appended at the end.
      const anchor = [...stops]
        .filter((stop) => stop.deliveryStatus === 'delivered' || stop.deliveryStatus === 'failed')
        .sort((left, right) => (recalcTimestamp(right) ?? '').localeCompare(recalcTimestamp(left) ?? ''))[0];
      if (anchor) {
        await proposeRecalculation(anchor.id);
      } else {
        Alert.alert('Taškas pridėtas', 'Kadangi dar nė vienas taškas nepristatytas, naujas taškas pridėtas sekos gale. Perskaičiuoti pagal maršrutą galėsite pristatę bent vieną tašką.');
      }
    } catch (reason) {
      Alert.alert('Nepavyko pridėti taško', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setAddingStop(false);
    }
  };

  const undoLast = async () => {
    if (!undo) return;
    try {
      await new UndoRouteAction(db).execute(undo.id);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Veiksmo atšaukti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const navigate = async (stop: DeliveryStop) => {
    try {
      const target = navigationTargetFromStop(stop);
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      const urls = buildNavigationUrls(target, platform);
      const provider = await new NavigationPreference(db).get();
      const selectedUrl = navigationUrlForProvider(urls, provider);
      if (platform === 'web') {
        // Keep the launch in the current PWA browsing context. Opening a new
        // context leaves an empty Safari sheet behind on iOS after the
        // universal link hands control to the navigation app.
        openWebNavigationInSameContext(selectedUrl);
        return;
      }
      await Linking.openURL(selectedUrl);
    } catch (reason) {
      Alert.alert('Navigacija neatidaryta', reason instanceof Error ? reason.message : 'Adresas netinkamas navigacijai.');
    }
  };

  const saveLateStartOdometer = async () => {
    try {
      await new SaveStartOdometer(db).execute(routeId, parseOdometer(startOdometer));
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Neteisingas odometras', reason instanceof Error ? reason.message : 'Patikrinkite reikšmę.');
    }
  };

  const finish = async (confirmUnfinished = false, confirmLargeDifference = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await draftSaveQueue.current;
      const result = await new CompleteRoute(db).execute(routeId, {
        endOdometer: parseOdometer(endOdometer),
        confirmUnfinished,
        confirmLargeDifference,
      });
      void requestSync('mutation');
      router.replace({ pathname: '/route/[id]/result', params: { id: routeId } } as unknown as Href);
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Maršruto užbaigti nepavyko.';
      if (message.includes('nepristatytų')) {
        Alert.alert('Yra nebaigtų pristatymų', message, [
          { text: 'Grįžti į maršrutą', style: 'cancel' },
          { text: 'Užbaigti vis tiek', style: 'destructive', onPress: () => void finish(true, false) },
        ]);
      } else if (message.includes('neįprastai')) {
        Alert.alert('Patikrinkite odometrą', message, [
          { text: 'Pataisyti', style: 'cancel' },
          { text: 'Rodmuo teisingas', onPress: () => void finish(true, true) },
        ]);
      } else {
        Alert.alert('Maršrutas neužbaigtas', message);
      }
    } finally {
      setBusy(false);
    }
  };

  const persistCompletionDraft = useCallback((value: string) => {
    draftSaveQueue.current = draftSaveQueue.current
      .then(() => new SaveCompletionOdometerDraft(db).execute(routeId, value))
      .catch((reason) => {
        if (__DEV__) console.warn('COMPLETION_DRAFT_SAVE_FAILED', reason);
        setError(reason instanceof Error ? reason.message : 'Odometerio juodraščio išsaugoti nepavyko.');
      });
  }, [db, routeId]);

  const beginFinish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const current = await repository.getById(routeId);
      if (!current) throw new Error('Maršrutas nerastas.');
      if (current.status !== 'in_progress') {
        const destination = resolveRoute(current);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      await new BeginRouteCompletion(db).execute(routeId);
      completionDismissed.current = false;
      setShowFinish(true);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Užbaigimo pradėti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setBusy(false);
    }
  };

  const leaveFinish = useCallback(() => {
    const exit = () => {
      void draftSaveQueue.current.finally(() => {
        completionDismissed.current = true;
        setShowFinish(false);
      });
    };
    if (endOdometer.trim()) {
      Alert.alert('Odometras dar nepatvirtintas', 'Maršrutas liks vykdomas, o įvestas rodmuo – juodraštyje.', [
        { text: 'Tęsti redagavimą', style: 'cancel' },
        { text: 'Išeiti neišsaugojus', onPress: exit },
      ]);
    } else {
      exit();
    }
    return true;
  }, [endOdometer]);

  const handleBack = useCallback(() => {
    if (showFinish) return leaveFinish();
    router.replace('/' as Href);
    return true;
  }, [leaveFinish, router, showFinish]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => subscription.remove();
  }, [handleBack]);

  const stopLabel = (stopId: string): string => {
    const stop = stops.find((item) => item.id === stopId);
    return stop ? (stop.recipient || stop.normalizedAddress || stop.originalAddress) : stopId;
  };
  const visibleStops = stops.filter((stop) => deliveryMatchesFilter(filter, stop.deliveryStatus));
  // Anchor on whichever non-pending stop was resolved most recently — a
  // failed stop OR a delivered one — so recalculation is offerable right
  // after a normal delivery too (e.g. adding a new stop mid-route), not
  // only after a failure.
  const recalculationAnchor = [...stops]
    .filter((stop) => stop.deliveryStatus === 'failed' || stop.deliveryStatus === 'delivered')
    .sort((left, right) => (recalcTimestamp(right) ?? '').localeCompare(recalcTimestamp(left) ?? ''))[0] ?? null;
  const canRecalculateRemaining = Boolean(recalculationAnchor && stops.some((stop) => stop.deliveryStatus === 'pending'));
  const nextStop = stops.find((stop) => stop.deliveryStatus === 'pending') ?? null;
  const nextStopWindow = arrivalWindowStatus(nextStop, route?.date);
  const nextStopStatusColor = cockpitStatusColor(nextStopWindow.color);
  const isWideDashboard = viewportWidth >= 760;
  const gaugeSize = isWideDashboard
    ? 150
    : Math.min(138, Math.max(100, (Math.min(viewportWidth, 430) - 124) / 2));

  const stopRoute = () => {
    if (busy) return;
    Alert.alert('Nutraukti maršrutą?', 'Maršrutas bus atšauktas ir pristatymai nebebus vykdomi. Šio veiksmo negalėsite atšaukti.', [
      { text: 'Ne', style: 'cancel' },
      {
        text: 'Taip, nutraukti', style: 'destructive', onPress: () => { void (async () => {
          setBusy(true);
          selfCancelled.current = true;
          try {
            await new CancelDraftRoute(db).execute(routeId);
            void requestSync('mutation');
            router.replace('/' as Href);
          } catch (reason) {
            selfCancelled.current = false;
            Alert.alert('Nepavyko nutraukti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
          } finally {
            setBusy(false);
          }
        })(); },
      },
    ]);
  };

  return (
    <>
    <Stack.Screen options={{ gestureEnabled: false, headerBackVisible: false, headerShown: false }} />
    <View style={styles.routeApp}>
      <BrandHeader onMenuPress={() => setMenuOpen(true)} />
      <View style={styles.routeMain}>
      <FoundationScreen edgeToEdge showFoundationNotice={false} showHeading={false} title="Pristatymai" description="">
        <View style={styles.routeContent}>
          {redirectReason ? <Text style={styles.notice}>Maršrutas jau pradėtas. Grąžinome į vykdomą maršrutą.</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {activeView === 'dashboard' && progress ? (
            <View style={styles.dashboard} testID="route-dashboard">
              <View style={[styles.dashboardGrid, isWideDashboard && styles.dashboardGridWide]}>
              <View style={[styles.instrumentColumn, isWideDashboard && styles.instrumentColumnWide]}>
              <RoadProgressBar
                fraction={progress.totalStops > 0
                  ? (progress.totalStops - progress.remainingStops) / progress.totalStops
                  : 0}
                completed={progress.totalStops > 0 && progress.remainingStops === 0}
                weatherScene={weatherScene}
              />
              <View style={styles.gaugePanel}>
                <View style={styles.gaugeRow}>
                  <InstrumentGauge
                    maximum={progress.totalKnownWeightKg}
                    remaining={progress.remainingKnownWeightKg}
                    size={gaugeSize}
                    title="Svoris"
                    unit="kg"
                    value={progress.totalKnownWeightKg - progress.remainingKnownWeightKg}
                  />
                  <View style={styles.gaugeCenterStats}>
                    <Text style={styles.gaugeCenterLabel}>LAIKAS</Text>
                    <Text numberOfLines={1} style={styles.gaugeCenterValue}>{elapsedLabel(route?.startedAt ?? null)}</Text>
                    <View style={styles.gaugeCenterDivider} />
                    <Text style={styles.gaugeCenterLabel}>LIKĘ KM</Text>
                    <Text numberOfLines={1} style={styles.gaugeCenterValue}>{progress.preliminaryRemainingDistanceKm?.toFixed(0) ?? '—'}</Text>
                    <Text style={styles.gaugeCenterUnit}>km</Text>
                  </View>
                  <InstrumentGauge
                    maximum={progress.totalStops}
                    remaining={progress.remainingStops}
                    size={gaugeSize}
                    title="Taškai"
                    unit="tšk."
                    value={progress.totalStops - progress.remainingStops}
                  />
                </View>
              </View>
              <View style={styles.routeMetrics}>
                <View style={styles.routeMetricCard}>
                  <View style={styles.metricIconCircle}><DistanceIcon size={20} /></View>
                  <View style={styles.routeMetricText}>
                    <Text style={styles.routeMetricLabel}>IKI ARTIMIAUSIOS</Text>
                    <Text numberOfLines={1} style={styles.routeMetricValue}>{nextStop?.legDistanceKm === null || nextStop?.legDistanceKm === undefined ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(nextStop.legDistanceKm)} km`}</Text>
                  </View>
                </View>
                <View style={styles.routeMetricCard}>
                  <View style={styles.metricIconCircle}><ClockIcon size={20} /></View>
                  <View style={styles.routeMetricText}>
                    <Text style={styles.routeMetricLabel}>IKI ARTIMIAUSIOS</Text>
                    <Text numberOfLines={1} style={styles.routeMetricValue}>{nextStop?.legDurationMinutes === null || nextStop?.legDurationMinutes === undefined ? '—' : durationLabel(nextStop.legDurationMinutes)}</Text>
                  </View>
                </View>
              </View>
              </View>
              {nextStop ? (
                <View style={[styles.nextStopCard, isWideDashboard && styles.nextStopCardWide]} testID="dashboard-next-stop">
                  <Text style={styles.dashboardCardLabel}>KITA STOTELĖ</Text>
                  <View style={styles.nextStopHeading} testID="dashboard-stop-heading">
                    <View style={styles.stopNumberBadge}>
                      <Text style={styles.stopNumber}>{nextStop.activeOrder ?? nextStop.optimizedOrder ?? nextStop.originalOrder}</Text>
                    </View>
                    <Text style={styles.nextStopAddress}>{nextStop.normalizedAddress ?? nextStop.originalAddress}</Text>
                  </View>
                  <View style={styles.arrivalWindowPanel} testID="dashboard-arrival-window">
                    <View>
                      <Text style={styles.arrivalWindowLabel}>PRISTATYMO LAIKAS</Text>
                      <Text style={styles.arrivalWindowValue}>{deliveryWindowValue(nextStop)}</Text>
                    </View>
                    <View style={styles.arrivalWindowResult}>
                      <View style={styles.arrivalEtaRow}>
                        <View style={[styles.arrivalStatusDot, { backgroundColor: nextStopStatusColor, shadowColor: nextStopStatusColor }]} />
                        <Text style={styles.arrivalEta}>{etaLabel(nextStop)}</Text>
                      </View>
                      <Text style={[styles.arrivalStatusText, { color: nextStopStatusColor }]}>{nextStopWindow.label}</Text>
                    </View>
                  </View>
                  <View style={styles.dashboardStopActions} testID="dashboard-stop-actions">
                    <Pressable style={[styles.dashboardActionButton, styles.dashboardNavigateButton]} onPress={() => { void navigate(nextStop); }}>
                      <NavigateIcon size={28} />
                      <Text numberOfLines={1} style={styles.dashboardActionText}>NAVIGUOTI</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() => { void delivered(nextStop.id); }}
                      style={[styles.dashboardActionButton, styles.dashboardDeliveredButton, busy && styles.disabled]}
                      testID="dashboard-delivered-button">
                      <DeliveredIcon size={28} />
                      <Text numberOfLines={1} style={styles.dashboardActionText}>ATLIKTA</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() => beginFailed(nextStop.id)}
                      style={[styles.dashboardActionButton, styles.dashboardFailedButton, busy && styles.disabled]}
                      testID="dashboard-failed-button">
                      <FailedIcon size={28} />
                      <Text numberOfLines={1} style={styles.dashboardActionText}>NEATLIKTA</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.nextStopCard} testID="dashboard-next-stop">
                  <Text style={styles.dashboardCardLabel}>MARŠRUTAS ĮVYKDYTAS</Text>
                  <Text style={styles.nextStopAddress}>Visi taškai apdoroti</Text>
                  <Pressable
                    disabled={busy}
                    onPress={() => { void beginFinish(); }}
                    style={[styles.completeRouteButton, busy && styles.disabled]}
                    testID="dashboard-complete-route-button">
                    <Text style={styles.buttonText}>UŽBAIGTI MARŠRUTĄ</Text>
                  </Pressable>
                </View>
              )}
              </View>
              {route?.startOdometer === null ? (
                <View style={styles.reminder}>
                  <Text style={styles.heading}>Trūksta pradinio odometro</Text>
                  <TextInput value={startOdometer} onChangeText={setStartOdometer} keyboardType="decimal-pad" placeholder="Pvz. 125430,5" style={styles.input} />
                  <Pressable style={styles.secondaryButton} onPress={saveLateStartOdometer}><Text style={styles.secondaryText}>Įvesti dabar</Text></Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          {activeView === 'stops' ? (
            <View style={styles.stopsView}>
              <View style={styles.stopsProgress} testID="stops-route-progress">
                <View style={styles.stopsProgressHeading}>
                  <Text style={styles.stopsProgressLabel}>MARŠRUTO EIGA</Text>
                  <Text style={styles.stopsProgressValue}>{progress?.deliveryPercent ?? 0}%</Text>
                </View>
                <View style={styles.stopsProgressTrack}>
                  <View style={[styles.stopsProgressFill, { width: `${Math.min(100, Math.max(0, progress?.deliveryPercent ?? 0))}%` }]} />
                </View>
              </View>
              {undo ? <Pressable style={styles.undoButton} onPress={undoLast}><Text style={styles.undoText}>Atšaukti paskutinį veiksmą</Text></Pressable> : null}
              <View style={styles.filters}>
                {(['undelivered', 'all', 'delivered', 'failed'] as DeliveryFilter[]).map((value) => (
                  <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filterChip, filter === value && styles.filterChipActive]}>
                    <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{filterLabel(value)}</Text>
                  </Pressable>
                ))}
              </View>
              {canRecalculateRemaining ? (
                <Pressable
                  disabled={busy}
                  testID="recalculate-remaining-route"
                  style={[styles.recalculateButton, busy && styles.disabled]}
                  onPress={() => { if (recalculationAnchor) void proposeRecalculation(recalculationAnchor.id); }}>
                  <Text style={styles.secondaryText}>Perskaičiuoti likusį maršrutą</Text>
                </Pressable>
              ) : null}
              {recalculation ? (
                <View style={styles.recalculationCard} testID="recalculation-proposal">
                  <Text style={styles.heading}>Naujas likusios sekos variantas</Text>
                  <Text style={styles.meta}>Kilometrų skirtumas: {signed(recalculation.distanceDeltaKm, 'km')}</Text>
                  <Text style={styles.meta}>Laiko skirtumas: {signed(recalculation.timeDeltaMinutes, 'min')}</Text>
                  <Text style={styles.meta}>Esama: {recalculation.orderBefore.map(stopLabel).join(' → ')}</Text>
                  <Text style={styles.meta}>Nauja: {recalculation.orderAfter.map(stopLabel).join(' → ')}</Text>
                  <Pressable style={styles.finishButton} onPress={() => { void resolveRecalculation(true); }}><Text style={styles.buttonText}>Patvirtinti naują seką</Text></Pressable>
                  <Pressable style={styles.cancelButton} onPress={() => { void resolveRecalculation(false); }}><Text style={styles.secondaryText}>Palikti esamą seką</Text></Pressable>
                </View>
              ) : null}
              {visibleStops.map((stop) => {
        const expanded = expandedStopId === stop.id;
        return (
          <SwipeActionCard key={stop.id} onSwipeRight={() => { void delivered(stop.id); }} onSwipeLeft={() => beginFailed(stop.id)} style={[styles.card, stop.deliveryStatus === 'delivered' && styles.deliveredCard, stop.deliveryStatus === 'failed' && styles.failedCard]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpandedStopId(expanded ? null : stop.id)}
              style={styles.cardHeader}>
              <ScheduleDot stop={stop} colors={colors} routeDate={route?.date} />
              <View style={styles.cardHeaderText}>
                <Text style={styles.order}>{statusLabel(stop)}{stop.priorityFirst ? ' ⭐' : ''}</Text>
                <Text style={styles.address}>{stop.normalizedAddress ?? stop.originalAddress}</Text>
              </View>
              <Text style={styles.weight}>{stop.weightKg === null ? 'Svoris nežinomas' : `${formatWeightKg(stop.weightKg)} kg`}</Text>
              <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded ? (
              <>
                <View style={styles.etaRow}>
                  <ScheduleDot stop={stop} colors={colors} routeDate={route?.date} />
                  <Text style={styles.eta}>{etaLabel(stop)}</Text>
                </View>
                <Text style={styles.meta}>{legLabel(stop)}</Text>
                <Text style={styles.schedule}>{scheduleLabel(stop)}</Text>
                {windowLabel(stop, route?.planningMode ?? null) ? <Text style={route?.planningMode === 'ignore_time_windows' ? styles.informational : styles.meta}>{windowLabel(stop, route?.planningMode ?? null)}</Text> : null}
                {offlineEtaLabel(stop) ? <Text style={styles.offline}>{offlineEtaLabel(stop)}</Text> : null}
                {userVisibleStopNote(stop.notes) ? <Text style={styles.meta}>Pastabos: {userVisibleStopNote(stop.notes)}</Text> : null}
                {stop.deliveryStatus === 'failed' ? (
                  <Text style={styles.failure}>{failedDeliveryLabel(stop.failureReason, stop.failureComment)}</Text>
                ) : null}
                <View style={styles.actions}>
                  <Pressable style={styles.navigateButton} onPress={() => { void navigate(stop); }}><Text style={styles.buttonText}>Navigacija</Text></Pressable>
                  <Pressable style={styles.deliverButton} onPress={() => { void delivered(stop.id); }}><Text style={styles.buttonText}>Pristatyta</Text></Pressable>
                  <Pressable style={styles.failButton} onPress={() => beginFailed(stop.id)}><Text style={styles.buttonText}>Nepavyko</Text></Pressable>
                </View>
              </>
            ) : null}
          </SwipeActionCard>
        );
              })}
            </View>
          ) : null}
        </View>
      </FoundationScreen>
      </View>
      <RouteBottomTabs
        active={activeView}
        onDashboard={() => setActiveView('dashboard')}
        onHistory={() => router.push('/history' as Href)}
        onStops={() => setActiveView('stops')}
      />
    </View>
    <Modal
      animationType="slide"
      onRequestClose={leaveFinish}
      statusBarTranslucent
      transparent
      visible={showFinish}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboard}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.finishSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} testID="route-finish-summary">
            <View style={styles.sheetHandle} />
            <Text style={styles.heading}>Maršruto santrauka</Text>
            <Text style={styles.meta}>Taškai: {progress?.totalStops ?? 0} · sėkmingi {progress?.deliveredStops ?? 0} · nepavykę {progress?.failedStops ?? 0} · liko {progress?.remainingStops ?? 0}</Text>
            <Text style={styles.meta}>Pristatytas žinomas svoris: {formatWeightKg((progress?.totalKnownWeightKg ?? 0) - (progress?.remainingKnownWeightKg ?? 0))} kg</Text>
            <Text style={styles.meta}>Nepristatytas žinomas svoris: {formatWeightKg(progress?.remainingKnownWeightKg ?? 0)} kg</Text>
            <Text style={styles.meta}>Pradinis odometras: {route?.startOdometer ?? 'neįvestas'}</Text>
            <Text style={styles.meta}>Planuoti kilometrai: {route?.estimatedDistanceKm?.toFixed(1) ?? '—'}</Text>
            <TextInput value={endOdometer} onChangeText={(value) => { setEndOdometer(value); persistCompletionDraft(value); }} keyboardType="decimal-pad" placeholder="Galutinis odometras" style={styles.input} />
            <Pressable disabled={busy} style={[styles.finishButton, busy && styles.disabled]} onPress={() => void finish(false, false)}><Text style={styles.buttonText}>Patvirtinti užbaigimą</Text></Pressable>
            <Pressable disabled={busy} style={styles.cancelButton} onPress={leaveFinish}><Text style={styles.secondaryText}>Grįžti</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <Modal
      animationType="fade"
      onRequestClose={() => setMenuOpen(false)}
      statusBarTranslucent
      transparent
      visible={menuOpen}>
      <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
        <View style={[styles.menuSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.menuTitle}>Meniu</Text>
          <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); router.replace('/' as Href); }}><Text style={styles.menuItemText}>Pradžios meniu</Text></Pressable>
          <Pressable
            accessibilityState={{ expanded: activeMenuExpanded, disabled: route?.status !== 'in_progress' }}
            disabled={route?.status !== 'in_progress'}
            onPress={() => setActiveMenuExpanded((expanded) => !expanded)}
            style={[styles.menuItem, route?.status !== 'in_progress' && styles.disabled]}
            testID="active-route-menu-toggle">
            <View style={styles.menuItemRow}>
              <Text style={styles.menuItemText}>Aktyvus maršrutas</Text>
              <Text style={styles.menuChevron}>{activeMenuExpanded ? '▴' : '▾'}</Text>
            </View>
          </Pressable>
          {route?.status === 'in_progress' && activeMenuExpanded ? (
            <View style={styles.menuSubmenu} testID="active-route-menu-actions">
              {profile.role !== 'driver' || profile.permissions?.canAddStops ? <Pressable testID="toggle-add-stop" style={styles.menuSubitem} onPress={() => { setMenuOpen(false); setActiveMenuExpanded(false); setShowAddStop(true); }}><Text style={styles.menuSubitemText}>Įtraukti sustojimą</Text></Pressable> : null}
              {profile.role !== 'driver' || profile.permissions?.canRecalculateRoute ? <Pressable
                disabled={busy}
                style={[styles.menuSubitem, busy && styles.disabled]}
                onPress={() => {
                  setMenuOpen(false);
                  setActiveMenuExpanded(false);
                  if (recalculationAnchor) void proposeRecalculation(recalculationAnchor.id);
                  else Alert.alert('Perskaičiuoti dar negalima', 'Pirmiausia pažymėkite bent vieną pristatymą. Esama maršruto seka nekeičiama.');
                }}>
                <Text style={styles.menuSubitemText}>Perskaičiuoti maršrutą</Text>
              </Pressable> : null}
              <Pressable accessibilityLabel={route?.completionStartedAt ? 'Tęsti užbaigimą' : 'Baigti maršrutą'} disabled={busy} style={[styles.menuSubitem, busy && styles.disabled]} onPress={() => { setMenuOpen(false); setActiveMenuExpanded(false); void beginFinish(); }}><Text style={styles.menuSubitemText}>Baigti maršrutą</Text></Pressable>
              {profile.role !== 'driver' || profile.permissions?.canCancelRoute ? <Pressable disabled={busy} testID="stop-route-button" style={[styles.menuSubitem, busy && styles.disabled]} onPress={() => { setMenuOpen(false); setActiveMenuExpanded(false); stopRoute(); }}><Text style={styles.menuDangerText}>Nutraukti maršrutą</Text></Pressable> : null}
            </View>
          ) : null}
          <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push('/statistics' as Href); }}><Text style={styles.menuItemText}>Statistika</Text></Pressable>
          <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push('/settings' as Href); }}><Text style={styles.menuItemText}>Nustatymai</Text></Pressable>
          <Pressable style={styles.menuClose} onPress={() => setMenuOpen(false)}><Text style={styles.secondaryText}>Uždaryti</Text></Pressable>
        </View>
      </Pressable>
    </Modal>
    <Modal
      animationType="fade"
      onRequestClose={() => { if (!addingStop) setShowAddStop(false); }}
      statusBarTranslucent
      transparent
      visible={showAddStop}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboard}>
        <View style={styles.centeredBackdrop} testID="add-stop-form">
          <View style={styles.addStopDialog}>
            <Text style={styles.heading}>NAUJAS SUSTOJIMAS</Text>
            <TextInput
              testID="add-stop-address"
              value={newStopAddress}
              onChangeText={setNewStopAddress}
              placeholder="Adresas, pvz. Katedros a. 4, Vilnius"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <TextInput
              testID="add-stop-weight"
              value={newStopWeight}
              onChangeText={setNewStopWeight}
              keyboardType="decimal-pad"
              placeholder="Svoris, kg (nebūtina)"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable
                testID="add-stop-submit"
                disabled={addingStop || !newStopAddress.trim()}
                style={[styles.finishButton, (addingStop || !newStopAddress.trim()) && styles.disabled]}
                onPress={() => { void addStop(); }}>
                <Text style={styles.buttonText}>{addingStop ? 'Pridedama…' : 'Pridėti tašką'}</Text>
              </Pressable>
              <Pressable disabled={addingStop} style={styles.cancelButton} onPress={() => setShowAddStop(false)}>
                <Text style={styles.secondaryText}>Atšaukti</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <Modal
      animationType="slide"
      onRequestClose={() => { if (!busy) setFailedStopId(null); }}
      statusBarTranslucent
      transparent
      visible={failedStopId !== null}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboard}>
        <View style={styles.modalBackdrop} testID="failure-modal">
          <View style={[styles.failureSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.heading}>Kodėl pristatymas nepavyko?</Text>
            <View style={styles.reasonGrid}>
              {DELIVERY_FAILURE_REASONS.map((reason) => (
                <Pressable key={reason} onPress={() => setFailureReason(reason)}>
                  <Text style={failureReason === reason ? styles.activeReason : styles.reason}>{reason}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={failureComment}
              onChangeText={setFailureComment}
              multiline
              placeholder={failureReason === 'Kita' ? 'Komentaras privalomas' : 'Papildomas komentaras (neprivaloma)'}
              style={styles.textArea}
            />
            <View style={styles.modalActions}>
              <Pressable
                disabled={busy || (failureReason === 'Kita' && !failureComment.trim())}
                style={[styles.failConfirm, (busy || (failureReason === 'Kita' && !failureComment.trim())) && styles.disabled]}
                onPress={() => { void saveFailed(); }}>
                <Text style={styles.buttonText}>Išsaugoti</Text>
              </Pressable>
              <Pressable disabled={busy} style={styles.cancelButton} onPress={() => setFailedStopId(null)}>
                <Text style={styles.secondaryText}>Atšaukti</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}

function elapsedLabel(startedAt: string | null): string {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function filterLabel(filter: DeliveryFilter): string {
  return ({ all: 'Visi', undelivered: 'Liko nepristatyti', delivered: 'Pristatyti', failed: 'Nepavykę' })[filter];
}

function statusLabel(stop: DeliveryStop): string {
  if (stop.deliveryStatus === 'delivered') return 'Pristatyta';
  if (stop.deliveryStatus === 'failed') return 'Nepavyko';
  return 'Laukia pristatymo';
}

function signed(value: number | null, unit: string): string {
  if (value === null) return 'nepalyginama';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} ${unit}`;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  routeApp: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'center',
    marginHorizontal: 'auto',
    width: '100%',
    maxWidth: layout.maxOperationalWidth,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  routeMain: { flex: 1, minHeight: 0, minWidth: 0, width: '100%' },
  routeContent: { flexGrow: 1, alignSelf: 'center', minWidth: 0, width: '100%', maxWidth: layout.maxOperationalWidth, overflow: 'hidden', gap: 0 },
  stopsView: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: spacing.md, gap: spacing.md, backgroundColor: colors.background },
  dashboard: {
    flexGrow: 1,
    minWidth: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.maxOperationalWidth,
    overflow: 'hidden',
    gap: 0,
    backgroundColor: cockpitColors.canvas,
  },
  dashboardGrid: { width: '100%', flexDirection: 'column-reverse', backgroundColor: cockpitColors.canvas },
  dashboardGridWide: { flexDirection: 'row-reverse', alignItems: 'stretch', gap: spacing.lg, padding: spacing.lg },
  instrumentColumn: { width: '100%', overflow: 'hidden', backgroundColor: cockpitColors.canvas },
  instrumentColumnWide: { flex: 1.15, minWidth: 0, borderRadius: radius.lg, borderWidth: 1, borderColor: cockpitColors.border, shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.22, shadowRadius: 20, elevation: 8 },
  gaugePanel: {
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: cockpitColors.panel,
  },
  gaugeRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  gaugeCenterStats: {
    width: 74,
    flexShrink: 0,
    minHeight: 108,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: cockpitColors.border,
    backgroundColor: cockpitColors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  gaugeCenterLabel: { color: cockpitColors.textMuted, fontFamily: fonts.headingSemiBold, fontSize: 8, textAlign: 'center', letterSpacing: 0.8 },
  gaugeCenterValue: { color: cockpitColors.text, fontFamily: fonts.heading, fontSize: 18, lineHeight: 22, textAlign: 'center' },
  gaugeCenterUnit: { color: cockpitColors.textSecondary, fontFamily: fonts.bodyMedium, fontSize: 9, lineHeight: 11, textAlign: 'center' },
  gaugeCenterDivider: { width: '100%', height: 1, marginVertical: 6, backgroundColor: cockpitColors.metalSoft },
  routeMetrics: { flexDirection: 'row', paddingHorizontal: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: cockpitColors.border, backgroundColor: cockpitColors.panelElevated },
  routeMetricCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    paddingHorizontal: 6,
    backgroundColor: cockpitColors.panelElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  routeMetricText: { flex: 1, minWidth: 0 },
  metricIconCircle: { width: 38, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: cockpitColors.routeBlueSoft },
  metricIcon: { color: cockpitColors.routeBlue, fontSize: 18, fontFamily: fonts.headingExtraBold },
  routeMetricLabel: { ...type.label, color: cockpitColors.textMuted },
  routeMetricValue: { ...type.cardTitle, color: cockpitColors.text, flexShrink: 1 },
  nextStopCard: {
    minHeight: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: cockpitColors.panel,
    gap: 12,
  },
  nextStopCardWide: { flex: 1, minWidth: 0, borderRadius: radius.lg, borderWidth: 1, borderColor: cockpitColors.border, padding: spacing.lg, justifyContent: 'center', shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 6 },
  dashboardCardLabel: { ...type.label, color: cockpitColors.textMuted },
  nextStopHeading: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stopNumberBadge: { width: 42, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: cockpitColors.routeBlueStrong },
  stopNumber: { color: cockpitColors.text, fontFamily: fonts.heading, fontSize: 18 },
  nextStopAddress: { flex: 1, minWidth: 0, ...type.cardTitle, color: cockpitColors.text },
  nextStopChevron: { color: cockpitColors.textMuted, fontSize: 20, lineHeight: 24 },
  arrivalWindowPanel: { borderTopWidth: 1, borderTopColor: cockpitColors.border, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  arrivalWindowLabel: { ...type.label, color: cockpitColors.textMuted },
  arrivalWindowValue: { ...type.sectionTitle, color: cockpitColors.text, marginTop: 4 },
  arrivalWindowResult: { flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 4 },
  arrivalEtaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  arrivalStatusDot: { width: 12, height: 12, borderRadius: 6, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 7, elevation: 4 },
  arrivalEta: { ...type.cardTitle, color: cockpitColors.text },
  arrivalStatusText: { fontFamily: fonts.headingSemiBold, fontSize: 12, textAlign: 'right' },
  dashboardStopActions: { flexDirection: 'row', gap: 8 },
  dashboardActionButton: {
    flex: 1,
    minWidth: 0,
    height: 68,
    borderRadius: radius.md,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dashboardNavigateButton: { backgroundColor: cockpitColors.routeBlueStrong },
  dashboardDeliveredButton: { backgroundColor: cockpitColors.success },
  dashboardFailedButton: { backgroundColor: cockpitColors.danger },
  dashboardActionIcon: { color: cockpitColors.text, fontFamily: fonts.headingExtraBold, fontSize: 26, lineHeight: 28 },
  dashboardActionText: { ...type.label, color: cockpitColors.text },
  completeRouteButton: { minHeight: 58, borderRadius: radius.md, backgroundColor: cockpitColors.success, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  nextStopMeta: { color: colors.textMuted, lineHeight: 20 },
  nextStopEta: { color: colors.accent, fontSize: 16, fontFamily: fonts.heading },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 2 },
  tile: { flex: 1, paddingVertical: 7, paddingHorizontal: spacing.xs, borderWidth: 1, borderRadius: radius.md, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, alignItems: 'center', gap: 1 },
  tileValue: { color: colors.text, fontSize: 18, fontFamily: fonts.headingExtraBold },
  tileCaption: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.headingSemiBold, letterSpacing: 0.6, textAlign: 'center' },
  heroActions: { flexDirection: 'row', gap: 5, marginTop: spacing.xs },
  heroActionButton: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 3, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  heroNavigateButton: { backgroundColor: colors.actionRoute },
  heroDeliverButton: { backgroundColor: colors.success },
  heroFailButton: { borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.surface },
  heroActionLightText: { color: colors.textInverse, fontFamily: fonts.heading, fontSize: 11 },
  heroActionDangerText: { color: colors.danger, fontFamily: fonts.heading, fontSize: 10 },
  reminder: { padding: spacing.md, borderWidth: 1, borderRadius: radius.md, borderColor: colors.warning, backgroundColor: colors.warningSoft, gap: spacing.sm },
  stopsProgress: { borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 9 },
  stopsProgressHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopsProgressLabel: { ...type.label, color: colors.textMuted },
  stopsProgressValue: { ...type.sectionTitle, color: colors.success },
  stopsProgressTrack: { height: 9, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.disabledSurface },
  stopsProgressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.success },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterChip: { minHeight: 42, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  filterChipActive: { backgroundColor: colors.infoSoft, borderColor: colors.info },
  filterText: { ...type.secondaryStrong, color: colors.textSecondary },
  filterTextActive: { color: colors.info },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  deliveredCard: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  failedCard: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  cardHeaderText: { flex: 1, minWidth: 0 },
  chevron: { color: colors.textMuted, fontSize: 16, fontFamily: fonts.heading },
  order: { color: colors.info, fontFamily: fonts.headingSemiBold },
  address: { color: colors.text, ...type.cardTitle },
  weight: { color: colors.text, fontSize: 16, fontFamily: fonts.headingSemiBold },
  eta: { color: colors.info, ...type.cardTitle },
  schedule: { color: colors.text, fontFamily: fonts.headingSemiBold },
  informational: { color: colors.textMuted, opacity: 0.7, lineHeight: 20 },
  offline: { color: colors.warning, fontSize: 13, fontFamily: fonts.headingSemiBold },
  heading: { color: colors.text, fontSize: 17, fontFamily: fonts.heading },
  meta: { color: colors.textMuted, lineHeight: 20 },
  failure: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  navigateButton: { flex: 1, minWidth: 100, minHeight: 46, borderWidth: 1, borderColor: colors.actionRoute, borderRadius: radius.md, backgroundColor: colors.actionRoute, alignItems: 'center', justifyContent: 'center' },
  deliverButton: { flex: 1, minWidth: 100, minHeight: 46, borderRadius: radius.md, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  failButton: { flex: 1, minWidth: 100, minHeight: 46, borderWidth: 1, borderRadius: radius.md, borderColor: colors.danger, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...type.button, color: colors.textInverse },
  failText: { color: colors.danger, fontFamily: fonts.heading },
  recalculateButton: { minHeight: 46, borderWidth: 1, borderRadius: radius.md, borderColor: colors.info, alignItems: 'center', justifyContent: 'center' },
  modalKeyboard: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 10, 2, 0.5)' },
  centeredBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0, 10, 2, 0.5)' },
  addStopDialog: { width: '100%', maxWidth: 420, padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  failureSheet: { maxHeight: '92%', paddingTop: spacing.sm, paddingHorizontal: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.md },
  finishSheet: { maxHeight: '92%', paddingTop: spacing.sm, paddingHorizontal: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: { padding: spacing.sm, borderWidth: 1, borderRadius: radius.md, borderColor: colors.border, color: colors.text, overflow: 'hidden' },
  activeReason: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.danger, color: colors.textInverse, fontFamily: fonts.heading, borderWidth: 1, borderColor: colors.danger, overflow: 'hidden' },
  textArea: { minHeight: 88, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, padding: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, textAlignVertical: 'top' },
  failConfirm: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  modalActions: { gap: spacing.xs },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  finishButton: { minHeight: 56, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  recalculationCard: { padding: spacing.md, borderWidth: 1, borderRadius: radius.md, borderColor: colors.info, backgroundColor: colors.infoSoft, gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, fontFamily: fonts.body },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderRadius: radius.md, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.textSecondary, fontFamily: fonts.heading },
  undoButton: { minHeight: 46, borderWidth: 1, borderRadius: radius.md, borderColor: colors.warning, backgroundColor: colors.warningSoft, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.warning, fontFamily: fonts.heading },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  notice: { color: colors.info, fontFamily: fonts.heading },
  headerBack: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  headerMenu: { minWidth: 72, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  headerBackText: { color: colors.textInverse, fontFamily: fonts.heading },
  menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 10, 2, 0.52)' },
  menuSheet: { paddingTop: spacing.sm, paddingHorizontal: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  menuTitle: { ...type.sectionTitle, color: colors.text, marginBottom: spacing.xs },
  menuItem: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border, justifyContent: 'center' },
  menuItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuItemText: { ...type.cardTitle, color: colors.text },
  menuChevron: { color: colors.textMuted, fontFamily: fonts.heading, fontSize: 18 },
  menuSubmenu: { marginLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.md },
  menuSubitem: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border, justifyContent: 'center' },
  menuSubitemText: { ...type.secondaryStrong, color: colors.text },
  menuDangerText: { ...type.cardTitle, color: colors.danger },
  menuClose: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  disabled: { opacity: 0.5 },
});
