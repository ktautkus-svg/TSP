import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { buildOptimizationRequestFromRoute } from '@/application/routes/route-request-builder';
import { resolveRoute, type ResolvedRouteDestination } from '@/application/routes/route-navigation';
import { CancelDraftRoute, SaveSelectedRouteCandidate } from '@/application/routes/route-commands';
import { extractOrderedLocationsFromCandidate } from '@/application/routing/route-polyline-service';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { evaluateCandidate } from '@/domain/routing/evaluation/candidate-evaluator';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteMapView } from '@/components/route-map';
import { ManualRouteOrderList } from '@/components/manual-route-order-list';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { OptimizationStop, RouteCandidate, RouteOptimizationRequest, RouteOptimizationResult, RoutePolylineResult } from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { GatewayPolylineProvider } from '@/infrastructure/routing/providers/gateway-polyline-provider';
import { FallbackTravelCostProvider } from '@/infrastructure/routing/providers/fallback-travel-cost-provider';
import { GoogleTravelCostProvider, HereTravelCostProvider } from '@/infrastructure/routing/providers/gateway-travel-cost-provider';
import { SyntheticTravelCostProvider } from '@/infrastructure/routing/providers/synthetic-travel-cost-provider';
import { clockLabel, durationLabel } from '@/ui/route-eta-labels';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';

