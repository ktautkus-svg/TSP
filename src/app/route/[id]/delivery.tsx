import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { Alert } from '@/ui/alert';
import { buildNavigationUrls, navigationTargetFromStop } from '@/application/navigation/navigation-url-builder';
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
import { FoundationScreen } from '@/components/foundation-screen';
import { RoadProgressBar } from '@/components/road-progress-bar';
import { SwipeActionCard } from '@/components/swipe-action-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import { GatewayGeocodingProvider } from '@/infrastructure/routing/providers/gateway-geocoding-provider';
import { DELIVERY_FAILURE_REASONS, deliveryMatchesFilter, type DeliveryFailureReason } from '@/domain/delivery-failure';
import type { DeliveryFilter, DeliveryStop, Route } from '@/domain/route';
import { fonts, spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { failedDeliveryLabel, userVisibleStopNote } from '@/ui/route-labels';
import { durationLabel, etaLabel, legLabel, offlineEtaLabel, scheduleLabel, windowLabel, windowUrgencyColor } from '@/ui/route-eta-labels';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

function ScheduleDot({ stop, colors, routeDate }: { stop?: DeliveryStop | null; colors: ColorPalette; routeDate?: string | null }) {
  const color = windowUrgencyColor(stop, routeDate);
  if (!color) return null;
  return <View testID="schedule-dot" style={{ width: 9, height: 9, backgroundColor: colors[color] }} />;
}

// Automotive-dashboard gauge geometry: a 270° sweep starting at "7:30" and
// ending at "4:30" (like a speedometer), leaving a 90° gap at the bottom.
const GAUGE_START_ANGLE = -225;
const GAUGE_SWEEP = 270;
const GAUGE_TICK_COUNT = 28;

// Whichever of deliveredAt/failedAt is set is when the stop was resolved.
function recalcTimestamp(stop: DeliveryStop): string | null {
  return stop.deliveryStatus === 'delivered' ? stop.deliveredAt : stop.deliveryStatus === 'failed' ? stop.failedAt : null;
}

export default function DeliveryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: routeId = '', redirectReason } = useLocalSearchParams<{ id: string; redirectReason?: string }>();
  const { colors } = useTheme();
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
  const completionDismissed = useRef(false);
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const geocoder = useMemo(() => new GatewayGeocodingProvider(), []);

  const load = useCallback(async () => {
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

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const delivered = async (stopId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await new MarkStopDelivered(db).execute(routeId, stopId);
      await load();
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
      await load();
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
    } catch (reason) {
      Alert.alert('Veiksmo atšaukti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const navigate = async (stop: DeliveryStop) => {
    try {
      const target = navigationTargetFromStop(stop);
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      const urls = buildNavigationUrls(target, platform);
      if (platform === 'web') {
        // https://waze.com/ul is a universal link: it opens the installed Waze
        // app directly on iOS/Android, or falls back to Waze's own website —
        // no canOpenURL probe needed (unlike the waze:// custom scheme, which
        // browsers can't reliably check, hence it was always skipped on web).
        await Linking.openURL(urls.waze);
        return;
      }
      const canWaze = await Linking.canOpenURL(urls.waze);
      await Linking.openURL(canWaze ? urls.waze : urls.fallback);
    } catch (reason) {
      Alert.alert('Navigacija neatidaryta', reason instanceof Error ? reason.message : 'Adresas netinkamas navigacijai.');
    }
  };

  const saveLateStartOdometer = async () => {
    try {
      await new SaveStartOdometer(db).execute(routeId, parseOdometer(startOdometer));
      await load();
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

  const stopRoute = () => {
    if (busy) return;
    Alert.alert('Stabdyti maršrutą?', 'Maršrutas bus atšauktas ir pristatymai nebebus vykdomi. Šio veiksmo negalėsite atšaukti.', [
      { text: 'Ne', style: 'cancel' },
      {
        text: 'Taip, stabdyti', style: 'destructive', onPress: () => { void (async () => {
          setBusy(true);
          try {
            await new CancelDraftRoute(db).execute(routeId);
            router.replace('/' as Href);
          } catch (reason) {
            Alert.alert('Nepavyko stabdyti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
          } finally {
            setBusy(false);
          }
        })(); },
      },
    ]);
  };

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => <Pressable onPress={handleBack} style={styles.headerBack}><Text style={styles.secondaryText}>← Atgal</Text></Pressable>,
    }} />
    <FoundationScreen showFoundationNotice={false} title="Pristatymo taškai" description="Būsenos iškart išsaugomos. Nepavykęs taškas lieka nepristatytas.">
      {redirectReason ? <Text style={styles.notice}>Maršrutas jau pradėtas. Grąžinome į vykdomą maršrutą.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {progress ? (
        <View style={styles.dashboard} testID="route-dashboard">
          <View style={styles.gaugeRow}>
            <DashboardGauge
              colors={colors}
              fraction={progress.totalKnownWeightKg > 0
                ? (progress.totalKnownWeightKg - progress.remainingKnownWeightKg) / progress.totalKnownWeightKg
                : 0}
              color={colors.success}
              label={`${progress.remainingKnownWeightKg.toFixed(1)} kg`}
              sublabel="Likęs svoris"
            />
            <DashboardGauge
              colors={colors}
              fraction={progress.totalStops > 0 ? progress.deliveredStops / progress.totalStops : 0}
              color={colors.info}
              label={String(progress.totalStops - progress.deliveredStops)}
              sublabel="Likę taškai"
            />
          </View>
          <RoadProgressBar
            colors={colors}
            fraction={progress.totalKnownWeightKg > 0
              ? (progress.totalKnownWeightKg - progress.remainingKnownWeightKg) / progress.totalKnownWeightKg
              : 0}
          />
          {nextStop ? (
            <View style={styles.nextStopCard} testID="dashboard-next-stop">
              <Text style={styles.dashboardCardLabel}>SEKANTIS TAŠKAS</Text>
              <Text style={styles.nextStopAddress}>{nextStop.normalizedAddress ?? nextStop.originalAddress}</Text>
              <View style={styles.etaRow}>
                <ScheduleDot stop={nextStop} colors={colors} routeDate={route?.date} />
                <Text style={styles.nextStopEta}>{etaLabel(nextStop)}</Text>
              </View>
              <View style={styles.tileRow}>
                <View style={styles.tile}>
                  <Text style={styles.tileValue}>{nextStop.legDistanceKm === null || nextStop.legDistanceKm === undefined ? '—' : new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 1 }).format(nextStop.legDistanceKm)}</Text>
                  <Text style={styles.tileCaption}>KM IKI TAŠKO</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileValue}>{nextStop.legDurationMinutes === null || nextStop.legDurationMinutes === undefined ? '—' : durationLabel(nextStop.legDurationMinutes)}</Text>
                  <Text style={styles.tileCaption}>LAIKAS IKI TAŠKO</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.nextStopCard} testID="dashboard-next-stop">
              <Text style={styles.dashboardCardLabel}>SEKANTIS TAŠKAS</Text>
              <Text style={styles.nextStopAddress}>Visi taškai apdoroti</Text>
            </View>
          )}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ClockIcon color={colors.textMuted} />
              <Text style={styles.statValue}>{elapsedLabel(route?.startedAt ?? null)}</Text>
              <Text style={styles.statCaption}>Laikas kelyje</Text>
            </View>
            <View style={styles.statItem}>
              <BoxIcon color={colors.textMuted} />
              <Text style={styles.statValue}>{progress.deliveredStops}/{progress.totalStops}</Text>
              <Text style={styles.statCaption}>Pristatyta / viso</Text>
            </View>
            <View style={styles.statItem}>
              <RoadIcon color={colors.textMuted} />
              <Text style={styles.statValue}>{progress.preliminaryRemainingDistanceKm?.toFixed(0) ?? '—'} km</Text>
              <Text style={styles.statCaption}>Liko nuvažiuoti</Text>
            </View>
          </View>
          <Pressable
            disabled={busy}
            testID="stop-route-button"
            style={[styles.stopRouteButton, busy && styles.disabled]}
            onPress={stopRoute}>
            <StopIcon color="#fff" />
            <Text style={styles.stopRouteText}>Stabdyti maršrutą</Text>
          </Pressable>
        </View>
      ) : null}
      {route?.startOdometer === null ? (
        <View style={styles.reminder}>
          <Text style={styles.heading}>Trūksta pradinio odometro</Text>
          <TextInput value={startOdometer} onChangeText={setStartOdometer} keyboardType="decimal-pad" placeholder="Pvz. 125430,5" style={styles.input} />
          <Pressable style={styles.secondaryButton} onPress={saveLateStartOdometer}><Text style={styles.secondaryText}>Įvesti dabar</Text></Pressable>
        </View>
      ) : null}
      {undo ? <Pressable style={styles.undoButton} onPress={undoLast}><Text style={styles.undoText}>Atšaukti paskutinį veiksmą</Text></Pressable> : null}
      <Pressable
        testID="toggle-add-stop"
        style={styles.secondaryButton}
        onPress={() => setShowAddStop(true)}>
        <Text style={styles.secondaryText}>+ ĮTRAUKTI SUSTOJIMĄ</Text>
      </Pressable>
      <View style={styles.filters}>
        {(['undelivered', 'all', 'delivered', 'failed'] as DeliveryFilter[]).map((value) => (
          <Pressable key={value} onPress={() => setFilter(value)}><Text style={filter === value ? styles.active : styles.filter}>{filterLabel(value)}</Text></Pressable>
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
              <Text style={styles.weight}>{stop.weightKg === null ? 'Svoris nežinomas' : `${stop.weightKg} kg`}</Text>
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
                  <Pressable style={styles.navigateButton} onPress={() => { void navigate(stop); }}><Text style={styles.secondaryText}>Navigacija</Text></Pressable>
                  <Pressable style={styles.deliverButton} onPress={() => { void delivered(stop.id); }}><Text style={styles.buttonText}>Pristatyta</Text></Pressable>
                  <Pressable style={styles.failButton} onPress={() => beginFailed(stop.id)}><Text style={styles.failText}>Nepavyko</Text></Pressable>
                </View>
              </>
            ) : null}
          </SwipeActionCard>
        );
      })}
      <Pressable disabled={busy} style={[styles.finishButton, busy && styles.disabled]} onPress={() => void beginFinish()}><Text style={styles.buttonText}>{route?.completionStartedAt ? 'Tęsti užbaigimą' : 'Užbaigti maršrutą'}</Text></Pressable>
      {showFinish ? (
        <View style={styles.finishCard} testID="route-finish-summary">
          <Text style={styles.heading}>Maršruto santrauka</Text>
          <Text style={styles.meta}>Taškai: {progress?.totalStops ?? 0} · sėkmingi {progress?.deliveredStops ?? 0} · nepavykę {progress?.failedStops ?? 0} · liko {progress?.remainingStops ?? 0}</Text>
          <Text style={styles.meta}>Pristatytas žinomas svoris: {((progress?.totalKnownWeightKg ?? 0) - (progress?.remainingKnownWeightKg ?? 0)).toFixed(1)} kg</Text>
          <Text style={styles.meta}>Nepristatytas žinomas svoris: {progress?.remainingKnownWeightKg.toFixed(1) ?? '0.0'} kg</Text>
          <Text style={styles.meta}>Pradinis odometras: {route?.startOdometer ?? 'neįvestas'}</Text>
          <Text style={styles.meta}>Planuoti kilometrai: {route?.estimatedDistanceKm?.toFixed(1) ?? '—'}</Text>
          <TextInput value={endOdometer} onChangeText={(value) => { setEndOdometer(value); persistCompletionDraft(value); }} keyboardType="decimal-pad" placeholder="Galutinis odometras" style={styles.input} />
          <Pressable disabled={busy} style={[styles.finishButton, busy && styles.disabled]} onPress={() => void finish(false, false)}><Text style={styles.buttonText}>Patvirtinti užbaigimą</Text></Pressable>
          <Pressable disabled={busy} style={styles.cancelButton} onPress={leaveFinish}><Text style={styles.secondaryText}>Grįžti</Text></Pressable>
        </View>
      ) : null}
    </FoundationScreen>
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

