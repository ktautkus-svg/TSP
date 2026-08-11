import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { buildOptimizationRequestFromRoute } from '@/application/routes/route-request-builder';
import { resolveRoute, type ResolvedRouteDestination } from '@/application/routes/route-navigation';
import { CancelDraftRoute } from '@/application/routes/route-commands';
import { extractOrderedLocationsFromCandidate } from '@/application/routing/route-polyline-service';
import {
  buildFourObjectiveAlternatives,
  type LabeledRouteAlternative,
} from '@/application/routing/route-alternative-modes';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteMapView } from '@/components/route-map';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { OptimizationStop, RouteCandidate, RouteOptimizationRequest, RoutePolylineResult } from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { GatewayPolylineProvider } from '@/infrastructure/routing/providers/gateway-polyline-provider';
import { FallbackTravelCostProvider } from '@/infrastructure/routing/providers/fallback-travel-cost-provider';
import { GoogleTravelCostProvider, HereTravelCostProvider } from '@/infrastructure/routing/providers/gateway-travel-cost-provider';
import { SyntheticTravelCostProvider } from '@/infrastructure/routing/providers/synthetic-travel-cost-provider';
import { clockLabel, durationLabel } from '@/ui/route-eta-labels';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';

export default function RouteAlternativesScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [request, setRequest] = useState<RouteOptimizationRequest | null>(null);
  const [resultRequestId, setResultRequestId] = useState<string | null>(null);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  const [labeledAlternatives, setLabeledAlternatives] = useState<LabeledRouteAlternative[]>([]);
  const [polylineResult, setPolylineResult] = useState<RoutePolylineResult | null>(null);
  const [polylineError, setPolylineError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [recoveryDestination, setRecoveryDestination] = useState<ResolvedRouteDestination | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const startedForRoute = useRef<string | null>(null);
  // Cancelling flips the route to 'cancelled', which resolveRoute maps to
  // /history. Without this flag the screen's own status guard races the
  // intended navigation and sometimes dumps the driver into history instead.
  const selfCancelled = useRef(false);

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
      const provider = createTravelProvider();
      const four = await buildFourObjectiveAlternatives(new RoutingEngine(provider), nextRequest);
      await new SQLiteRoutingAuditRepository(db).saveOptimizationRun(routeId, four.request, four.result);
      setRequest(four.request);
      setResultRequestId(four.result.requestId);
      setRecommendedId(four.result.recommended?.id ?? four.labeled[0]?.candidate.id ?? null);
      setLabeledAlternatives(four.labeled);
      setSelectedId(four.result.recommended?.id ?? four.labeled[0]?.candidate.id ?? null);
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
      if (!active || !current || current.status === 'draft' || selfCancelled.current) return;
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

  useEffect(() => {
    if (syncRevision === 0) return;
    void repository.getById(routeId).then((current) => {
      if (!current || current.status === 'draft' || selfCancelled.current) return;
      const destination = resolveRoute(current);
      router.replace({ pathname: destination.pathname, params: destination.params } as Href);
    }).catch((reason) => {
      if (__DEV__) console.warn('ALTERNATIVES_SYNC_GUARD_FAILED', reason);
    });
  }, [repository, routeId, router, syncRevision]);

  const candidates = labeledAlternatives.map((item) => item.candidate);
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedId)
    ?? candidates.find((candidate) => candidate.id === recommendedId)
    ?? candidates[0];

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

  const openEditor = (candidateId: string | null = selectedId) => {
    if (!resultRequestId || !candidateId) return;
    router.push({
      pathname: '/route/[id]/edit',
      params: { id: routeId, runId: resultRequestId, candidateId },
    } as Href);
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
              .then(() => {
                void requestSync('mutation');
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
      {!labeledAlternatives.length && !error ? (
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
            disabled={!selectedId || cancelling}
            style={[styles.primaryButton, (!selectedId || cancelling) && styles.disabled]}
            onPress={() => openEditor(selectedId)}
            testID="save-selected-route-top">
            <Text style={styles.primaryText}>Tęsti su šiuo variantu</Text>
          </Pressable>
          <Pressable
            disabled={cancelling}
            style={[styles.restartButton, cancelling && styles.disabled]}
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
                    recommended={item.candidate.id === recommendedId}
                    selected={item.candidate.id === selectedId}
                    onSelect={() => setSelectedId(item.candidate.id)}
                    expanded={item.candidate.id === expandedCandidateId}
                    onToggleDetails={() => setExpandedCandidateId((current) => current === item.candidate.id ? null : item.candidate.id)}
                    onOpenEditor={() => {
                      setSelectedId(item.candidate.id);
                      openEditor(item.candidate.id);
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {request && resultRequestId && selectedId ? (
        <Pressable
          style={styles.secondaryButton}
          onPress={() => openEditor(selectedId)}
          testID="open-route-editor">
          <Text style={styles.secondaryText}>Atidaryti maršruto redaktorių</Text>
        </Pressable>
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

function candidateWeightTotalKg(candidate: RouteCandidate, request: RouteOptimizationRequest): number | null {
  let known = 0;
  let hasKnown = false;
  for (const stopId of candidate.stopSequence) {
    const stop = request.stops.find((item) => item.id === stopId);
    if (typeof stop?.weightKg === 'number') {
      known += stop.weightKg;
      hasKnown = true;
    }
  }
  return hasKnown ? known : null;
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
  onOpenEditor: () => void;
}) {
  const { styles } = props;
  const stopMap = useMemo(
    () => new Map(props.request.stops.map((stop) => [stop.id, stop])),
    [props.request.stops],
  );
  const orderedStops = props.candidate.stopSequence
    .map((id) => stopMap.get(id))
    .filter((stop): stop is OptimizationStop => Boolean(stop));
  const scheduleById = new Map(props.candidate.schedules.map((item) => [item.stopId, item]));
  const departure = clockLabel(props.candidate.legs[0]?.departureAt ?? props.request.plannedDepartureAt);
  const firstDelivery = clockLabel(props.candidate.schedules[0]?.serviceStartAt);
  const lastDelivery = clockLabel(props.candidate.schedules.at(-1)?.departureAt);
  const waitingMinutes = Math.round(props.candidate.waitingMinutes);
  const weightTotal = candidateWeightTotalKg(props.candidate, props.request);
  const hardCount = props.candidate.violations.filter((violation) => violation.type === 'hard').length;
  const softCount = props.candidate.violations.filter((violation) => violation.type === 'soft').length;

  return (
    <View style={[styles.card, props.recommended && styles.recommended, props.selected && styles.selected]}>
      <Pressable onPress={props.onSelect} style={styles.candidateSummary} testID={`route-alternative-${props.title}`}>
        <View style={styles.candidateTitleRow}>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={styles.selectionLabel}>{props.selected ? '✓ Pasirinkta' : 'Pasirinkti'}</Text>
        </View>
        <Text style={styles.metrics}>
          {durationLabel(props.candidate.totalWorkMinutes)} · {props.candidate.totalDistanceKm.toFixed(1)} km
          {weightTotal !== null ? ` · ${Math.round(weightTotal)} kg` : ''}
        </Text>
        <Text style={styles.comment}>{props.comment}</Text>
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
        {hardCount > 0 ? (
          <Text style={styles.feasibilityBad}>Laiko langų / ribų pažeidimai: {hardCount}</Text>
        ) : softCount > 0 ? (
          <Text style={styles.feasibilityWarn}>Įspėjimai dėl laiko langų: {softCount}</Text>
        ) : (
          <Text style={styles.feasibilityOk}>Laiko langai: be kritinių pažeidimų</Text>
        )}
      </Pressable>
      <Pressable onPress={props.onToggleDetails} style={styles.detailsButton}>
        <Text style={styles.secondaryText}>{props.expanded ? 'Slėpti eiliškumą' : 'Rodyti eiliškumą'}</Text>
      </Pressable>
      <Pressable onPress={props.onOpenEditor} style={styles.detailsButton} testID={`manual-edit-${props.candidate.id}`}>
        <Text style={styles.secondaryText}>Redaguoti maršruto redaktoriuje</Text>
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
  groupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  card: { flex: 1, minWidth: 260, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
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
  feasibilityOk: { ...type.meta, color: colors.primary },
  feasibilityWarn: { ...type.meta, color: colors.warning },
  feasibilityBad: { ...type.meta, color: colors.danger },
  sequenceList: { marginTop: spacing.sm, gap: 2 },
  sequenceRow: { ...type.secondary, color: colors.textMuted },
  detailsButton: { minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { minHeight: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.actionPrimary },
  primaryText: { ...type.button, color: colors.textInverse },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary },
  restartButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  restartText: { ...type.button, color: colors.danger },
  error: { ...type.secondaryStrong, color: colors.danger },
  warningCard: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft },
  warningTitle: { ...type.sectionTitle, color: colors.warning },
  disabled: { opacity: 0.45 },
});

function createTravelProvider() {
  return new FallbackTravelCostProvider([
    new GoogleTravelCostProvider(),
    new HereTravelCostProvider(),
    new SyntheticTravelCostProvider('linear'),
  ]);
}