export default function RouteAlternativesScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [request, setRequest] = useState<RouteOptimizationRequest | null>(null);
  const [result, setResult] = useState<RouteOptimizationResult | null>(null);
  const [polylineResult, setPolylineResult] = useState<RoutePolylineResult | null>(null);
  const [polylineError, setPolylineError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [cancelling, setCancelling] = useState(false);
  const savingRef = useRef(false);
  const startedForRoute = useRef<string | null>(null);

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
      const nextRequest = buildOptimizationRequestFromRoute(persisted.route, persisted.stops);
      setRequest(nextRequest);
      const provider = createTravelProvider();
      const next = await new RoutingEngine(provider).optimize(nextRequest);
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, nextRequest, next);
      setResult(next);
      const defaultCand = next.recommended ?? next.diagnosticCandidate ?? next.candidates[0] ?? null;
      setSelectedId(defaultCand?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nepavyko apskaičiuoti maršruto.');
    }
  }, [db, repository, routeId, router]);

  useEffect(() => {
    void calculate();
  }, [calculate]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void repository.getById(routeId).then((current) => {
      if (!active || !current || current.status === 'draft') return;
      const destination = resolveRoute(current);
      setRecoveryDestination(destination);
      router.replace({
        pathname: destination.pathname,
        params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
      } as Href);
    }).catch((reason) => {
      if (__DEV__) console.warn('ALTERNATIVES_FOCUS_GUARD_FAILED', reason);
      if (active) setError(reason instanceof Error ? reason.message : 'Maršruto būsenos patikrinti nepavyko.');
    });
    return () => { active = false; };
  }, [repository, routeId, router]));

  const defaultCandidate = result?.recommended ?? result?.diagnosticCandidate ?? result?.candidates[0];
  const candidates = result
    ? (result.recommended ? [result.recommended, ...result.alternatives] : result.diagnosticCandidate ? [result.diagnosticCandidate, ...result.alternatives] : result.candidates.slice(0, 3))
    : [];
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedId) ?? defaultCandidate;

  useEffect(() => {
    let active = true;
    setPolylineResult(null);
    setPolylineError(null);
    if (!selectedCandidate || !request) return () => undefined;
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
  }, [request, selectedCandidate]);

  const saveSelectedRoute = async () => {
    if (!result || !selectedId || savingRef.current) return;
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
      router.replace({ pathname: '/route/[id]/loading', params: { id: routeId } });
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
      }
      return next;
    });
  };

  const moveManualStop = (stopId: string, targetIndex: number) => {
    setManualOrder((current) => {
      const index = current.indexOf(stopId);
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      next.splice(index, 1);
      next.splice(targetIndex, 0, stopId);
      return next;
    });
    setManualError(null);
    // Any reorder must recalculate immediately — moving one stop can invalidate
    // the rest of the sequence's travel times.
    setTimeout(() => recalculateManualSequenceRef.current?.(), 0);
  };

  const toggleManualPriority = (stopId: string) => {
    setManualPriorityIds((current) => current.includes(stopId)
      ? current.filter((id) => id !== stopId)
      : [...current, stopId]);
    setManualCandidate(null);
  };

  const recalculateWithPriorities = async () => {
    if (!request || manualPriorityIds.length === 0 || priorityCalculating) return;
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
      const next = await new RoutingEngine(createTravelProvider()).optimize(prioritizedRequest);
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, prioritizedRequest, next);
      setRequest(prioritizedRequest);
      setResult(next);
      const candidate = next.recommended ?? next.diagnosticCandidate ?? next.candidates[0] ?? null;
      setSelectedId(candidate?.id ?? null);
      setManualOrder(candidate?.stopSequence ?? manualOrder);
      setManualCandidate(null);
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : 'Pagal prioritetus perskaičiuoti nepavyko.');
    } finally {
      setPriorityCalculating(false);
    }
  };

  const recalculateManualSequenceRef = useRef<(() => void) | null>(null);

  const recalculateManualSequence = () => {
    if (!request || !result || manualOrder.length === 0) return;
    const candidate = evaluateCandidate({
      stopSequence: manualOrder,
      generatedBy: ['manual_reorder'],
      request,
      matrix: result.matrix,
    });
    setManualCandidate(candidate);
    const hardViolations = candidate.violations.filter((violation) => violation.type === 'hard');
    setManualError(
      hardViolations.length > 0
        ? `Šioje sekoje yra ${hardViolations.length} pažeidimų (pvz. privalomas laiko langas ar keliamoji galia) — vis tiek galite ją naudoti, bet patikrinkite.`
        : null,
    );
  };
  recalculateManualSequenceRef.current = recalculateManualSequence;

  const useManualSequence = async () => {
    if (!request || !result || !manualCandidate || manualSaving) return;
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
      const manualResult: RouteOptimizationResult = {
        requestId: `${routeId}-manual-${Date.now()}`,
        provider: manualCandidate.provider,
        executionMode: result.executionMode,
        generatedAt: new Date().toISOString(),
        matrixFetchedAt: result.matrixFetchedAt,
        matrix: result.matrix,
        feasibleRouteFound: manualCandidate.feasible,
        recommended: manualCandidate,
        alternatives: [],
        diagnosticCandidate: null,
        candidates: [manualCandidate],
        conflictingConstraints: [],
        suggestions: [],
        warnings: manualCandidate.warnings,
      };
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, request, manualResult);
      await new SaveSelectedRouteCandidate(db).execute(routeId, manualResult.requestId, manualCandidate.id);
      router.replace({ pathname: '/route/[id]/loading', params: { id: routeId } });
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
            void new CancelDraftRoute(db).execute(routeId)
              .then(() => router.replace('/import' as Href))
              .catch((reason) => setError(reason instanceof Error ? reason.message : 'Maršruto atšaukti nepavyko.'))
              .finally(() => setCancelling(false));
          },
        },
      ],
    );
  };

  const orderedLocations = selectedCandidate && request
    ? extractOrderedLocationsFromCandidate(selectedCandidate, request)
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
            onPress={() => router.replace({ pathname: '/route/[id]/review', params: { id: routeId } })}>
            <Text style={styles.primaryText}>Grįžti į adresų patikrą</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }]}
            onPress={() => router.replace('/' as Href)}>
            <Text style={[styles.primaryText, { color: colors.primary }]}>Atverti pradžios ekraną</Text>
          </Pressable>
        </View>
      ) : null}
      {candidates.length > 0 ? (
        <View style={styles.topActions}>
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
      {orderedLocations ? (
        <RouteMapView
          {...orderedLocations}
          encodedPolyline={polylineResult?.encodedPolyline}
          totalDistanceKm={selectedCandidate?.totalDistanceKm}
          totalDurationMinutes={selectedCandidate?.totalWorkMinutes}
          allowStraightLineFallback={false}
          polylineError={polylineError}
        />
      ) : null}
      {request ? (
        <View style={styles.list}>
          {candidates.map((candidate, index) => (
            <CandidateCard
              styles={styles}
              key={candidate.id}
              candidate={candidate}
              request={request}
              rank={index + 1}
              recommended={index === 0}
              selected={candidate.id === selectedId}
              onSelect={() => setSelectedId(candidate.id)}
              expanded={candidate.id === expandedCandidateId}
              onToggleDetails={() => setExpandedCandidateId((current) => current === candidate.id ? null : candidate.id)}
              onManualEdit={() => {
                setSelectedId(candidate.id);
                setManualOrder(candidate.stopSequence);
                setManualPriorityIds([]);
                setManualCandidate(null);
                setManualError(null);
                setManualMode(true);
              }}
            />
          ))}
        </View>
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
            Žvaigždute pažymėkite vieną ar kelis prioritetinius taškus. Eiliškumą keiskite ▲▼ mygtukais arba tempdami ☰ rankenėlę.
          </Text>
          <ManualRouteOrderList
            items={manualOrder.map((stopId) => request.stops.find((item) => item.id === stopId)).filter((stop): stop is OptimizationStop => Boolean(stop)).map((stop) => ({ id: stop.id, label: stop.location.label, weightKg: typeof stop.weightKg === 'number' ? stop.weightKg : null }))}
            priorityIds={new Set(manualPriorityIds)}
            onTogglePriority={toggleManualPriority}
            onMove={moveManualStop}
          />
          <Pressable
            disabled={manualPriorityIds.length === 0 || priorityCalculating}
            style={[styles.secondaryButton, (manualPriorityIds.length === 0 || priorityCalculating) && styles.disabled]}
            onPress={() => { void recalculateWithPriorities(); }}
            testID="recalculate-priority-stops">
            {priorityCalculating ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>Perskaičiuoti pagal prioritetus</Text>}
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={recalculateManualSequence} testID="recalculate-manual-sequence">
            <Text style={styles.primaryText}>Perskaičiuoti pasirinktą eiliškumą</Text>
          </Pressable>
          {manualError ? <Text style={styles.error}>{manualError}</Text> : null}
          {manualCandidate ? (
            <View style={styles.manualResultCard} testID="manual-sequence-result">
              <Text style={styles.metrics}>
                {durationLabel(manualCandidate.totalWorkMinutes)} · {manualCandidate.totalDistanceKm.toFixed(1)} km
              </Text>
              <Pressable
                disabled={manualSaving}
                style={[styles.selectButton, manualSaving && styles.disabled]}
                onPress={() => { void useManualSequence(); }}>
                {manualSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Naudoti šią seką</Text>}
              </Pressable>
            </View>
          ) : null}
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
              • {violation.code === 'REQUIRED_TIME_WINDOW' ? 'Laiko lango viršijimas' : violation.code}{violation.stopId ? `: ${stopLabel(violation.stopId)}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {softWarnings.length > 0 ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>ℹ️ Laiko langų rekomendacija</Text>
          <Text style={styles.description}>
            Pasirinktame variante kai kurie taškai gali nespėti į savo laiko langą. Tai tik rekomendacija — galite pasirinkti šį variantą, jei laikas nekritinis:
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

function CandidateCard(props: {
  styles: ReturnType<typeof createStyles>;
  candidate: RouteCandidate;
  request: RouteOptimizationRequest;
  rank: number;
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
  const comment = props.candidate.explanations[0]?.text
    ?? (props.recommended
      ? 'Geriausias balansas pagal laiką, km ir eiliškumą.'
      : props.candidate.generatedBy.some((tag) => tag.includes('mirror'))
        ? 'Veidrodinė seka — priešinga geografine kryptimi.'
        : 'Alternatyvus eiliškumas su kitokia kryptimi ar laiko balansu.');

  return (
    <View style={[styles.card, props.recommended && styles.recommended, props.selected && styles.selected]}>
      <Pressable onPress={props.onSelect} style={styles.candidateSummary}>
        <View style={styles.candidateTitleRow}>
          <Text style={styles.title}>
            {props.rank}. {props.recommended ? 'Rekomenduojamas' : 'Alternatyva'}
          </Text>
          <Text style={styles.selectionLabel}>{props.selected ? '✓ Pasirinkta' : 'Pasirinkti'}</Text>
        </View>
        <Text style={styles.metrics}>
          {durationLabel(props.candidate.totalWorkMinutes)} · {props.candidate.totalDistanceKm.toFixed(1)} km
        </Text>
        <Text style={styles.comment}>{comment}</Text>
        {firstDelivery ? (
          <Text style={styles.scheduleLine} testID={`candidate-schedule-${props.candidate.id}`}>
            {departure ? `Išvykimas ${departure} · ` : ''}1-as pristatymas {firstDelivery}
            {lastDelivery ? ` · paskutinis ${lastDelivery}` : ''}
          </Text>
        ) : null}
        {waitingMinutes > 0 ? (
          <Text style={styles.scheduleHint}>
            Laukiama {durationLabel(waitingMinutes)}, kol atsidarys pristatymo langai.
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
  list: { gap: spacing.md },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  card: { padding: spacing.sm, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 6 },
  recommended: { borderWidth: 2, borderColor: colors.primary },
  selected: { backgroundColor: colors.primarySoft },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  description: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  candidateSummary: { gap: 4 },
  candidateTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  selectionLabel: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  metrics: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  comment: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  scheduleLine: { color: colors.text, fontSize: 12, fontWeight: '700' },
  scheduleHint: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  sequenceList: { marginTop: spacing.sm, gap: 2 },
  sequenceRow: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  detailsButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  selectButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginTop: spacing.md },
  primaryButton: { minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  primaryText: { color: '#fff', fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  restartButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  restartText: { color: colors.danger, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
  errorCard: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.danger },
  warningCard: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.warning ?? '#f59e0b', backgroundColor: colors.surface },
  warningTitle: { color: colors.warning ?? '#f59e0b', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  manualCard: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  manualRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  manualRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  manualRowLabelTouch: { flex: 1, minHeight: 44, justifyContent: 'center' },
  manualRowLabel: { color: colors.text, fontWeight: '700' },
  manualRowButtons: { flexDirection: 'row', gap: spacing.xs },
  miniButton: { minWidth: 44, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  manualRowDetail: { gap: 2, paddingBottom: spacing.xs },
  manualResultCard: { gap: spacing.sm, marginTop: spacing.sm },
});

function createTravelProvider() {
  return new FallbackTravelCostProvider([
    new GoogleTravelCostProvider(),
    new HereTravelCostProvider(),
    new SyntheticTravelCostProvider('linear'),
  ]);
}