function DashboardGauge(props: { fraction: number; color: string; label: string; sublabel: string; colors: ColorPalette }) {
  const { colors } = props;
  const size = 156;
  const strokeWidth = 15;
  const radius = (size - strokeWidth) / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const trackArcLength = (GAUGE_SWEEP / 360) * circumference;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(props.fraction) ? props.fraction : 0));
  const animatedFraction = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animatedFraction.setValue(0);
    Animated.timing(animatedFraction, {
      toValue: clamped,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [animatedFraction, clamped]);

  const strokeDashoffset = animatedFraction.interpolate({
    inputRange: [0, 1],
    outputRange: [trackArcLength, 0],
  });
  const capRotation = animatedFraction.interpolate({
    inputRange: [0, 1],
    outputRange: [GAUGE_START_ANGLE + 90, GAUGE_START_ANGLE + GAUGE_SWEEP + 90],
  });

  const ticks = Array.from({ length: GAUGE_TICK_COUNT }, (_, index) => {
    const angle = GAUGE_START_ANGLE + (index / (GAUGE_TICK_COUNT - 1)) * GAUGE_SWEEP;
    const rad = (angle * Math.PI) / 180;
    const major = index % 7 === 0;
    const outerR = radius + strokeWidth / 2 + 5;
    const innerR = outerR - (major ? 11 : 5);
    return {
      key: index,
      major,
      x1: cx + innerR * Math.cos(rad),
      y1: cy + innerR * Math.sin(rad),
      x2: cx + outerR * Math.cos(rad),
      y2: cy + outerR * Math.sin(rad),
    };
  });

  const capDistance = radius;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        {ticks.map((tick) => (
          <Line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={tick.major ? colors.text : colors.border}
            strokeWidth={tick.major ? 2.5 : 1.2}
            strokeLinecap="round"
          />
        ))}
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${trackArcLength}, ${circumference}`}
          rotation={GAUGE_START_ANGLE}
          origin={`${cx}, ${cy}`}
        />
        <AnimatedCircle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={props.color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${trackArcLength}, ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="butt"
          rotation={GAUGE_START_ANGLE}
          origin={`${cx}, ${cy}`}
        />
        {/* Small accent cap marking the current end of the filled arc — the
            "harder" detail beyond a flat progress ring, without a full needle. */}
        <AnimatedG rotation={capRotation} origin={`${cx}, ${cy}`}>
          <Circle cx={cx} cy={cy - capDistance} r={strokeWidth / 2 + 2} fill={colors.surface} stroke={props.color} strokeWidth={3} />
          <Circle cx={cx} cy={cy - capDistance} r={3} fill={props.color} />
        </AnimatedG>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', top: size * 0.58 }} pointerEvents="none">
        <Text style={{ color: colors.text, fontSize: 19, fontFamily: fonts.headingExtraBold }}>{props.label}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.headingSemiBold, marginTop: 2, textAlign: 'center', letterSpacing: 0.5 }}>{props.sublabel.toUpperCase()}</Text>
      </View>
    </View>
  );
}

function ClockIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} fill="none" />
      <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

function BoxIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M4 8l8-4 8 4-8 4-8-4zm0 0v8l8 4m0-12v12m8-12v8l-8 4"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function RoadIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M4 20c0-6 6-4 6-10S4 4 4 4M20 20c0-6-6-4-6-10s6-6 6-6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

function StopIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Rect x={5} y={5} width={14} height={14} rx={2} fill={color} />
    </Svg>
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
  dashboard: { gap: spacing.md, backgroundColor: colors.background },
  gaugeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg },
  nextStopCard: { padding: spacing.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  dashboardCardLabel: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.headingSemiBold, letterSpacing: 0.8 },
  nextStopAddress: { color: colors.text, fontSize: 18, fontFamily: fonts.heading },
  nextStopMeta: { color: colors.textMuted, lineHeight: 20 },
  nextStopEta: { color: colors.accent, fontSize: 16, fontFamily: fonts.heading },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  tile: { flex: 1, padding: spacing.sm, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', gap: 2 },
  tileValue: { color: colors.text, fontSize: 20, fontFamily: fonts.headingExtraBold },
  tileCaption: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.headingSemiBold, letterSpacing: 0.6, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statItem: { flex: 1, padding: spacing.sm, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', gap: 4 },
  statValue: { color: colors.text, fontSize: 18, fontFamily: fonts.headingExtraBold },
  statCaption: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.headingSemiBold, textAlign: 'center' },
  stopRouteButton: { minHeight: 56, backgroundColor: colors.danger, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  stopRouteText: { color: '#fff', fontFamily: fonts.heading, fontSize: 16 },
  reminder: { padding: spacing.md, borderWidth: 2, borderColor: colors.warning, backgroundColor: colors.surface, gap: spacing.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filter: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, overflow: 'hidden', fontFamily: fonts.headingSemiBold },
  active: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: '#fff', fontFamily: fonts.heading, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.accent, overflow: 'hidden' },
  card: { padding: spacing.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  deliveredCard: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  failedCard: { borderColor: colors.danger },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  cardHeaderText: { flex: 1, minWidth: 0 },
  chevron: { color: colors.textMuted, fontSize: 16, fontFamily: fonts.heading },
  order: { color: colors.accent, fontFamily: fonts.headingSemiBold },
  address: { color: colors.text, fontSize: 17, fontFamily: fonts.heading },
  weight: { color: colors.text, fontSize: 16, fontFamily: fonts.headingSemiBold },
  eta: { color: colors.accent, fontSize: 17, fontFamily: fonts.heading },
  schedule: { color: colors.text, fontFamily: fonts.headingSemiBold },
  informational: { color: colors.textMuted, opacity: 0.7, lineHeight: 20 },
  offline: { color: colors.warning, fontSize: 13, fontFamily: fonts.headingSemiBold },
  heading: { color: colors.text, fontSize: 17, fontFamily: fonts.heading },
  meta: { color: colors.textMuted, lineHeight: 20 },
  failure: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  navigateButton: { flex: 1, minWidth: 100, minHeight: 46, borderWidth: 2, borderColor: colors.brandNavy, alignItems: 'center', justifyContent: 'center' },
  deliverButton: { flex: 1, minWidth: 100, minHeight: 46, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  failButton: { flex: 1, minWidth: 100, minHeight: 46, borderWidth: 2, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontFamily: fonts.heading },
  failText: { color: colors.danger, fontFamily: fonts.heading },
  recalculateButton: { minHeight: 46, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  modalKeyboard: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 10, 2, 0.5)' },
  centeredBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0, 10, 2, 0.5)' },
  addStopDialog: { width: '100%', maxWidth: 420, padding: spacing.lg, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  failureSheet: { maxHeight: '92%', paddingTop: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, gap: spacing.md },
  sheetHandle: { alignSelf: 'center', width: 44, height: 5, backgroundColor: colors.border },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: { padding: spacing.sm, borderWidth: 2, borderColor: colors.border, color: colors.text, overflow: 'hidden' },
  activeReason: { padding: spacing.sm, backgroundColor: colors.danger, color: '#fff', fontFamily: fonts.heading, borderWidth: 2, borderColor: colors.danger, overflow: 'hidden' },
  textArea: { minHeight: 88, borderWidth: 2, borderColor: colors.border, padding: spacing.md, color: colors.text, textAlignVertical: 'top' },
  failConfirm: { minHeight: 50, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  modalActions: { gap: spacing.xs },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  finishButton: { minHeight: 56, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  finishCard: { padding: spacing.md, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.surface, gap: spacing.sm },
  recalculationCard: { padding: spacing.md, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft, gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 2, borderColor: colors.border, paddingHorizontal: spacing.md, color: colors.text, fontFamily: fonts.body },
  secondaryButton: { minHeight: 46, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.accent, fontFamily: fonts.heading },
  undoButton: { minHeight: 46, borderWidth: 2, borderColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.warning, fontFamily: fonts.heading },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  notice: { color: colors.accent, fontFamily: fonts.heading },
  headerBack: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
});
