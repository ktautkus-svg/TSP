import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { buildOptimizationRequestFromRoute } from '@/application/routes/route-request-builder';
import { resolveRoute, type ResolvedRouteDestination } from '@/application/routes/route-navigation';
import { ActivateRoute, SaveSelectedRouteCandidate } from '@/application/routes/route-commands';
import { extractOrderedLocationsFromCandidate } from '@/application/routing/route-polyline-service';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteMapView } from '@/components/route-map';
import { RouteRepository } from '@/database/repositories/route-repository';
import type { OptimizationStop, RouteCandidate, RouteOptimizationRequest, RouteOptimizationResult, RoutePolylineResult } from '@/domain/routing/models';
import { SQLiteRoutingAuditRepository } from '@/infrastructure/routing/persistence/sqlite-routing-audit-repository';
import { GatewayPolylineProvider } from '@/infrastructure/routing/providers/gateway-polyline-provider';
import { FallbackTravelCostProvider } from '@/infrastructure/routing/providers/fallback-travel-cost-provider';
import { GoogleTravelCostProvider, HereTravelCostProvider } from '@/infrastructure/routing/providers/gateway-travel-cost-provider';
import { SyntheticTravelCostProvider } from '@/infrastructure/routing/providers/synthetic-travel-cost-provider';
import { presentRoutingDataSource } from '@/ui/routing-data-source';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

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
  const [saving, setSaving] = useState(false);
  const [recoveryDestination, setRecoveryDestination] = useState<ResolvedRouteDestination | null>(null);
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
      const provider = new FallbackTravelCostProvider([
        new GoogleTravelCostProvider(),
        new HereTravelCostProvider(),
        new SyntheticTravelCostProvider('linear'),
      ]);
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

  const saveAndLoad = async () => {
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
      await new ActivateRoute(db).execute(routeId);
      router.replace({ pathname: '/route/[id]/loading', params: { id: routeId } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Maršruto išsaugoti nepavyko.');
      setSaving(false);
      savingRef.current = false;
    }
  };

  const orderedLocations = selectedCandidate && request
    ? extractOrderedLocationsFromCandidate(selectedCandidate, request)
    : null;
  const stopLabel = (stopId: string | null): string => {
    if (!stopId || !request) return '';
    return request.stops.find((stop) => stop.id === stopId)?.location.label ?? stopId;
  };
  const softWarnings = selectedCandidate?.violations.filter((violation) => violation.type === 'soft') ?? [];
  const source = result && request
    ? presentRoutingDataSource({
        provider: result.provider,
        executionMode: result.executionMode,
        trafficMode: request.trafficMode,
      })
    : null;

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
      {source ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{source.title}</Text>
          <Text style={styles.noticeSubtext}>{source.trafficLabel}</Text>
        </View>
      ) : null}
      {orderedLocations ? (
        <RouteMapView
          {...orderedLocations}
          encodedPolyline={polylineResult?.encodedPolyline}
          totalDistanceKm={selectedCandidate?.totalDistanceKm}
          totalDurationMinutes={selectedCandidate?.drivingMinutes}
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
              recommended={index === 0}
              selected={candidate.id === selectedId}
              onSelect={() => setSelectedId(candidate.id)}
            />
          ))}
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
      {candidates.length > 0 ? (
        <Pressable
          disabled={!selectedId || saving}
          style={[styles.primaryButton, (!selectedId || saving) && styles.disabled]}
          onPress={saveAndLoad}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Išsaugoti ir krautis</Text>}
        </Pressable>
      ) : null}
    </FoundationScreen>
  );
}

function CandidateCard(props: {
  styles: ReturnType<typeof createStyles>;
  candidate: RouteCandidate;
  request: RouteOptimizationRequest;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { styles } = props;
  const stopMap = useMemo(
    () => new Map(props.request.stops.map((stop) => [stop.id, stop])),
    [props.request.stops],
  );
  const orderedStops = props.candidate.stopSequence
    .map((id) => stopMap.get(id))
    .filter((stop): stop is OptimizationStop => Boolean(stop));
  const totalWeightKg = orderedStops.reduce((sum, stop) => sum + (stop.weightKg ?? 0), 0);

  return (
    <Pressable onPress={props.onSelect} style={[styles.card, props.recommended && styles.recommended, props.selected && styles.selected]}>
      <Text style={styles.title}>{props.recommended ? 'Rekomenduojamas' : 'Alternatyva'}</Text>
      <Text style={styles.metrics}>
        {Math.round(props.candidate.totalWorkMinutes)} min · {props.candidate.totalDistanceKm.toFixed(1)} km · {totalWeightKg.toFixed(1)} kg
      </Text>
      <View style={styles.sequenceList}>
        {orderedStops.map((stop, index) => (
          <Text key={stop.id} style={styles.sequenceRow}>
            {index + 1}. {stop.location.label}{stop.weightKg !== null ? `  ·  ${stop.weightKg} kg` : '  ·  svoris nežinomas'}
          </Text>
        ))}
      </View>
      <View style={styles.selectButton}><Text style={styles.primaryText}>{props.selected ? 'Pasirinkta' : 'Pasirinkti variantą'}</Text></View>
    </Pressable>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  list: { gap: spacing.md },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  notice: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.primarySoft },
  noticeText: { color: colors.primary, fontWeight: '700' },
  noticeSubtext: { color: colors.textMuted, marginTop: spacing.xs },
  card: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  recommended: { borderWidth: 2, borderColor: colors.primary },
  selected: { backgroundColor: colors.primarySoft },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  description: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  metrics: { color: colors.primary, fontSize: 14, fontWeight: '800', marginTop: spacing.sm },
  sequenceList: { marginTop: spacing.sm, gap: 2 },
  sequenceRow: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  selectButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginTop: spacing.md },
  primaryButton: { minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  primaryText: { color: '#fff', fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
  errorCard: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.danger },
  warningCard: { padding: spacing.lg, borderRadius: 18, borderWidth: 1, borderColor: colors.warning ?? '#f59e0b', backgroundColor: colors.surface },
  warningTitle: { color: colors.warning ?? '#f59e0b', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});
