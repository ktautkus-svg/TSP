import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { pushRouteAssignmentProgress, pushRouteAssignmentRevision } from '@/application/auth/route-assignment-sync';
import { roleHomePath } from '@/application/navigation/role-home';
import { CancelDraftRoute, PruneUncommittedDraftRoutes, SaveSelectedRouteCandidate } from '@/application/routes/route-commands';
import { resolveRoute, type ResolvedRouteDestination } from '@/application/routes/route-navigation';
import { hydrateStopParkPins } from '@/application/location/remember-park-pin';
import { buildOptimizationRequestFromRoute } from '@/application/routes/route-request-builder';
import {
    buildRouteAlternatives,
    type LabeledRouteAlternative,
} from '@/application/routing/route-alternative-modes';
import { extractOrderedLocationsFromCandidate } from '@/application/routing/route-polyline-service';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { FoundationScreen } from '@/components/foundation-screen';
import { ManualRouteOrderList } from '@/components/manual-route-order-list';
import { RouteMapView } from '@/components/route-map';
import { ExcelImportRepository } from '@/database/repositories/excel-import-repository';
import { RouteRepository } from '@/database/repositories/route-repository';
import { evaluateCandidate } from '@/domain/routing/evaluation/candidate-evaluator';
import type { OptimizationStop, RouteCandidate, RouteOptimizationRequest, RouteOptimizationResult, RoutePolylineResult, TravelCostProvider, TravelMatrix } from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { createPlanningTravelProvider } from '@/application/routing/planning-travel-provider';
import { GatewayPolylineProvider } from '@/infrastructure/routing/providers/gateway-polyline-provider';
import { Alert } from '@/ui/alert';
import { presentRoutingDataSource } from '@/ui/routing-data-source';
import { devWarn } from '@/ui/dev-log';
import { clockLabel, durationLabel } from '@/ui/route-eta-labels';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

