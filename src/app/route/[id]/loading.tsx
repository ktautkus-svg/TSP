import { canApproveExpiredDeparture } from '@/application/auth/employee-permissions';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { markRouteDeletedForCloud } from '@/application/sync/route-cloud-sync';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
    approveExpiredDepartureOverride,
    refreshDepartureReadiness,
    requestExpiredDepartureOverride,
} from '@/application/operations/departure-readiness';
import { ActivateRoute, CancelDraftRoute, ReopenRouteForPlanning, UpdateStopPhone } from '@/application/routes/route-commands';
import { resolveRoute } from '@/application/routes/route-navigation';
import {
    GetLatestUndoableAction,
    GetRouteProgress,
    MarkAllStopsLoaded,
    MarkStopLoaded,
    MarkStopNotLoaded,
    MarkStopUnloaded,
    parseOdometer,
    ReverseStopOrder,
    SaveStartOdometer,
    StartRoute,
    UndoRouteAction,
    type RouteProgress,
    type UndoableAction,
} from '@/application/routes/route-workday';
import { CheckIcon, CrossIcon, PencilIcon, TruckIcon } from '@/components/app-icons';
import { DepartureGateCard } from '@/components/departure-gate-card';
import { FoundationScreen } from '@/components/foundation-screen';
import { SwipeActionCard } from '@/components/swipe-action-card';
import { RouteRepository } from '@/database/repositories/route-repository';
import { LOADING_FAILURE_REASONS, type LoadingFailureReason } from '@/domain/loading-failure';
import type { DeliveryStop, Route } from '@/domain/route';
import type { DepartureReadiness } from '@/domain/departure-readiness';
import { employeeApi, type FuelStatus } from '@/infrastructure/auth/employee-session';
import { Alert } from '@/ui/alert';
import { formatWeightKg } from '@/ui/format-weight';
import { clockLabel, etaLabel, legLabel, windowLabel } from '@/ui/route-eta-labels';
import { userVisibleStopNote } from '@/ui/route-labels';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';
import { describeVehicleLoad } from '@/ui/vehicle-load';

