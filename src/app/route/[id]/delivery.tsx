import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Alert } from '@/ui/alert';
import { buildNavigationUrls, navigationTargetFromStop } from '@/application/navigation/navigation-url-builder';
import {
  ProposeRemainingRouteRecalculation,
  ResolveRouteRecalculation,
  type RouteRecalculationProposal,
} from '@/application/routes/route-recalculation';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import {
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
import { SwipeActionCard } from '@/components/swipe-action-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import { DELIVERY_FAILURE_REASONS, deliveryMatchesFilter, type DeliveryFailureReason } from '@/domain/delivery-failure';
import type { DeliveryFilter, DeliveryStop, Route } from '@/domain/route';
import { colors, fonts, spacing } from '@/ui/tokens';
import { failedDeliveryLabel, userVisibleStopNote } from '@/ui/route-labels';
import { etaLabel, legLabel, offlineEtaLabel, scheduleLabel, windowLabel } from '@/ui/route-eta-labels';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export default function DeliveryScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: routeId = '', redirectReason } = useLocalSearchParams<{ id: string; redirectReason?: string }>();
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
  const completionDismissed = useRef(false);
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());

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
  const recalculationAnchor = [...stops]
    .filter((stop) => stop.deliveryStatus === 'failed')
    .sort((left, right) => (right.failedAt ?? '').localeCompare(left.failedAt ?? ''))[0] ?? null;
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
            <CircularGauge
              fraction={progress.totalKnownWeightKg > 0
                ? (progress.totalKnownWeightKg - progress.remainingKnownWeightKg) / progress.totalKnownWeightKg
                : 0}
              color={colors.success}
              label={`${progress.remainingKnownWeightKg.toFixed(1)} kg`}
              sublabel="Likęs svoris"
            />
            <CircularGauge
              fraction={progress.totalStops > 0 ? progress.deliveredStops / progress.totalStops : 0}
              color={colors.info}
              label={String(progress.remainingStops)}
              sublabel="Likę taškai"
            />
          </View>
          {nextStop ? (
            <View style={styles.nextStopCard} testID="dashboard-next-stop">
              <Text style={styles.dashboardCardLabel}>SEKANTIS TAŠKAS</Text>
              <Text style={styles.nextStopAddress}>{nextStop.normalizedAddress ?? nextStop.originalAddress}</Text>
              <Text style={styles.nextStopMeta}>{legLabel(nextStop)}</Text>
              <Text style={styles.nextStopEta}>{etaLabel(nextStop)}</Text>
            </View>
          ) : (
            <View style={styles.nextStopCard} testID="dashboard-next-stop">
              <Text style={styles.dashboardCardLabel}>SEKANTIS TAŠKAS</Text>
              <Text style={styles.nextStopAddress}>Visi taškai apdoroti</Text>
            </View>
          )}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{elapsedLabel(route?.startedAt ?? null)}</Text>
              <Text style={styles.statCaption}>Laikas kelyje</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{progress.deliveredStops}/{progress.totalStops}</Text>
              <Text style={styles.statCaption}>Pristatyta / viso</Text>
            </View>
          </View>
          <Pressable
            disabled={busy}
            testID="stop-route-button"
            style={[styles.stopRouteButton, busy && styles.disabled]}
            onPress={stopRoute}>
            <Text style={styles.stopRouteText}>Stabdyti maršrutą</Text>
          </Pressable>
        </View>
      ) : null}
      {progress ? (
        <View style={styles.summary} testID="delivery-progress">
          <Text style={styles.heading}>Pristatyta {progress.deliveredStops} / {progress.totalStops} ({progress.deliveryPercent}%)</Text>
          <Text style={styles.meta}>Liko {progress.remainingStops} · {progress.remainingKnownWeightKg.toFixed(1)} kg žinomo svorio</Text>
          {progress.remainingUnknownWeightStops ? <Text style={styles.meta}>{progress.remainingUnknownWeightStops} likusių taškų svoris nežinomas</Text> : null}
          <Text style={styles.meta}>Preliminariai liko: {progress.preliminaryRemainingDistanceKm?.toFixed(1) ?? '—'} km</Text>
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
      {visibleStops.map((stop) => {
        const expanded = expandedStopId === stop.id;
        return (
          <SwipeActionCard key={stop.id} onSwipeRight={() => { void delivered(stop.id); }} onSwipeLeft={() => beginFailed(stop.id)} style={[styles.card, stop.deliveryStatus === 'delivered' && styles.deliveredCard, stop.deliveryStatus === 'failed' && styles.failedCard]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpandedStopId(expanded ? null : stop.id)}
              style={styles.cardHeader}>
              <View style={styles.cardHeaderText}>
                <Text style={styles.order}>{statusLabel(stop)}{stop.priorityFirst ? ' ⭐' : ''}</Text>
                <Text style={styles.address}>{stop.normalizedAddress ?? stop.originalAddress}</Text>
              </View>
              <Text style={styles.weight}>{stop.weightKg === null ? 'Svoris nežinomas' : `${stop.weightKg} kg`}</Text>
              <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded ? (
              <>
                <Text style={styles.eta}>{etaLabel(stop)}</Text>
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

function CircularGauge(props: { fraction: number; color: string; label: string; sublabel: string }) {
  const size = 128;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
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
    outputRange: [circumference, 0],
  });

  return (
    <View style={styles.gauge}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={props.color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.gaugeCenter} pointerEvents="none">
        <Text style={styles.gaugeLabel}>{props.label}</Text>
        <Text style={styles.gaugeSublabel}>{props.sublabel}</Text>
      </View>
    </View>
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

const styles = StyleSheet.create({
  dashboard: { gap: spacing.md },
  gaugeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg },
  gauge: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  gaugeCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  gaugeLabel: { color: colors.text, fontSize: 20, fontWeight: '800', fontFamily: fonts.mono },
  gaugeSublabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  nextStopCard: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  dashboardCardLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  nextStopAddress: { color: colors.text, fontSize: 18, fontWeight: '800' },
  nextStopMeta: { color: colors.textMuted, lineHeight: 20 },
  nextStopEta: { color: colors.info, fontSize: 16, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statItem: { flex: 1, padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', gap: 2 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800', fontFamily: fonts.mono },
  statCaption: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  stopRouteButton: { minHeight: 56, borderRadius: 16, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  stopRouteText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  summary: { padding: spacing.md, borderRadius: 16, backgroundColor: colors.primarySoft, gap: spacing.xs },
  reminder: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surface, gap: spacing.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filter: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, color: colors.text, backgroundColor: colors.surface, overflow: 'hidden' },
  active: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, color: '#fff', fontWeight: '800', backgroundColor: colors.primary, overflow: 'hidden' },
  card: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  deliveredCard: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  failedCard: { borderColor: colors.danger },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  cardHeaderText: { flex: 1, minWidth: 0 },
  chevron: { color: colors.textMuted, fontSize: 16, fontWeight: '800' },
  order: { color: colors.primary, fontWeight: '800' },
  address: { color: colors.text, fontSize: 17, fontWeight: '800' },
  weight: { color: colors.text, fontSize: 16, fontWeight: '700' },
  eta: { color: colors.primary, fontSize: 17, fontWeight: '800' },
  schedule: { color: colors.text, fontWeight: '700' },
  informational: { color: colors.textMuted, opacity: 0.7, lineHeight: 20 },
  offline: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.textMuted, lineHeight: 20 },
  failure: { color: colors.danger, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  navigateButton: { flex: 1, minWidth: 100, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  deliverButton: { flex: 1, minWidth: 100, minHeight: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  failButton: { flex: 1, minWidth: 100, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '800' },
  failText: { color: colors.danger, fontWeight: '800' },
  recalculateButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  modalKeyboard: { flex: 1 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.42)' },
  failureSheet: { maxHeight: '92%', paddingTop: spacing.sm, paddingHorizontal: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface, gap: spacing.md },
  sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: colors.border },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: { padding: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border, color: colors.text, overflow: 'hidden' },
  activeReason: { padding: spacing.sm, borderRadius: 999, backgroundColor: colors.danger, color: '#fff', fontWeight: '800', overflow: 'hidden' },
  textArea: { minHeight: 88, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.text, textAlignVertical: 'top' },
  failConfirm: { minHeight: 50, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  modalActions: { gap: spacing.xs },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  finishButton: { minHeight: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  finishCard: { padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, gap: spacing.sm },
  recalculationCard: { padding: spacing.md, borderRadius: 16, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft, gap: spacing.sm },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, color: colors.text },
  secondaryButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  undoButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.warning, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
  notice: { color: colors.primary, fontWeight: '800' },
  headerBack: { minWidth: 72, minHeight: 44, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
});