export default function RouteAlternativesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const db = useSQLiteContext();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const { profile } = useLocalAccess();
  const { id: routeId = '', returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [request, setRequest] = useState<RouteOptimizationRequest | null>(null);
  const [result, setResult] = useState<RouteOptimizationResult | null>(null);
  const [labeledAlternatives, setLabeledAlternatives] = useState<LabeledRouteAlternative[]>([]);
  const [polylineResult, setPolylineResult] = useState<RoutePolylineResult | null>(null);
  const [polylineError, setPolylineError] = useState<string | null>(null);
  const [showPolyline, setShowPolyline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowSynthetic, setAllowSynthetic] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recoveryDestination, setRecoveryDestination] = useState<ResolvedRouteDestination | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [manualPriorityIds, setManualPriorityIds] = useState<string[]>([]);
  const [manualCandidate, setManualCandidate] = useState<RouteCandidate | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [priorityCalculating, setPriorityCalculating] = useState(false);
  const [manualRecalculating, setManualRecalculating] = useState(false);
  const [manualPolyline, setManualPolyline] = useState<RoutePolylineResult | null>(null);
  const [manualPolylineError, setManualPolylineError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const manualPolylineRequestId = useRef(0);
  const savingRef = useRef(false);
  const startedForRoute = useRef<string | null>(null);
  // Cancelling flips the route to 'cancelled', which resolveRoute maps to
  // /history. Without this flag the screen's own status guard races the
  // intended navigation and sometimes dumps the driver into history instead.
  const selfCancelled = useRef(false);
  const stayInPlanning = useRef(false);
  const screenFocused = useRef(false);

  const calculate = useCallback(async () => {
    if (!routeId || startedForRoute.current === routeId) return;
    startedForRoute.current = routeId;
    try {
      const persisted = await repository.getWithStops(routeId);
      if (!persisted) throw new Error('Maršrutas nerastas.');
      if (persisted.route.status !== 'draft') {
        const destination = resolveRoute(persisted.route);
        setRecoveryDestination(destination);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
        return;
      }
      const stops = await hydrateStopParkPins(db, persisted.stops);
      const nextRequest = buildOptimizationRequestFromRoute(persisted.route, stops);
      const provider = createPlanningTravelProvider({ allowSynthetic });
      const four = await buildRouteAlternatives(new RoutingEngine(provider), nextRequest);
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, four.request, four.result);
      setRequest(four.request);
      setResult(four.result);
      setLabeledAlternatives(four.labeled);
      setSelectedId(four.result.recommended?.id ?? four.labeled[0]?.candidate.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nepavyko apskaičiuoti maršruto.');
    }
  }, [allowSynthetic, db, repository, routeId, router]);

  useEffect(() => {
    void calculate();
  }, [calculate]);

  useFocusEffect(useCallback(() => {
    screenFocused.current = true;
    let active = true;
    void repository.getById(routeId).then((current) => {
      if (!active || !current || current.status === 'draft' || selfCancelled.current) return;
      const destination = resolveRoute(current);
      setRecoveryDestination(destination);
      router.replace({
        pathname: destination.pathname,
        params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
      } as Href);
    }).catch((reason) => {
      devWarn('ALTERNATIVES_FOCUS_GUARD_FAILED', reason);
      if (active) setError(reason instanceof Error ? reason.message : 'Maršruto būsenos patikrinti nepavyko.');
    });
    return () => { active = false; screenFocused.current = false; };
  }, [repository, routeId, router]));

  useEffect(() => {
    if (syncRevision === 0 || !screenFocused.current) return;
    void repository.getById(routeId).then((current) => {
      if (!current || current.status === 'draft' || selfCancelled.current) return;
      const destination = resolveRoute(current);
      router.replace({ pathname: destination.pathname, params: destination.params } as Href);
    }).catch((reason) => {
      devWarn('ALTERNATIVES_SYNC_GUARD_FAILED', reason);
    });
  }, [repository, routeId, router, syncRevision]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (stayInPlanning.current || selfCancelled.current) return;
      void new PruneUncommittedDraftRoutes(db).execute()
        .then((pruned) => {
          if (pruned.cancelledRouteIds.length > 0) return requestSync('mutation');
        })
        .catch((reason) => {
          devWarn('UNCOMMITTED_DRAFT_PRUNE_FAILED', reason);
        });
    });
    return unsubscribe;
  }, [db, navigation, requestSync]);

  const defaultCandidate = result?.recommended ?? result?.diagnosticCandidate ?? labeledAlternatives[0]?.candidate ?? result?.candidates[0];
  const candidates = labeledAlternatives.length > 0
    ? labeledAlternatives.map((item) => item.candidate)
    : [];
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedId) ?? defaultCandidate;

  useEffect(() => {
    let active = true;
    setPolylineResult(null);
    setPolylineError(null);
    // Manual sequencing has its own map and polyline. Keep the selected
    // candidate's paid line off the screen so it cannot cover the reorder
    // controls or show the old order while the driver is editing.
    if (!showPolyline || manualMode || !selectedCandidate || !request) return () => undefined;
    const locations = extractOrderedLocationsFromCandidate(selectedCandidate, request);
    new GatewayPolylineProvider()
      .fetchPolyline({ ...locations, departureAt: request.plannedDepartureAt, trafficMode: 'live' })
      .then((polyline) => {
        if (!active) return;
        if (!polyline.encodedPolyline) {
          setPolylineError('Gateway negrąžino maršruto linijos.');
          return;
        }
        setPolylineResult(polyline);
      })
      .catch((reason: unknown) => {
        if (active) setPolylineError(reason instanceof Error ? reason.message : 'Maršruto linijos užklausa nepavyko.');
      });
    return () => { active = false; };
  }, [manualMode, request, selectedCandidate, showPolyline]);

  const saveSelectedRoute = async () => {
    if (!result || !selectedId || !selectedCandidate || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const current = await repository.getById(routeId);
      if (!current) throw new Error('Maršrutas nerastas.');
      if (current.status !== 'draft') {
        const destination = resolveRoute(current);
        setRecoveryDestination(destination);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
        return;
      }
      await new SaveSelectedRouteCandidate(db).execute(routeId, result.requestId, selectedId);
      await verifyPersistedSequence(repository, routeId, selectedCandidate.stopSequence);
      if (current.sourceImportAuditId) {
        await new ExcelImportRepository(db).markRouted(current.sourceImportAuditId, routeId);
      }
      await pushRouteAssignmentRevision(db, routeId, profile.role !== 'driver');
      await requestSync('mutation');
      router.replace({ pathname: '/route/[id]/loading', params: { id: routeId, ...(returnTo ? { returnTo } : {}) } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Maršruto išsaugoti nepavyko.');
      setSaving(false);
      savingRef.current = false;
    }
  };

  const toggleManualMode = () => {
    setManualMode((current) => {
      const next = !current;
      if (next && request) {
        setManualOrder((existing) =>
          existing.length > 0 ? existing : (selectedCandidate?.stopSequence ?? request.stops.map((stop) => stop.id)),
        );
        // Priority stops marked earlier in review.tsx (preferEarly, set by
        // buildOptimizationStop for priorityFirst stops) start pre-selected
        // here too, so the two priority mechanisms don't silently diverge.
        setManualPriorityIds((existing) =>
          existing.length > 0 ? existing : request.stops.filter((stop) => stop.preferEarly).map((stop) => stop.id),
        );
        setManualPolyline(null);
        setManualPolylineError(null);
      }
      return next;
    });
  };

  const moveManualStop = (stopId: string, targetIndex: number) => {
    const index = manualOrder.indexOf(stopId);
    if (index < 0 || targetIndex < 0 || targetIndex >= manualOrder.length) return;
    const next = [...manualOrder];
    next.splice(index, 1);
    next.splice(targetIndex, 0, stopId);
    setManualOrder(next);
    setManualError(null);
    // Drop the previous driving line immediately — pins and the straight-line
    // fallback follow the new order. A fresh polyline is fetched only when the
    // driver presses „Perskaičiuoti pasirinktą eiliškumą“.
    manualPolylineRequestId.current += 1;
    setManualPolyline(null);
    setManualPolylineError(null);
    setTimeout(() => evaluateManualSequenceRef.current?.(next), 0);
  };

  const toggleManualPriority = (stopId: string) => {
    setManualPriorityIds((current) => current.includes(stopId)
      ? current.filter((id) => id !== stopId)
      : [...current, stopId]);
    setManualCandidate(null);
  };

  const recalculateWithPriorities = async () => {
    if (priorityCalculating) return;
    if (manualPriorityIds.length === 0) {
      Alert.alert(
        'Pažymėkite prioritetus',
        'Žvaigždute pažymėkite bent vieną tašką, tada spauskite „Perskaičiuoti pagal prioritetus“.',
      );
      return;
    }
    if (!request || !result) {
      setManualError('Maršruto variantai dar nesuskaičiuoti. Palaukite ir bandykite dar kartą.');
      return;
    }
    setPriorityCalculating(true);
    setManualError(null);
    try {
      const priorities = new Set(manualPriorityIds);
      const prioritizedRequest: RouteOptimizationRequest = {
        ...request,
        stops: request.stops.map((stop) => priorities.has(stop.id)
          ? { ...stop, priority: 10, preferEarly: true }
          : { ...stop, priority: 1, preferEarly: false }),
      };
      // Reuse the matrix already paid for this screen. A second provider
      // purchase used to hang or fail, which made the button look dead.
      const four = await buildRouteAlternatives(
        new RoutingEngine(reuseTravelMatrix(result.matrix)),
        prioritizedRequest,
      );
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, four.request, four.result);
      setRequest(four.request);
      setResult(four.result);
      setLabeledAlternatives(four.labeled);
      const candidate = four.result.recommended ?? four.labeled[0]?.candidate ?? null;
      setSelectedId(candidate?.id ?? null);
      setManualOrder(candidate?.stopSequence ?? manualOrder);
      setManualCandidate(candidate);
      setManualPolyline(null);
      setManualPolylineError(null);
      if (candidate?.stopSequence) {
        void fetchManualDrivingPolyline(candidate.stopSequence);
      }
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : 'Pagal prioritetus perskaičiuoti nepavyko.');
    } finally {
      setPriorityCalculating(false);
    }
  };

  const evaluateManualSequenceRef = useRef<((order?: string[]) => void) | null>(null);

  const evaluateManualSequence = (order = manualOrder) => {
    if (!request || !result || order.length === 0) return;
    try {
      const candidate = evaluateCandidate({
        stopSequence: order,
        generatedBy: ['manual_reorder'],
        request,
        matrix: result.matrix,
      });
      setManualCandidate(candidate);
      const hardViolations = candidate.violations.filter((violation) => violation.type === 'hard');
      setManualError(
        hardViolations.length > 0
          ? `Šioje sekoje yra ${hardViolations.length} pažeidimų (pvz. privalomas pristatymo laikas ar keliamoji galia) — vis tiek galite ją naudoti, bet patikrinkite.`
          : null,
      );
    } catch (reason) {
      setManualCandidate(null);
      setManualError(reason instanceof Error ? reason.message : 'Pasirinktos sekos įvertinti nepavyko.');
    }
  };
  evaluateManualSequenceRef.current = evaluateManualSequence;

  const locationsFromStopIds = (ids: readonly string[]) => {
    if (!request) return null;
    const stopMap = new Map(request.stops.map((stop) => [stop.id, stop.location]));
    const orderedStops = ids
      .map((id) => stopMap.get(id))
      .filter((location): location is NonNullable<typeof location> => Boolean(location));
    if (orderedStops.length === 0) return null;
    return {
      startLocation: request.startLocation,
      orderedStops,
      endLocation: request.endLocation,
    };
  };

  const fetchManualDrivingPolyline = async (ids: readonly string[]) => {
    if (!request) return;
    const locations = locationsFromStopIds(ids);
    if (!locations) return;
    const requestId = ++manualPolylineRequestId.current;
    try {
      const polyline = await new GatewayPolylineProvider().fetchPolyline({
        ...locations,
        departureAt: request.plannedDepartureAt,
        trafficMode: 'live',
      });
      if (requestId !== manualPolylineRequestId.current) return;
      if (!polyline.encodedPolyline) {
        setManualPolyline(null);
        setManualPolylineError('Gateway negrąžino maršruto linijos.');
        return;
      }
      setManualPolyline(polyline);
      setManualPolylineError(null);
    } catch (reason: unknown) {
      if (requestId !== manualPolylineRequestId.current) return;
      setManualPolyline(null);
      setManualPolylineError(reason instanceof Error ? reason.message : 'Maršruto linijos užklausa nepavyko.');
    }
  };

  const recalculateManualSequence = async () => {
    if (manualRecalculating) return;
    if (!request) {
      Alert.alert('Maršrutas dar kraunamas', 'Palaukite, kol taškai bus paruošti, ir bandykite dar kartą.');
      return;
    }
    if (!result) {
      Alert.alert('Matrica dar nesuskaičiuota', 'Palaukite, kol maršruto variantai bus paruošti, ir bandykite dar kartą.');
      return;
    }
    if (manualOrder.length === 0) {
      Alert.alert('Nėra taškų', 'Eiliškumo perskaičiuoti negalima, nes nėra pristatymo taškų.');
      return;
    }
    setManualRecalculating(true);
    setManualError(null);
    try {
      evaluateManualSequence();
      await fetchManualDrivingPolyline(manualOrder);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Pasirinktos sekos perskaičiuoti nepavyko.';
      setManualCandidate(null);
      setManualError(message);
      Alert.alert('Nepavyko perskaičiuoti', message);
    } finally {
      setManualRecalculating(false);
    }
  };

  const applyManualSequence = async () => {
    if (!request || !result || manualOrder.length === 0 || manualSaving) return;
    setManualSaving(true);
    setError(null);
    try {
      const current = await repository.getById(routeId);
      if (!current) throw new Error('Maršrutas nerastas.');
      if (current.status !== 'draft') {
        const destination = resolveRoute(current);
        setRecoveryDestination(destination);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
        return;
      }
      const latestManualCandidate = evaluateCandidate({
        stopSequence: manualOrder,
        generatedBy: ['manual_reorder'],
        request,
        matrix: result.matrix,
      });
      const manualResult: RouteOptimizationResult = {
        requestId: `${routeId}-manual-${Date.now()}`,
        provider: latestManualCandidate.provider,
        executionMode: result.executionMode,
        generatedAt: new Date().toISOString(),
        matrixFetchedAt: result.matrixFetchedAt,
        matrix: result.matrix,
        feasibleRouteFound: latestManualCandidate.feasible,
        recommended: latestManualCandidate,
        alternatives: [],
        diagnosticCandidate: null,
        candidates: [latestManualCandidate],
        conflictingConstraints: [],
        suggestions: [],
        warnings: latestManualCandidate.warnings,
      };
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, request, manualResult);
      await new SaveSelectedRouteCandidate(db).execute(routeId, manualResult.requestId, latestManualCandidate.id);
      await verifyPersistedSequence(repository, routeId, manualOrder);
      await pushRouteAssignmentRevision(db, routeId, profile.role !== 'driver');
      await requestSync('mutation');
      router.replace({ pathname: '/route/[id]/loading', params: { id: routeId, ...(returnTo ? { returnTo } : {}) } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rankinės sekos išsaugoti nepavyko.');
    } finally {
      setManualSaving(false);
    }
  };

  const cancelAndChooseAnotherFile = () => {
    if (cancelling) return;
    Alert.alert(
      'Pradėti iš naujo?',
      'Šis neužbaigtas maršrutas bus atšauktas. Ankstesnė istorija ir užbaigti maršrutai liks išsaugoti.',
      [
        { text: 'Ne', style: 'cancel' },
        {
          text: 'Taip, pasirinkti kitą failą',
          style: 'destructive',
          onPress: () => {
            setCancelling(true);
            selfCancelled.current = true;
            void new CancelDraftRoute(db).execute(routeId)
              .then(async () => {
                await pushRouteAssignmentProgress(db, routeId).catch(() => undefined);
                await requestSync('mutation');
                router.replace('/import' as Href);
              })
              .catch((reason) => {
                selfCancelled.current = false;
                setError(reason instanceof Error ? reason.message : 'Maršruto atšaukti nepavyko.');
              })
              .finally(() => setCancelling(false));
          },
        },
      ],
    );
  };

  const orderedLocations = selectedCandidate && request && !manualMode
    ? extractOrderedLocationsFromCandidate(selectedCandidate, request)
    : null;
  const manualMapLocations = manualMode && request
    ? locationsFromStopIds(manualOrder)
    : null;
  const stopLabel = (stopId: string | null): string => {
    if (!stopId || !request) return '';
    return request.stops.find((stop) => stop.id === stopId)?.location.label ?? stopId;
  };
  const softWarnings = selectedCandidate?.violations.filter((violation) => violation.type === 'soft') ?? [];
  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Maršruto variantai"
      description="Variantai apskaičiuoti iš SQLite išsaugotų ir patvirtintų pristatymo taškų.">
      {!result && !error ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.description}>Skaičiuojama matrica ir maršruto variantai…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {recoveryDestination ? (
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.replace({ pathname: recoveryDestination.pathname, params: recoveryDestination.params } as Href)}>
          <Text style={styles.primaryText}>{recoveryDestination.screen === 'history-detail' ? 'Atidaryti istoriją' : 'Grįžti į vykdomą maršrutą'}</Text>
        </Pressable>
      ) : error ? (
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              stayInPlanning.current = true;
              router.replace({ pathname: '/route/[id]/review', params: { id: routeId } });
            }}>
            <Text style={styles.primaryText}>Grįžti į adresų patikrą</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }]}
            onPress={() => router.replace(roleHomePath(profile.role) as Href)}>
            <Text style={[styles.primaryText, { color: colors.primary }]}>Atverti pradžios ekraną</Text>
          </Pressable>
          {!allowSynthetic ? (
            <Pressable
              style={[styles.primaryButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warning }]}
              testID="retry-planning-synthetic"
              onPress={() => {
                startedForRoute.current = null;
                setAllowSynthetic(true);
                setError(null);
              }}>
              <Text style={[styles.primaryText, { color: colors.warning }]}>Planuoti su sintetiniais duomenimis</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {candidates.length > 0 ? (
        <View style={styles.topActions}>
          <Pressable
            disabled={saving || cancelling}
            style={[styles.secondaryButton, (saving || cancelling) && styles.disabled]}
            onPress={() => {
              stayInPlanning.current = true;
              router.replace({ pathname: '/route/[id]/review', params: { id: routeId } });
            }}
            testID="change-warehouse-or-stops">
            <Text style={styles.secondaryText}>Keisti sandėlį arba taškus</Text>
          </Pressable>
          <Pressable
            disabled={!selectedId || saving || cancelling}
            style={[styles.primaryButton, (!selectedId || saving || cancelling) && styles.disabled]}
            onPress={saveSelectedRoute}
            testID="save-selected-route-top">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Patvirtinti pasirinktą maršrutą</Text>}
          </Pressable>
          <Pressable
            disabled={saving || cancelling}
            style={[styles.restartButton, (saving || cancelling) && styles.disabled]}
            onPress={cancelAndChooseAnotherFile}
            testID="cancel-route-and-new-file">
            {cancelling ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.restartText}>Atšaukti ir pasirinkti kitą failą</Text>}
          </Pressable>
        </View>
      ) : null}
      {request ? (
        <View style={styles.list}>
          {[...new Set(labeledAlternatives.map((item) => item.group))].map((group) => (
            <View key={group} style={styles.groupBlock}>
              <Text style={styles.groupTitle}>{group.toUpperCase()}</Text>
              <View style={styles.groupRow}>
                {labeledAlternatives.filter((item) => item.group === group).map((item) => (
                  <CandidateCard
                    styles={styles}
                    key={item.candidate.id}
                    candidate={item.candidate}
                    request={request}
                    title={item.title}
                    comment={item.comment}
                    recommended={item.candidate.id === result?.recommended?.id}
                    selected={item.candidate.id === selectedId}
                    onSelect={() => setSelectedId(item.candidate.id)}
                    expanded={item.candidate.id === expandedCandidateId}
                    onToggleDetails={() => setExpandedCandidateId((current) => current === item.candidate.id ? null : item.candidate.id)}
                    onManualEdit={() => {
                      setSelectedId(item.candidate.id);
                      setManualOrder(item.candidate.stopSequence);
                      setManualPriorityIds(request?.stops.filter((stop) => stop.preferEarly).map((stop) => stop.id) ?? []);
                      setManualCandidate(null);
                      setManualError(null);
                      setManualPolyline(null);
                      setManualPolylineError(null);
                      setManualMode(true);
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {/* Below the options, not above them: the driver picks a variant first and
          then looks at it. A 330px map ahead of the list pushed all five choices
          off the bottom of the screen. */}
      {orderedLocations ? (
        <>
          <Pressable
            disabled={showPolyline}
            onPress={() => setShowPolyline(true)}
            style={[styles.secondaryButton, showPolyline && styles.disabled]}
            testID="show-route-polyline">
            <Text style={styles.secondaryText}>{showPolyline ? 'Kelio linija užkrauta' : 'Rodyti tikrą kelio liniją'}</Text>
          </Pressable>
          {showPolyline ? <RouteMapView
            {...orderedLocations}
            encodedPolyline={polylineResult?.encodedPolyline}
            totalDistanceKm={selectedCandidate?.totalDistanceKm}
            totalDurationMinutes={selectedCandidate?.totalWorkMinutes}
            allowStraightLineFallback={false}
            polylineError={polylineError}
          /> : null}
        </>
      ) : null}
      {request ? (
        <Pressable style={styles.secondaryButton} onPress={toggleManualMode} testID="toggle-manual-sequencing">
          <Text style={styles.secondaryText}>{manualMode ? 'Išjungti rankinį maršrutizavimą' : 'Įjungti rankinį maršrutizavimą'}</Text>
        </Pressable>
      ) : null}
      {manualMode && request ? (
        <View style={styles.manualCard} testID="manual-sequencing-panel">
          <Text style={styles.title}>Rankinis planavimas</Text>
          <Text style={styles.description}>
            Žvaigždute pažymėkite prioritetinius taškus. Eiliškumą keiskite ▲▼ mygtukais arba tempdami ☰ rankenėlę.
            Numeriai žemėlapyje atsinaujina iškart. Tikrą kelio liniją piešia „Perskaičiuoti pasirinktą eiliškumą“.
          </Text>
          <ManualRouteOrderList
            items={manualOrder.map((stopId) => request.stops.find((item) => item.id === stopId)).filter((stop): stop is OptimizationStop => Boolean(stop)).map((stop) => ({
              id: stop.id,
              label: stop.location.label,
              address: stop.location.address ?? stop.location.label,
              weightKg: typeof stop.weightKg === 'number' ? stop.weightKg : null,
            }))}
            priorityIds={new Set(manualPriorityIds)}
            onTogglePriority={toggleManualPriority}
            onMove={moveManualStop}
          />
          <View style={styles.manualActions}>
            <Pressable
              accessibilityRole="button"
              disabled={priorityCalculating}
              onPress={() => { void recalculateWithPriorities(); }}
              style={[
                styles.priorityRecalcButton,
                manualPriorityIds.length > 0 && styles.priorityRecalcButtonReady,
                priorityCalculating && styles.disabled,
              ]}
              testID="recalculate-priority-stops">
              {priorityCalculating
                ? <ActivityIndicator color={colors.textInverse} />
                : <Text style={[styles.priorityRecalcText, manualPriorityIds.length > 0 && styles.priorityRecalcTextReady]}>Perskaičiuoti pagal prioritetus</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={manualRecalculating}
              onPress={() => { void recalculateManualSequence(); }}
              style={[styles.primaryButton, manualRecalculating && styles.disabled]}
              testID="recalculate-manual-sequence">
              {manualRecalculating
                ? <ActivityIndicator color={colors.textInverse} />
                : <Text style={styles.primaryText}>Perskaičiuoti pasirinktą eiliškumą</Text>}
            </Pressable>
          </View>
          {manualError ? <Text style={styles.error}>{manualError}</Text> : null}
          {manualCandidate ? (
            <View style={styles.manualResultCard} testID="manual-sequence-result">
              <Text style={styles.metrics}>
                {durationLabel(manualCandidate.totalWorkMinutes)} · {manualCandidate.totalDistanceKm.toFixed(1)} km
              </Text>
              <Pressable
                disabled={manualSaving}
                style={[styles.selectButton, manualSaving && styles.disabled]}
                onPress={() => { void applyManualSequence(); }}>
                {manualSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Naudoti šią seką</Text>}
              </Pressable>
            </View>
          ) : null}
          {manualMapLocations ? (
            <View style={styles.manualMap} testID="manual-order-map">
              <RouteMapView
                {...manualMapLocations}
                encodedPolyline={manualPolyline?.encodedPolyline}
                allowStraightLineFallback
                totalDistanceKm={manualCandidate?.totalDistanceKm}
                totalDurationMinutes={manualCandidate?.totalWorkMinutes}
                polylineError={manualPolylineError}
              />
            </View>
          ) : <Text style={styles.description}>Žemėlapis bus rodomas, kai taškai turės koordinates.</Text>}
        </View>
      ) : null}
      {result && result.executionMode === 'synthetic' ? (
        <View style={styles.errorCard}>
          <Text style={styles.error}>{presentRoutingDataSource({
            provider: result.provider,
            executionMode: result.executionMode,
            trafficMode: result.matrix.trafficMode,
          }).title}</Text>
          <Text style={styles.description}>
            Atstumai apskaičiuoti tiesiomis linijomis — be upių, vienpusių gatvių ir greitkelių.
            Eiliškumas gali būti netikslus. Patikrinkite ryšį ir perskaičiuokite prieš išvažiuodami.
          </Text>
        </View>
      ) : null}
      {result && result.executionMode === 'cache' ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>{presentRoutingDataSource({
            provider: result.provider,
            executionMode: result.executionMode,
            trafficMode: result.matrix.trafficMode,
          }).title}</Text>
          <Text style={styles.description}>
            Naudojami anksčiau gauti realūs kelių duomenys. Jie gali būti senesni už dabartinį eismą.
          </Text>
        </View>
      ) : null}
      {result && !result.feasibleRouteFound && result.conflictingConstraints.length > 0 ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>⚠️ Pastaba dėl ribų</Text>
          <Text style={styles.description}>
            Kai kurie taškai gali viršyti planuotą ribą, tačiau maršrutas sukurta optimaliausiomis sąlygomis:
          </Text>
          {result.conflictingConstraints.map((violation) => (
            <Text key={`${violation.code}-${violation.stopId}`} style={styles.description}>
              • {violation.code === 'REQUIRED_TIME_WINDOW' ? 'Pristatymo laiko viršijimas' : violation.code}{violation.stopId ? `: ${stopLabel(violation.stopId)}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {softWarnings.length > 0 ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>ℹ️ Pristatymo laikų rekomendacija</Text>
          <Text style={styles.description}>
            Pasirinktame variante kai kurie taškai gali nespėti nurodytu pristatymo laiku. Tai tik rekomendacija — galite pasirinkti šį variantą, jei laikas nekritinis:
          </Text>
          {softWarnings.map((violation) => (
            <Text key={`${violation.code}-${violation.stopId}`} style={styles.description}>
              • {stopLabel(violation.stopId)}: vėluojama ~{Math.round(Number(violation.actualValue) || 0)} min
            </Text>
          ))}
        </View>
      ) : null}
    </FoundationScreen>
  );
}

async function verifyPersistedSequence(
  repository: RouteRepository,
  routeId: string,
  expected: readonly string[],
): Promise<void> {
  const actual = (await repository.getStops(routeId)).map((stop) => stop.id);
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error('Pasirinktas eiliškumas nebuvo išsaugotas. Krovimas nepradėtas — patvirtinkite dar kartą.');
  }
}

function CandidateCard(props: {
  styles: ReturnType<typeof createStyles>;
  candidate: RouteCandidate;
  request: RouteOptimizationRequest;
  title: string;
  comment: string;
  recommended: boolean;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleDetails: () => void;
  onManualEdit: () => void;
}) {
  const { styles } = props;
  const stopMap = useMemo(
    () => new Map(props.request.stops.map((stop) => [stop.id, stop])),
    [props.request.stops],
  );
  const orderedStops = props.candidate.stopSequence
    .map((id) => stopMap.get(id))
    .filter((stop): stop is OptimizationStop => Boolean(stop));
  // Handover times, not raw arrivals: waiting for a door that opens at 08:00 is
  // already baked into the schedule, so the first delivery reads honestly.
  const scheduleById = new Map(props.candidate.schedules.map((item) => [item.stopId, item]));
  const departure = clockLabel(props.candidate.legs[0]?.departureAt ?? props.request.plannedDepartureAt);
  const firstDelivery = clockLabel(props.candidate.schedules[0]?.serviceStartAt);
  const lastDelivery = clockLabel(props.candidate.schedules.at(-1)?.departureAt);
  const waitingMinutes = Math.round(props.candidate.waitingMinutes);
  const shiftMinutes = Math.round(props.candidate.departureShiftMinutes);

  return (
    <View style={[styles.card, props.recommended && styles.recommended, props.selected && styles.selected]}>
      <Pressable onPress={props.onSelect} style={styles.candidateSummary} testID={`route-alternative-${props.title}`}>
        <View style={styles.candidateTitleRow}>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={styles.selectionLabel}>{props.selected ? '✓ Pasirinkta' : 'Pasirinkti'}</Text>
        </View>
        <Text style={styles.metrics}>
          {durationLabel(props.candidate.totalWorkMinutes)} · {props.candidate.totalDistanceKm.toFixed(1)} km
        </Text>
        <Text style={styles.comment}>{props.comment}</Text>
        {firstDelivery ? (
          <Text style={styles.scheduleLine} testID={`candidate-schedule-${props.candidate.id}`}>
            {departure ? `Išvykimas ${departure} · ` : ''}1-as pristatymas {firstDelivery}
            {lastDelivery ? ` · paskutinis ${lastDelivery}` : ''}
          </Text>
        ) : null}
        {shiftMinutes > 0 ? (
          <Text style={styles.scheduleHint} testID={`candidate-shift-${props.candidate.id}`}>
            Išvykti {durationLabel(shiftMinutes)} vėliau nei planuota — pirmas taškas
            anksčiau neatsidaro, tad sandėlyje palaukti pigiau nei prie durų.
          </Text>
        ) : null}
        {waitingMinutes > 0 ? (
          <Text style={styles.scheduleHint}>
            Laukiama {durationLabel(waitingMinutes)} iki nurodyto pristatymo laiko.
          </Text>
        ) : null}
      </Pressable>
      <Pressable onPress={props.onToggleDetails} style={styles.detailsButton}>
        <Text style={styles.secondaryText}>{props.expanded ? 'Slėpti eiliškumą' : 'Rodyti eiliškumą'}</Text>
      </Pressable>
      <Pressable onPress={props.onManualEdit} style={styles.detailsButton} testID={`manual-edit-${props.candidate.id}`}>
        <Text style={styles.secondaryText}>Redaguoti rankiniu būdu</Text>
      </Pressable>
      {props.expanded ? (
        <View style={styles.sequenceList} testID={`candidate-sequence-${props.candidate.id}`}>
          {orderedStops.map((stop, index) => {
            const at = clockLabel(scheduleById.get(stop.id)?.serviceStartAt);
            return (
              <Text key={stop.id} style={styles.sequenceRow}>
                {index + 1}. {at ? `${at} · ` : ''}{stop.location.label}
                {stop.weightKg !== null ? ` · ${Math.round(stop.weightKg)} kg` : ''}
              </Text>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  topActions: { gap: spacing.sm },
  list: { gap: spacing.lg },
  groupBlock: { gap: spacing.xs },
  groupTitle: { ...type.label, color: colors.textMuted },
  groupRow: { flexDirection: 'row', gap: spacing.sm },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  card: { flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  recommended: { borderColor: colors.info },
  selected: { borderWidth: 2, borderColor: colors.info, backgroundColor: colors.infoSoft },
  title: { ...type.cardTitle, color: colors.text },
  description: { ...type.secondary, color: colors.textMuted, marginTop: spacing.xs },
  candidateSummary: { gap: 4 },
  candidateTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  selectionLabel: { ...type.meta, color: colors.info },
  metrics: { ...type.sectionTitle, color: colors.info },
  comment: { ...type.meta, color: colors.textMuted },
  scheduleLine: { ...type.meta, color: colors.textSecondary },
  scheduleHint: { ...type.label, color: colors.warning },
  sequenceList: { marginTop: spacing.sm, gap: 2 },
  sequenceRow: { ...type.secondary, color: colors.textMuted },
  detailsButton: { minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  selectButton: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary, marginTop: spacing.md },
  primaryButton: { minHeight: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary },
  restartButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  restartText: { ...type.button, color: colors.danger },
  error: { ...type.secondaryStrong, color: colors.danger },
  errorCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  warningCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft },
  warningTitle: { ...type.sectionTitle, color: colors.warning },
  disabled: { opacity: 0.45 },
  manualCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, gap: spacing.sm },
  manualMap: { overflow: 'hidden', borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, zIndex: 0 },
  manualActions: { gap: spacing.sm, zIndex: 2, position: 'relative', backgroundColor: colors.surface, paddingTop: spacing.sm },
  priorityRecalcButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  priorityRecalcButtonReady: { backgroundColor: colors.infoSoft, borderColor: colors.info },
  priorityRecalcText: { ...type.button, color: colors.text },
  priorityRecalcTextReady: { color: colors.info },
  manualRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  manualRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  manualRowLabelTouch: { flex: 1, minHeight: 44, justifyContent: 'center' },
  manualRowLabel: { ...type.bodyStrong, color: colors.text },
  manualRowButtons: { flexDirection: 'row', gap: spacing.xs },
  miniButton: { minWidth: 44, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.info, alignItems: 'center', justifyContent: 'center' },
  manualRowDetail: { gap: 2, paddingBottom: spacing.xs },
  manualResultCard: { gap: spacing.sm, marginTop: spacing.sm },
});

function reuseTravelMatrix(matrix: TravelMatrix): TravelCostProvider {
  return {
    name: matrix.provider || 'reused-matrix',
    getMatrix: async () => matrix,
  };
}