export default function LoadingScreen() {
  const { profile, online } = useLocalAccess();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const db = useSQLiteContext();
  const router = useRouter();
  const { id: routeId = '', returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const [undo, setUndo] = useState<UndoableAction | null>(null);
  const [odometer, setOdometer] = useState('');
  const [busy, setBusy] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [notLoadedStopId, setNotLoadedStopId] = useState<string | null>(null);
  const [notLoadedReason, setNotLoadedReason] = useState<LoadingFailureReason>('Atšauktas užsakymas');
  const [odometerModalVisible, setOdometerModalVisible] = useState(false);
  const [fuelStatus, setFuelStatus] = useState<FuelStatus | null>(null);
  const [fuelInput, setFuelInput] = useState('');
  const [fuelBusy, setFuelBusy] = useState(false);
  const [readiness, setReadiness] = useState<DepartureReadiness | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const bulkInFlight = useRef(false);
  const odometerPrompted = useRef(false);
  // See alternatives.tsx: suppresses this screen's own status guard while a
  // deliberate cancel is navigating away, so it cannot redirect to /history.
  const selfCancelled = useRef(false);

  const load = useCallback(async () => {
    if (selfCancelled.current) return;
    setBusy(true);
    try {
      const persisted = await repository.getWithStops(routeId);
      if (!persisted) throw new Error('Maršrutas nerastas.');
      if (persisted.route.startOdometer === null) {
        const previous = await db.getFirstAsync<{ end_odometer: number }>(
          `SELECT end_odometer FROM routes
           WHERE id <> ? AND status = 'completed' AND end_odometer IS NOT NULL
           ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 1`,
          routeId,
        );
        if (previous) setOdometer((current) => current || String(previous.end_odometer));
      }
      if (persisted.route.status === 'planned') {
        setRoute(persisted.route);
        setStops(persisted.stops);
        setProgress(null);
        setUndo(null);
        setReadiness(await refreshDepartureReadiness(db, [], { online }));
        setError(null);
        return;
      }
      const refreshed = persisted;
      if (refreshed.route.status === 'in_progress') {
        const destination = resolveRoute(refreshed.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      if (!['loading', 'loaded'].includes(refreshed.route.status)) {
        const destination = resolveRoute(refreshed.route);
        router.replace({ pathname: destination.pathname, params: destination.params } as Href);
        return;
      }
      if (refreshed.route.status === 'loaded' && !odometerPrompted.current) {
        const nextReadiness = await refreshDepartureReadiness(db, await repository.getStops(routeId, 'loading'), { online });
        if (nextReadiness.canDepart) {
          odometerPrompted.current = true;
          setOdometerModalVisible(true);
        }
      }
      setRoute(refreshed.route);
      const loadingStops = await repository.getStops(routeId, 'loading');
      setStops(loadingStops);
      setProgress(await new GetRouteProgress(db).execute(routeId));
      setUndo(await new GetLatestUndoableAction(db).execute(routeId));
      setReadiness(await refreshDepartureReadiness(db, loadingStops, { online }));
      if (refreshed.route.startOdometer !== null) setOdometer(String(refreshed.route.startOdometer));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Krovimo plano atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  }, [db, online, repository, routeId, router]);

  const loadFuel = useCallback(async () => {
    if (profile.role !== 'driver' || !online) return;
    try {
      const status = await employeeApi<FuelStatus>('/api/fuel-status');
      setFuelStatus(status);
      if (status.vehicle?.fuelRemainingLiters !== null && status.vehicle?.fuelRemainingLiters !== undefined) {
        setFuelInput((current) => current || String(status.vehicle!.fuelRemainingLiters));
      }
    } catch {
      // Fuel confirmation is server-backed; offline route operation remains
      // possible and the confirmation is requested again when online.
    }
  }, [online, profile.role]);

  const openDispatcherAssignment = () => {
    router.replace({ pathname: '/route-management', params: { routeId } } as unknown as Href);
  };

  useFocusEffect(useCallback(() => { void load(); void loadFuel(); }, [load, loadFuel]));

  useEffect(() => {
    if (syncRevision > 0) void load();
  }, [load, syncRevision]);

  const markLoaded = async (stopId: string) => {
    try {
      await new MarkStopLoaded(db).execute(routeId, stopId);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Nepavyko pažymėti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const markUnloaded = async (stopId: string) => {
    try {
      await new MarkStopUnloaded(db).execute(routeId, stopId);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Nepavyko atžymėti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const beginNotLoaded = (stopId: string) => {
    setNotLoadedStopId(stopId);
    setNotLoadedReason('Atšauktas užsakymas');
  };

  const saveNotLoaded = async () => {
    if (!notLoadedStopId || bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      await new MarkStopNotLoaded(db).execute(routeId, notLoadedStopId, notLoadedReason);
      setNotLoadedStopId(null);
      setExpandedStopId(null);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Nepavyko išsaugoti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
    }
  };

  const markAllLoaded = async () => {
    if (bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      const result = await new MarkAllStopsLoaded(db).execute(routeId);
      await load();
      void requestSync('mutation');
      if (!result.idempotent) {
        Alert.alert('Pakrovimas atnaujintas', 'Visi kroviniai pažymėti kaip pakrauti');
      }
    } catch (reason) {
      Alert.alert('Nepavyko pažymėti visų', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
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

  const saveOdometer = async (): Promise<boolean> => {
    try {
      await new SaveStartOdometer(db).execute(routeId, parseOdometer(odometer));
      await load();
      void requestSync('mutation');
      return true;
    } catch (reason) {
      Alert.alert('Neteisingas odometras', reason instanceof Error ? reason.message : 'Patikrinkite reikšmę.');
      return false;
    }
  };

  // One button instead of a numbered two-step flow: save the odometer (if it
  // hasn't been saved yet) and immediately continue into starting the route.
  const beginRouteWithOdometer = async () => {
    if (route?.startOdometer === null) {
      const saved = await saveOdometer();
      if (!saved) return;
    }
    await startRoute();
  };

  const pickDifferentAlternative = () => {
    Alert.alert(
      'Pasirinkti kitą maršruto variantą?',
      'Grįšite į variantų ekraną. Pakrovimo pažymos išliks, bet maršruto seka bus perskaičiuota iš naujo.',
      [
        { text: 'Ne', style: 'cancel' },
        { text: 'Taip, grįžti', onPress: () => { void (async () => {
          try {
            await new ReopenRouteForPlanning(db).execute(routeId);
            void requestSync('mutation');
            router.replace({ pathname: '/route/[id]/alternatives', params: { id: routeId, ...(returnTo ? { returnTo } : {}) } });
          } catch (reason) {
            Alert.alert('Nepavyko grįžti', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
          }
        })(); } },
      ],
    );
  };

  const reverseDirection = () => {
    Alert.alert(
      'Apsukti pristatymo kryptį?',
      'Visas maršrutas bus apsuktas — paskutinis pristatymo taškas taps pirmu ir atvirkščiai. Krovimo sąrašas atsinaujins pagal naują kryptį.',
      [
        { text: 'Ne', style: 'cancel' },
        { text: 'Taip, apsukti', onPress: () => { void (async () => {
          try {
            await new ReverseStopOrder(db).execute(routeId);
            await load();
            void requestSync('mutation');
          } catch (reason) {
            Alert.alert('Nepavyko apsukti krypties', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
          }
        })(); } },
      ],
    );
  };

  const startRoute = async () => {
    try {
      await new StartRoute(db).execute(routeId);
      void requestSync('mutation');
      router.replace({ pathname: '/route/[id]/delivery', params: { id: routeId, ...(returnTo ? { returnTo } : {}) } });
    } catch (reason) {
      Alert.alert('Maršrutas nepradėtas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    }
  };

  const requestOverride = async () => {
    if (gateBusy) return;
    setGateBusy(true);
    try {
      await requestExpiredDepartureOverride(db, { requestedBy: profile.id, online });
      setReadiness(await refreshDepartureReadiness(db, stops, { online }));
    } catch (reason) {
      Alert.alert('Prašymas neišsiųstas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setGateBusy(false);
    }
  };

  const approveOverride = async () => {
    if (gateBusy) return;
    setGateBusy(true);
    try {
      await approveExpiredDepartureOverride(db, { approvedBy: profile.id, online });
      setReadiness(await refreshDepartureReadiness(db, stops, { online }));
    } catch (reason) {
      Alert.alert('Patvirtinti nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setGateBusy(false);
    }
  };

  const saveStopPhone = async (stop: DeliveryStop) => {
    const value = phoneDrafts[stop.id] ?? stop.phone ?? '';
    try {
      await new UpdateStopPhone(db).execute(routeId, stop.id, value);
      await load();
      void requestSync('mutation');
    } catch (reason) {
      Alert.alert('Telefonas neišsaugotas', reason instanceof Error ? reason.message : 'Patikrinkite numerį.');
    }
  };

  const beginLoading = () => {
    if (bulkInFlight.current) return;
    if (profile.role === 'driver' && online && fuelStatus?.requiresConfirmation) {
      Alert.alert('Patvirtinkite kuro likutį', 'Prieš pradedant krovimą patvirtinkite šio automobilio kuro likutį.');
      return;
    }
    if (readiness && !readiness.canBeginLoading) {
      Alert.alert('Važiuoti negalima', readiness.blockers[0]?.message ?? 'Pasibaigęs automobilio terminas. Važiuoti negalima.');
      return;
    }
    Alert.alert(
      'Pradėti pasikrovimą?',
      'Maršrutas pereis į krovimo būseną ir galėsite žymėti pakrautus taškus.',
      [
        { text: 'Ne', style: 'cancel' },
        {
          text: 'Taip, pradėti',
          onPress: () => { void (async () => {
            bulkInFlight.current = true;
            setBulkBusy(true);
            try {
              await new ActivateRoute(db).execute(routeId);
              await load();
              void requestSync('mutation');
            } catch (reason) {
              Alert.alert('Krovimas nepradėtas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
            } finally {
              bulkInFlight.current = false;
              setBulkBusy(false);
            }
          })(); },
        },
      ],
    );
  };

  const submitFuel = async () => {
    if (fuelBusy) return;
    const liters = Number(fuelInput.replace(',', '.'));
    if (!Number.isFinite(liters) || liters < 0) {
      Alert.alert('Neteisingas kuro likutis', 'Įveskite kuro kiekį litrais.');
      return;
    }
    setFuelBusy(true);
    try {
      const status = await employeeApi<FuelStatus>('/api/fuel-status', {
        method: 'POST', body: JSON.stringify({ liters }),
      });
      setFuelStatus(status);
      Alert.alert(status.approvalPending ? 'Pakeitimas perduotas' : 'Kuro likutis patvirtintas', status.approvalPending
        ? 'Rodmuo skiriasi nuo ankstesnio. Administratorius matys ir galės patvirtinti pakeitimą.'
        : 'Kuro likutis išsaugotas.');
    } catch (reason) {
      Alert.alert('Kuro likutis neišsaugotas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      setFuelBusy(false);
    }
  };

  const editPlannedRoute = async () => {
    if (bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      await new ReopenRouteForPlanning(db).execute(routeId);
      void requestSync('mutation');
      router.replace({ pathname: '/route/[id]/alternatives', params: { id: routeId, ...(returnTo ? { returnTo } : {}) } });
    } catch (reason) {
      Alert.alert('Redagavimas neatidarytas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
    }
  };

  const deletePlannedRoute = () => {
    if (bulkInFlight.current) return;
    Alert.alert(
      'Ištrinti maršrutą?',
      'Šis suplanuotas maršrutas bus pašalintas. Tada grįšite į naujo maršruto kūrimą.',
      [
        { text: 'Palikti', style: 'cancel' },
        {
          text: 'Ištrinti',
          style: 'destructive',
          onPress: () => {
            bulkInFlight.current = true;
            selfCancelled.current = true;
            setBulkBusy(true);
            void new CancelDraftRoute(db).execute(routeId)
              .then(async () => {
                await markRouteDeletedForCloud(db, routeId);
                await requestSync('mutation');
                router.replace('/import' as Href);
              })
              .catch((reason) => {
                selfCancelled.current = false;
                Alert.alert('Maršrutas neištrintas', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
              })
              .finally(() => {
                bulkInFlight.current = false;
                setBulkBusy(false);
              });
          },
        },
      ],
    );
  };

  const vehicleLoad = route
    ? describeVehicleLoad(route.totalWeightKg, fuelStatus?.vehicle?.maximumPayloadKg)
    : null;

  if (!busy && route?.status === 'planned') {
    return (
      <FoundationScreen
        showFoundationNotice={false}
        title="Suplanuotas maršrutas"
        description="Pasirinkite kitą veiksmą.">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.plannedSummary} testID="planned-route-summary">
          <Text style={styles.summaryTitle}>Maršrutas paruoštas</Text>
          <Text style={styles.summaryText}>Pristatymo taškai: {route.totalStops}</Text>
          <Text style={styles.summaryText}>Bendras svoris: {formatWeightKg(route.totalWeightKg)} kg</Text>
          {vehicleLoad ? <Text style={[styles.summaryText, vehicleLoad.overCapacity && styles.loadWarning]} testID="vehicle-load-percent">{vehicleLoad.summaryLabel}</Text> : null}
          <Text style={styles.summaryText}>Planuotas atstumas: {route.estimatedDistanceKm === null ? '—' : `${route.estimatedDistanceKm.toFixed(1)} km`}</Text>
        </View>
        {readiness ? (
          <DepartureGateCard
            readiness={readiness}
            canApprove={canApproveExpiredDeparture(profile)}
            busy={gateBusy}
            onApprove={() => { void approveOverride(); }}
            onRequestApproval={() => { void requestOverride(); }}
          />
        ) : null}
        {profile.role === 'driver' && online ? <View style={styles.fuelCard} testID="fuel-confirmation-card">
          <Text style={styles.summaryTitle}>Kuro likutis · {fuelStatus?.vehicle?.registrationNumber ?? 'automobilis'}</Text>
          {fuelStatus?.approvalPending ? <Text style={styles.fuelPending}>Pakeitimas laukia administratoriaus patvirtinimo. Maršrutą galite tęsti.</Text> : fuelStatus?.requiresConfirmation ? <Text style={styles.summaryText}>Patvirtinkite esamą likutį. Jei skaičius pasikeitė, administratorius gaus prašymą.</Text> : <Text style={styles.summaryText}>Patvirtinta: {fuelStatus?.vehicle?.fuelRemainingLiters ?? fuelStatus?.latestReport?.reportedLiters ?? '—'} l</Text>}
          {fuelStatus?.requiresConfirmation ? <View style={styles.fuelRow}>
            <TextInput value={fuelInput} onChangeText={(value) => setFuelInput(value.replace(/[^\d.,]/g, '').slice(0, 7))} keyboardType="decimal-pad" placeholder="Kuro likutis, l" style={[styles.input, styles.fuelInput]} />
            <Pressable disabled={fuelBusy || !fuelInput.trim()} onPress={() => void submitFuel()} style={[styles.fuelButton, (fuelBusy || !fuelInput.trim()) && styles.disabled]}><Text style={styles.primaryText}>{fuelBusy ? 'Saugoma…' : 'Patvirtinti'}</Text></Pressable>
          </View> : null}
        </View> : null}
        <View style={styles.plannedActions}>
        {profile.role === 'driver' ? <Pressable disabled={bulkBusy || Boolean(readiness && !readiness.canBeginLoading)} style={[styles.plannedPrimaryButton, (bulkBusy || Boolean(readiness && !readiness.canBeginLoading)) && styles.disabled]} onPress={beginLoading} testID="begin-loading">
          {bulkBusy ? <ActivityIndicator color="#fff" /> : <>
            <TruckIcon size={22} color="#FFFFFF" />
            <Text style={styles.plannedPrimaryText}>Pradėti krovimą</Text>
          </>}
        </Pressable> : <Pressable
          disabled={bulkBusy || !online}
          style={[styles.plannedPrimaryButton, (bulkBusy || !online) && styles.disabled]}
          onPress={openDispatcherAssignment}
          testID="assign-planned-route">
          <TruckIcon size={22} color="#FFFFFF" />
          <Text style={styles.plannedPrimaryText}>Priskirti maršrutą</Text>
        </Pressable>}
        {profile.role !== 'driver' || profile.permissions?.canReorderAssignedRoute ? <Pressable disabled={bulkBusy} style={[styles.plannedSecondaryButton, bulkBusy && styles.disabled]} onPress={() => { void editPlannedRoute(); }} testID="edit-planned-route">
          <PencilIcon size={19} color={colors.brandNavy} />
          <Text style={styles.plannedSecondaryText}>Redaguoti maršrutą</Text>
        </Pressable> : null}
        {profile.role !== 'driver' ? <Pressable disabled={bulkBusy} style={[styles.plannedSecondaryButton, bulkBusy && styles.disabled]} onPress={() => router.replace('/import' as Href)} testID="plan-another-route">
          <Text style={styles.plannedSecondaryText}>Tęsti nepriskyrus</Text>
        </Pressable> : null}
        {profile.role !== 'driver' || profile.permissions?.canCancelRoute ? <Pressable disabled={bulkBusy} style={[styles.plannedCancelButton, bulkBusy && styles.disabled]} onPress={deletePlannedRoute} testID="delete-planned-route">
          <CrossIcon size={19} color={colors.danger} />
          <Text style={styles.plannedCancelText}>Ištrinti maršrutą</Text>
        </Pressable> : null}
        </View>
      </FoundationScreen>
    );
  }

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Krovimo planas"
    description="Krovimo seka eina nuo viršaus: 1 reiškia pirmą krovinį į automobilį, ne pirmą pristatymą. Sąrašas sudėliotas atvirkštine pristatymo tvarka.">
      {busy ? <ActivityIndicator color={colors.primary} size="large" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {progress ? (
        <View style={styles.summary} testID="loading-progress">
          <View style={styles.summaryHeaderRow}>
            <Text style={styles.summaryTitle}>Pakrauta {progress.loadedStops} / {progress.totalStops}</Text>
            <View style={styles.percentPill}>
              <Text style={styles.percentPillText}>{progress.loadingPercent}%</Text>
            </View>
          </View>
          <Text style={styles.summaryText}>Žinomas pakrautas svoris: {formatWeightKg(progress.loadedKnownWeightKg)} / {formatWeightKg(progress.totalKnownWeightKg)} kg</Text>
          {vehicleLoad ? <Text style={[styles.summaryText, vehicleLoad.overCapacity && styles.loadWarning]} testID="vehicle-load-percent">{vehicleLoad.summaryLabel}</Text> : null}
          {progress.notLoadedStops > 0 ? <Text style={styles.notLoadedSummary}>Nepakrauta: {progress.notLoadedStops}</Text> : null}
          {progress.totalUnknownWeightStops > 0 ? <Text style={styles.summaryText}>{progress.loadedUnknownWeightStops} / {progress.totalUnknownWeightStops} pakrautų taškų svoris nežinomas</Text> : null}
          {readiness ? (
          <DepartureGateCard
            readiness={readiness}
            canApprove={canApproveExpiredDeparture(profile)}
            busy={gateBusy}
            onApprove={() => { void approveOverride(); }}
            onRequestApproval={() => { void requestOverride(); }}
          />
        ) : null}
          <View style={styles.loadingOrderNotice} testID="loading-order-notice">
            <TruckIcon size={18} color={colors.info} />
            <Text style={styles.loadingOrderText}>KROVIMO EILĖ: 1 = PIRMAS Į AUTOMOBILĮ. PRISTATYMO NUMERIS GALI BŪTI KITAS.</Text>
          </View>
        </View>
      ) : null}
      {progress && progress.totalStops > 0 ? (
        route?.status === 'loaded' ? (
          <View style={styles.allLoadedState} testID="all-stops-loaded-state">
            <CheckIcon size={20} color={colors.success} />
            <Text style={styles.allLoadedText}>{progress.notLoadedStops > 0 ? `Pakrovimas paruoštas · nepakrauta ${progress.notLoadedStops}` : 'Visi kroviniai pakrauti'}</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={bulkBusy}
            testID="mark-all-stops-loaded"
            style={[styles.markAllButton, bulkBusy && styles.disabled]}
            onPress={markAllLoaded}>
            {bulkBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.markAllText}>Pažymėti visus kaip pakrautus</Text>}
          </Pressable>
        )
      ) : null}
      {route?.status === 'loaded' ? (
        <Pressable
          disabled={Boolean(readiness && !readiness.canDepart)}
          style={[styles.primaryButton, Boolean(readiness && !readiness.canDepart) && styles.disabled]}
          onPress={() => {
            if (readiness && !readiness.canDepart) {
              Alert.alert('Važiuoti negalima', readiness.blockers[0]?.message ?? 'Pasibaigęs automobilio terminas. Važiuoti negalima.');
              return;
            }
            setOdometerModalVisible(true);
          }}
          testID="open-start-odometer">
          <Text style={styles.primaryText}>{route.startOdometer === null ? 'Įvesti odometrą ir pradėti' : 'Pradėti maršrutą'}</Text>
        </Pressable>
      ) : null}
      {stops.length > 1 && (profile.role !== 'driver' || profile.permissions?.canReorderAssignedRoute) ? (
        <Pressable style={styles.reverseButton} onPress={reverseDirection}>
          <Text style={styles.reverseText}>⇄ Apsukti pristatymo kryptį</Text>
        </Pressable>
      ) : null}
      {route?.status === 'loading' && (profile.role !== 'driver' || profile.permissions?.canReorderAssignedRoute) ? (
        <Pressable style={styles.reverseButton} onPress={pickDifferentAlternative}>
          <Text style={styles.reverseText}>← Pasirinkti kitą maršruto variantą</Text>
        </Pressable>
      ) : null}
      {undo ? (
        <Pressable style={styles.undoButton} onPress={undoLast} testID="undo-loading-action">
          <Text style={styles.undoText}>
            {undo.actionType === 'all_stops_loaded' ? 'Atšaukti visų pakrovimą' : 'Atšaukti paskutinį pakrovimą'}
          </Text>
        </Pressable>
      ) : null}
      {stops.map((stop, index) => {
        const deliveryOrder = stop.activeOrder ?? stop.optimizedOrder ?? stop.originalOrder;
        const expanded = expandedStopId === stop.id;
        const markedNotLoaded = stop.loadingStatus === 'pending' && stop.deliveryStatus === 'failed';
        const statusTone = stop.loadingStatus === 'loaded'
          ? 'loaded'
          : markedNotLoaded
            ? 'notLoaded'
            : 'pending';
        return (
          <SwipeActionCard
            key={stop.id}
            onSwipeRight={stop.loadingStatus === 'loaded' ? undefined : () => markLoaded(stop.id)}
            onSwipeLeft={stop.loadingStatus === 'loaded' ? () => markUnloaded(stop.id) : markedNotLoaded ? undefined : () => beginNotLoaded(stop.id)}
            style={[
              styles.card,
              statusTone === 'loaded' && styles.loadedCard,
              statusTone === 'notLoaded' && styles.notLoadedCard,
              statusTone === 'pending' && styles.pendingCard,
            ]}>
            <View
              style={[
                styles.statusRail,
                statusTone === 'loaded' && styles.statusRailLoaded,
                statusTone === 'notLoaded' && styles.statusRailNotLoaded,
                statusTone === 'pending' && styles.statusRailPending,
              ]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpandedStopId(expanded ? null : stop.id)}
              style={styles.cardHeader}>
              <View style={[
                styles.orderBadge,
                statusTone === 'loaded' && styles.orderBadgeLoaded,
                statusTone === 'notLoaded' && styles.orderBadgeNotLoaded,
              ]}>
                <Text style={[
                  styles.orderBadgeText,
                  statusTone === 'loaded' && styles.orderBadgeTextLoaded,
                  statusTone === 'notLoaded' && styles.orderBadgeTextNotLoaded,
                ]}>
                  {statusTone === 'loaded' ? '✓' : index + 1}
                </Text>
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={styles.address}>{stop.normalizedAddress ?? stop.originalAddress}{stop.priorityFirst ? ' ⭐' : ''}</Text>
                <Text style={styles.loadingSequenceLabel}>KROVIMO EILĖ {index + 1} · PRISTATYMO TAŠKAS {deliveryOrder}</Text>
                <Text style={styles.statusCaption}>
                  {statusTone === 'loaded' ? 'Pakrauta' : statusTone === 'notLoaded' ? 'Nepakrauta' : 'Laukia pakrovimo'}
                </Text>
              </View>
              <View style={styles.weightChip}>
                <Text style={styles.weight}>{stop.weightKg === null ? '?' : formatWeightKg(stop.weightKg)}</Text>
                <Text style={styles.weightUnit}>{stop.weightKg === null ? 'kg' : 'kg'}</Text>
              </View>
              <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded ? (
              <>
                <Text style={styles.eta}>{etaLabel(stop)}</Text>
                <Text style={styles.meta}>{legLabel(stop)}</Text>
                {windowLabel(stop, route?.planningMode ?? null) ? <Text style={route?.planningMode === 'ignore_time_windows' ? styles.informational : styles.meta}>{windowLabel(stop, route?.planningMode ?? null)}</Text> : null}
                {userVisibleStopNote(stop.notes) ? <Text style={styles.notes}>Pastabos: {userVisibleStopNote(stop.notes)}</Text> : null}
                {markedNotLoaded ? <Text style={styles.notLoadedReason}>Nepakrauta: {stop.failureReason}</Text> : null}
                <Text style={styles.meta}>Kliento telefonas {stop.phone ? stop.phone : 'nesuvestas — skambinti iš maršruto galėsite, kai įrašysite'}</Text>
                <TextInput
                  keyboardType="phone-pad"
                  onChangeText={(value) => setPhoneDrafts((current) => ({ ...current, [stop.id]: value }))}
                  placeholder="+370..."
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  testID={`stop-phone-${stop.id}`}
                  value={phoneDrafts[stop.id] ?? stop.phone ?? ''}
                />
                <Pressable onPress={() => { void saveStopPhone(stop); }} style={styles.reverseButton} testID={`save-stop-phone-${stop.id}`}>
                  <Text style={styles.reverseText}>Išsaugoti telefoną</Text>
                </Pressable>
                <View style={styles.loadingActions}>
                  <Pressable style={[styles.loadButton, stop.loadingStatus === 'loaded' && styles.loadedButton]} onPress={() => stop.loadingStatus === 'loaded' ? markUnloaded(stop.id) : markLoaded(stop.id)}>
                    <Text style={styles.loadButtonText}>{stop.loadingStatus === 'loaded' ? 'Atžymėti' : markedNotLoaded ? 'Pakrauti vis tiek' : 'Pakrauta'}</Text>
                  </Pressable>
                  {stop.loadingStatus === 'pending' ? (
                    <Pressable style={styles.notLoadedButton} onPress={() => beginNotLoaded(stop.id)}>
                      <Text style={styles.notLoadedButtonText}>{markedNotLoaded ? 'Keisti priežastį' : 'Nepakrauta'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}
          </SwipeActionCard>
        );
      })}
      <Modal animationType="fade" transparent visible={odometerModalVisible && route?.status === 'loaded'} onRequestClose={() => setOdometerModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop} testID="start-odometer-modal">
          <View style={styles.odometerDialog}>
            <Text style={styles.dialogTitle}>Pradinis odometras</Text>
            <Text style={styles.dialogText}>
              Prieš startą įveskite odometro rodmenį. Be jo maršruto pradėti negalima.
            </Text>
            <TextInput value={odometer} onChangeText={setOdometer} keyboardType="decimal-pad" placeholder="Pvz. 125430,5" style={styles.input} autoFocus />
            <Pressable
              disabled={!odometer.trim() && route?.startOdometer === null}
              style={[styles.primaryButton, (!odometer.trim() && route?.startOdometer === null) && styles.disabled]}
              onPress={() => { void beginRouteWithOdometer(); }}
              testID="confirm-start-route">
              <Text style={styles.primaryText}>Pradėti maršrutą</Text>
            </Pressable>
            <Pressable style={styles.modalCloseButton} onPress={() => setOdometerModalVisible(false)}><Text style={styles.modalCloseText}>Uždaryti</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="fade" transparent visible={notLoadedStopId !== null} onRequestClose={() => setNotLoadedStopId(null)}>
        <View style={styles.modalBackdrop} testID="loading-failure-modal">
          <View style={styles.failureDialog}>
            <Text style={styles.dialogTitle}>Kodėl krovinys nepakrautas?</Text>
            <Text style={styles.dialogText}>Pasirinkimas išsaugomas prie šio taško ir bus matomas istorijoje.</Text>
            {LOADING_FAILURE_REASONS.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => setNotLoadedReason(reason)}
                style={[styles.reasonButton, notLoadedReason === reason && styles.reasonButtonActive]}>
                <Text style={[styles.reasonText, notLoadedReason === reason && styles.reasonTextActive]}>{reason}</Text>
              </Pressable>
            ))}
            <View style={styles.dialogActions}>
              <Pressable disabled={bulkBusy} onPress={() => void saveNotLoaded()} style={[styles.dialogSave, bulkBusy && styles.disabled]}>
                <Text style={styles.loadButtonText}>Išsaugoti</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={() => setNotLoadedStopId(null)} style={styles.dialogCancel}>
                <Text style={styles.secondaryText}>Atšaukti</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  plannedSummary: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  summary: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  summaryTitle: { ...type.sectionTitle, color: colors.text, flexShrink: 1 },
  percentPill: {
    minWidth: 52,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
  },
  percentPillText: { ...type.secondaryStrong, color: colors.info },
  summaryText: { ...type.body, color: colors.textMuted },
  loadingOrderNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: colors.info,
  },
  loadingOrderText: { ...type.label, flex: 1, color: colors.info, lineHeight: 17 },
  loadWarning: { color: colors.warning },
  departureBadge: {
    marginTop: spacing.xs,
    ...type.secondaryStrong,
    color: colors.info,
  },
  scheduleHint: { ...type.meta, color: colors.textMuted },
  notLoadedSummary: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  markAllButton: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.actionRoute,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  markAllText: { ...type.button, color: colors.textInverse, fontSize: 16, textAlign: 'center' },
  allLoadedState: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  allLoadedText: { ...type.button, color: colors.success, fontSize: 16, textAlign: 'center' },
  card: {
    padding: 0,
    paddingLeft: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 0,
    overflow: 'hidden',
  },
  pendingCard: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  loadedCard: { borderColor: colors.success, backgroundColor: colors.accentSoft },
  notLoadedCard: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  statusRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  statusRailPending: { backgroundColor: colors.info },
  statusRailLoaded: { backgroundColor: colors.success },
  statusRailNotLoaded: { backgroundColor: colors.danger },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  cardHeaderText: { flex: 1, minWidth: 0, gap: 2 },
  orderBadge: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeLoaded: { backgroundColor: colors.success, borderColor: colors.success },
  orderBadgeNotLoaded: { backgroundColor: colors.danger, borderColor: colors.danger },
  orderBadgeText: { color: colors.info, fontSize: 13, fontFamily: fonts.heading },
  orderBadgeTextLoaded: { color: colors.textInverse },
  orderBadgeTextNotLoaded: { color: colors.textInverse },
  chevron: { color: colors.textMuted, fontSize: 16, fontFamily: fonts.heading },
  address: { color: colors.text, fontSize: 15, fontFamily: fonts.heading },
  statusCaption: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.headingSemiBold },
  loadingSequenceLabel: { color: colors.info, fontSize: 11, fontFamily: fonts.headingExtraBold, letterSpacing: 0.2 },
  weightChip: {
    minWidth: 54,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  weight: { color: colors.text, fontSize: 14, fontFamily: fonts.heading },
  weightUnit: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.headingSemiBold },
  eta: { color: colors.info, fontSize: 15, fontFamily: fonts.heading },
  meta: { color: colors.textMuted, lineHeight: 19 },
  informational: { color: colors.textMuted, opacity: 0.7, lineHeight: 19 },
  notes: { color: colors.text, lineHeight: 19 },
  loadingActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  loadButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  loadedButton: { opacity: 0.65 },
  loadButtonText: { ...type.button, color: colors.textInverse },
  notLoadedButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  notLoadedButtonText: { color: colors.danger, fontFamily: fonts.heading, textAlign: 'center' },
  notLoadedReason: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  reverseButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reverseText: { ...type.button, color: colors.textSecondary },
  undoButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoText: { ...type.button, color: colors.warning },
  odometerCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.surface },
  fuelCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.success, backgroundColor: colors.surface },
  fuelRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  fuelInput: { flex: 1, minWidth: 0 },
  fuelButton: { minWidth: 120, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  fuelPending: { ...type.bodyStrong, color: colors.warning },
  input: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, ...type.body },
  secondaryButton: { minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary, fontSize: 16 },
  linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.textMuted, fontFamily: fonts.headingSemiBold },
  primaryButton: { minHeight: 56, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  // Three clearly different weights: filled primary, outlined neutral, outlined
  // danger — so none of them reads as a disabled button.
  plannedActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  plannedPrimaryButton: {
    minWidth: 210,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.actionPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plannedPrimaryText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  plannedSecondaryButton: { flexDirection: 'row', gap: spacing.sm, minWidth: 180, minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  plannedSecondaryText: { ...type.button, color: colors.textSecondary, fontSize: 15 },
  plannedCancelButton: { flexDirection: 'row', gap: spacing.sm, minWidth: 160, minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  plannedCancelText: { color: colors.danger, fontFamily: fonts.heading, fontSize: 14 },
  cancelRouteButton: { minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  cancelRouteText: { color: colors.danger, fontFamily: fonts.heading, fontSize: 16 },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontFamily: fonts.headingSemiBold },
  modalBackdrop: { flex: 1, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
  failureDialog: { width: '100%', maxWidth: 430, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  odometerDialog: { width: '100%', maxWidth: 430, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm },
  modalCloseButton: { minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: colors.textMuted, fontFamily: fonts.headingSemiBold },
  dialogTitle: { ...type.sectionTitle, fontSize: 21, lineHeight: 26, color: colors.text },
  dialogText: { ...type.body, color: colors.textMuted, marginBottom: spacing.xs },
  reasonButton: { minHeight: 50, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, justifyContent: 'center' },
  reasonButtonActive: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  reasonText: { color: colors.text, fontFamily: fonts.headingSemiBold },
  reasonTextActive: { color: colors.accent },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  dialogSave: { flex: 1, minHeight: 50, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  dialogCancel: { flex: 1, minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
