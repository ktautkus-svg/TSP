import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { loadRouteEditorSession } from '@/application/routes/load-route-editor-session';
import { moveStopInSequence, sequencesEqual } from '@/application/routes/manual-sequence-order';
import { resolveRoute, type ResolvedRouteDestination } from '@/application/routes/route-navigation';
import { SaveSelectedRouteCandidate } from '@/application/routes/route-commands';
import { extractOrderedLocationsFromCandidate } from '@/application/routing/route-polyline-service';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { ManualRouteOrderList, type ManualOrderItem } from '@/components/manual-route-order-list';
import { RouteMapView } from '@/components/route-map';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { DeliveryStop } from '@/domain/route';
import { evaluateCandidate } from '@/domain/routing/evaluation/candidate-evaluator';
import type {
  RouteCandidate,
  RouteOptimizationRequest,
  RouteOptimizationResult,
  RoutePolylineResult,
  TravelMatrix,
} from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { GatewayPolylineProvider } from '@/infrastructure/routing/providers/gateway-polyline-provider';
import { clockLabel, deliveryWindowValue, durationLabel } from '@/ui/route-eta-labels';
import { layout, radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const POLYLINE_DEBOUNCE_MS = 400;

export default function RouteEditorScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { requestSync } = useRouteCloudSync();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const {
    id: routeId = '',
    runId: runIdParam,
    candidateId: candidateIdParam,
  } = useLocalSearchParams<{ id: string; runId?: string; candidateId?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryDestination, setRecoveryDestination] = useState<ResolvedRouteDestination | null>(null);
  const [phoneView, setPhoneView] = useState<'list' | 'map'>('list');
  const [request, setRequest] = useState<RouteOptimizationRequest | null>(null);
  const [matrix, setMatrix] = useState<TravelMatrix | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [baselineCandidate, setBaselineCandidate] = useState<RouteCandidate | null>(null);
  const [baselineSequence, setBaselineSequence] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [priorityIds, setPriorityIds] = useState<string[]>([]);
  const [stopsById, setStopsById] = useState<Map<string, DeliveryStop>>(new Map());
  const [polylineResult, setPolylineResult] = useState<RoutePolylineResult | null>(null);
  const [polylineError, setPolylineError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const polylineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!routeId) return;
    setLoading(true);
    setError(null);
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
      const session = await loadRouteEditorSession(db, routeId, runIdParam, candidateIdParam);
      setRequest(session.request);
      setMatrix(session.matrix);
      setRunId(session.runId);
      setBaselineCandidate(session.candidate);
      setBaselineSequence(session.baselineSequence);
      setOrder(session.baselineSequence);
      setPriorityIds(session.request.stops.filter((stop) => stop.preferEarly).map((stop) => stop.id));
      setStopsById(new Map(persisted.stops.map((stop) => [stop.id, stop])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nepavyko atidaryti maršruto redaktoriaus.');
    } finally {
      setLoading(false);
    }
  }, [candidateIdParam, db, repository, routeId, router, runIdParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCandidate = useMemo(() => {
    if (!request || !matrix || order.length === 0) return baselineCandidate;
    if (baselineCandidate && sequencesEqual(order, baselineSequence)) return baselineCandidate;
    return evaluateCandidate({
      stopSequence: order,
      generatedBy: ['manual_reorder'],
      request,
      matrix,
    });
  }, [baselineCandidate, baselineSequence, matrix, order, request]);

  useEffect(() => {
    if (!request || !activeCandidate) return;
    if (polylineTimer.current) clearTimeout(polylineTimer.current);
    let active = true;
    polylineTimer.current = setTimeout(() => {
      setPolylineResult(null);
      setPolylineError(null);
      const locations = extractOrderedLocationsFromCandidate(activeCandidate, request);
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
    }, POLYLINE_DEBOUNCE_MS);
    return () => {
      active = false;
      if (polylineTimer.current) clearTimeout(polylineTimer.current);
    };
  }, [activeCandidate, request]);

  const items: ManualOrderItem[] = useMemo(() => {
    if (!request) return [];
    return order.map((stopId) => {
      const opt = request.stops.find((stop) => stop.id === stopId);
      const persisted = stopsById.get(stopId);
      const recipient = persisted?.recipient?.trim() || null;
      const address = persisted?.normalizedAddress
        ?? persisted?.originalAddress
        ?? opt?.location.address
        ?? opt?.location.label
        ?? stopId;
      const timeWindowLabel = (() => {
        const compact = deliveryWindowValue(persisted);
        if (compact && compact !== 'Nenurodytas') return compact;
        return formatOptimizationWindow(opt?.requiredTimeWindow ?? opt?.informationalTimeWindow);
      })();
      return {
        id: stopId,
        label: recipient || address,
        recipient,
        address,
        weightKg: typeof persisted?.weightKg === 'number'
          ? persisted.weightKg
          : typeof opt?.weightKg === 'number'
            ? opt.weightKg
            : null,
        timeWindowLabel,
        priority: priorityIds.includes(stopId),
      };
    });
  }, [order, priorityIds, request, stopsById]);

  const moveStop = (stopId: string, targetIndex: number) => {
    setOrder((current) => moveStopInSequence(current, stopId, targetIndex));
  };

  const togglePriority = (stopId: string) => {
    setPriorityIds((current) =>
      current.includes(stopId) ? current.filter((id) => id !== stopId) : [...current, stopId],
    );
  };

  const confirmSequence = async () => {
    if (!request || !matrix || !runId || !activeCandidate || savingRef.current) return;
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

      let persistRunId = runId;
      let persistCandidateId = activeCandidate.id;

      if (!sequencesEqual(order, baselineSequence)) {
        const manualCandidate = evaluateCandidate({
          stopSequence: order,
          generatedBy: ['manual_reorder'],
          request,
          matrix,
        });
        const manualResult: RouteOptimizationResult = {
          requestId: `${routeId}-manual-${Date.now()}`,
          provider: manualCandidate.provider,
          executionMode: matrix.executionMode,
          generatedAt: new Date().toISOString(),
          matrixFetchedAt: matrix.fetchedAt,
          matrix,
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
        persistRunId = manualResult.requestId;
        persistCandidateId = manualCandidate.id;
      }

      await new SaveSelectedRouteCandidate(db).execute(routeId, persistRunId, persistCandidateId);
      void requestSync('mutation');
      router.replace({ pathname: '/route/[id]/loading', params: { id: routeId } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Maršruto sekos išsaugoti nepavyko.');
      setSaving(false);
      savingRef.current = false;
    }
  };

  const backToAlternatives = () => {
    router.replace({ pathname: '/route/[id]/alternatives', params: { id: routeId } });
  };

  const orderedLocations = activeCandidate && request
    ? extractOrderedLocationsFromCandidate(activeCandidate, request)
    : null;

  const hardViolations = activeCandidate?.violations.filter((violation) => violation.type === 'hard') ?? [];
  const mapPanel = orderedLocations ? (
    <View style={[styles.mapPanel, isWide && styles.mapPanelSticky]} testID="editor-map-panel">
      <RouteMapView
        {...orderedLocations}
        encodedPolyline={polylineResult?.encodedPolyline}
        totalDistanceKm={activeCandidate?.totalDistanceKm}
        totalDurationMinutes={activeCandidate?.totalWorkMinutes}
        allowStraightLineFallback={false}
        polylineError={polylineError}
      />
      {activeCandidate ? (
        <Text style={styles.mapMetrics}>
          {durationLabel(activeCandidate.totalWorkMinutes)} · {activeCandidate.totalDistanceKm.toFixed(1)} km
        </Text>
      ) : null}
    </View>
  ) : null;

  const listPanel = (
    <View style={styles.listPanel} testID="editor-list-panel">
      <Text style={styles.title}>Maršruto redaktorius</Text>
      <Text style={styles.description}>
        Patikrinkite eiliškumą. Tempimas ir ▲▼ keičia seką iškart. Žemėlapis atnaujinamas paleidus tašką.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {hardViolations.length > 0 ? (
        <Text style={styles.warning}>
          Šioje sekoje yra {hardViolations.length} pažeidimų — vis tiek galite ją naudoti, bet patikrinkite.
        </Text>
      ) : null}
      <ManualRouteOrderList
        items={items}
        onTogglePriority={togglePriority}
        onMove={moveStop}
      />
      <Pressable
        disabled={saving || !activeCandidate}
        style={[styles.primaryButton, (saving || !activeCandidate) && styles.disabled]}
        onPress={() => { void confirmSequence(); }}
        testID="confirm-editor-sequence">
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Naudoti šią seką</Text>}
      </Pressable>
      <Pressable
        disabled={saving}
        style={[styles.secondaryButton, saving && styles.disabled]}
        onPress={backToAlternatives}
        testID="back-to-alternatives">
        <Text style={styles.secondaryText}>Grįžti į variantus</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.workspace}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.description}>Kraunama seka…</Text>
          </View>
        ) : null}
        {recoveryDestination ? (
          <Pressable
            style={styles.primaryButton}
            onPress={() => router.replace({ pathname: recoveryDestination.pathname, params: recoveryDestination.params } as Href)}>
            <Text style={styles.primaryText}>
              {recoveryDestination.screen === 'history-detail' ? 'Atidaryti istoriją' : 'Grįžti į vykdomą maršrutą'}
            </Text>
          </Pressable>
        ) : null}
        {!loading && !recoveryDestination ? (
          isWide ? (
            <View style={styles.split}>
              <ScrollView
                style={styles.splitList}
                contentContainerStyle={styles.splitListContent}
                keyboardShouldPersistTaps="handled">
                {listPanel}
              </ScrollView>
              <View style={styles.splitMap}>{mapPanel}</View>
            </View>
          ) : (
            <View style={styles.phone}>
              <View style={styles.viewToggle}>
                <Pressable
                  style={[styles.toggleButton, phoneView === 'list' && styles.toggleButtonActive]}
                  onPress={() => setPhoneView('list')}
                  testID="editor-view-list">
                  <Text style={[styles.toggleText, phoneView === 'list' && styles.toggleTextActive]}>Sąrašas</Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleButton, phoneView === 'map' && styles.toggleButtonActive]}
                  onPress={() => setPhoneView('map')}
                  testID="editor-view-map">
                  <Text style={[styles.toggleText, phoneView === 'map' && styles.toggleTextActive]}>Žemėlapis</Text>
                </Pressable>
              </View>
              {phoneView === 'list' ? (
                <ScrollView contentContainerStyle={styles.phoneContent} keyboardShouldPersistTaps="handled">
                  {listPanel}
                </ScrollView>
              ) : (
                <ScrollView contentContainerStyle={styles.phoneContent}>{mapPanel}</ScrollView>
              )}
            </View>
          )
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function formatOptimizationWindow(window?: { from: string; to: string } | null): string | null {
  if (!window) return null;
  const from = clockLabel(window.from);
  const to = clockLabel(window.to);
  if (from && to && from !== to) return `${from}–${to}`;
  return from ?? to;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  workspace: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxOperationalWidth,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  split: { flex: 1, flexDirection: 'row', gap: spacing.lg, minHeight: 0 },
  splitList: { flex: 1.1, minWidth: 0 },
  splitListContent: { paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 48 },
  splitMap: { flex: 0.9, minWidth: 320, paddingVertical: spacing.md },
  phone: { flex: 1, minHeight: 0 },
  phoneContent: { paddingVertical: spacing.md, gap: spacing.md, paddingBottom: 48 },
  viewToggle: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  toggleButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  toggleButtonActive: {
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
  },
  toggleText: { ...type.button, color: colors.textSecondary },
  toggleTextActive: { color: colors.info },
  listPanel: { gap: spacing.sm },
  mapPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mapPanelSticky: { alignSelf: 'flex-start' },
  mapMetrics: { ...type.sectionTitle, color: colors.info },
  title: { ...type.pageTitle, color: colors.text },
  description: { ...type.body, color: colors.textMuted },
  error: { ...type.secondaryStrong, color: colors.danger },
  warning: { ...type.secondary, color: colors.warning },
  primaryButton: {
    minHeight: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.actionPrimary,
    marginTop: spacing.sm,
  },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryText: { ...type.button, color: colors.textSecondary },
  disabled: { opacity: 0.45 },
});
