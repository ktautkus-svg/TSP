import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { parseCoordinateInput } from '@/application/import/address-resolver';
import {
    DeleteDraftStop,
    ReorderDraftStops,
    ReplaceDraftStops,
    SetStopPriority,
    UpdateDraftRouteLocations,
    UpdateDraftStop,
} from '@/application/routes/route-commands';
import {
    applyDominantCityContext,
    draftStopFromPersisted,
    manualAddressesToDraftStops,
    routeEndpointFromGeocode,
} from '@/application/routes/route-draft-mappers';
import { resolveRoute } from '@/application/routes/route-navigation';
import { GetDefaultLocations, KRETINGA_WAREHOUSE_ADDRESS } from '@/application/routes/saved-locations';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import { ChevronDownIcon, ChevronRightIcon, TrashIcon } from '@/components/app-icons';
import { FoundationScreen } from '@/components/foundation-screen';
import { AppButton } from '@/components/ui-primitives';
import { RouteRepository } from '@/database/repositories/route-repository';
import { AddressResolutionMemoryRepository } from '@/database/repositories/address-resolution-memory-repository';
import { ShipmentLineRepository } from '@/database/repositories/shipment-line-repository';
import type { DeliveryStop, Route, RouteEndpoint } from '@/domain/route';
import {
    GatewayGeocodingProvider,
    type GeocodeCandidate,
    type GeocodeResponse,
} from '@/infrastructure/routing/providers/gateway-geocoding-provider';
import { Alert } from '@/ui/alert';
import { devWarn } from '@/ui/dev-log';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

export default function RouteReviewScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { requestSync, revision: syncRevision } = useRouteCloudSync();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const addressMemory = useMemo(() => new AddressResolutionMemoryRepository(db), [db]);
  const provider = useMemo(() => new GatewayGeocodingProvider(), []);
  const [route, setRoute] = useState<Route | null>(null);
  const [defaultWarehouse, setDefaultWarehouse] = useState<RouteEndpoint | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [candidates, setCandidates] = useState<Record<string, GeocodeCandidate[]>>({});
  const [running, setRunning] = useState(false);
  const editQueue = useRef<Promise<void>>(Promise.resolve());
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const screenFocused = useRef(false);
  const automaticValidationRoute = useRef<string | null>(null);

  const redirectStalePlanningScreen = useCallback(async (): Promise<boolean> => {
    const current = await repository.getById(routeId);
    if (!current || current.status === 'draft') return false;
    const destination = resolveRoute(current);
    router.replace({
      pathname: destination.pathname,
      params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
    } as Href);
    return true;
  }, [repository, routeId, router]);

  const handleDraftActionError = useCallback(async (reason: unknown) => {
    devWarn('STALE_REVIEW_ACTION_BLOCKED', reason);
    try {
      if (await redirectStalePlanningScreen()) return;
    } catch (redirectError) {
      devWarn('STALE_REVIEW_REDIRECT_FAILED', redirectError);
    }
    setError(reason instanceof Error ? reason.message : 'Veiksmo atlikti nepavyko.');
  }, [redirectStalePlanningScreen]);

  const reload = useCallback(async () => {
    try {
      const [persisted, locations] = await Promise.all([
        repository.getWithStops(routeId),
        new GetDefaultLocations(db).execute().catch((reason) => {
          devWarn('REVIEW_DEFAULT_LOCATIONS_LOAD_FAILED', reason);
          return null;
        }),
      ]);
      if (persisted && persisted.route.status !== 'draft') {
        const destination = resolveRoute(persisted.route);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
        return;
      }
      setRoute(persisted?.route ?? null);
      setDefaultWarehouse(locations?.warehouse?.endpoint ?? null);
      const ordered = persisted?.stops ?? [];
      setStops([
        ...ordered.filter((stop) => stop.addressValidationState !== 'auto_confirmed'),
        ...ordered.filter((stop) => stop.addressValidationState === 'auto_confirmed'),
      ]);
    } catch (reason) {
      devWarn('REVIEW_ROUTE_LOAD_FAILED', reason);
      setError(reason instanceof Error ? reason.message : 'Maršruto atkurti nepavyko.');
    }
  }, [db, repository, routeId, router]);

  useFocusEffect(useCallback(() => {
    screenFocused.current = true;
    void reload();
    return () => { screenFocused.current = false; };
  }, [reload]));

  useEffect(() => {
    if (syncRevision > 0 && screenFocused.current) void reload();
  }, [reload, syncRevision]);

  const geocodeAll = async () => {
    if (!route || running) return;
    setRunning(true);
    setError(null);
    try {
      await editQueue.current;
      if (await redirectStalePlanningScreen()) return;
      const responseCache = new Map<string, GeocodeResponse>();
      const geocode = async (query: string): Promise<GeocodeResponse> => {
        const key = query.trim().toLocaleLowerCase('lt-LT');
        const cached = responseCache.get(key);
        if (cached) return cached;
        const response = await provider.geocode(query);
        responseCache.set(key, response);
        return response;
      };
      const start = route.startLocation;
      if (!start?.normalizedAddress || start.latitude === null || start.longitude === null) {
        try {
          const response = await geocode(start?.geocodingQuery ?? start?.originalAddress ?? '');
          const selected = response.isUnambiguous ? response.result : null;
          if (selected) {
            await new UpdateDraftRouteLocations(db).execute(
              routeId,
              routeEndpointFromGeocode(start!.originalAddress, selected, start!.geocodingQuery ?? start!.originalAddress),
              route.endLocation ?? routeEndpointFromGeocode(start!.originalAddress, selected, start!.geocodingQuery ?? start!.originalAddress),
            );
          } else {
            setCandidates((current) => ({ ...current, start: response.alternatives }));
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Starto vietos geokodavimo klaida.');
        }
      }
      const end = route.endLocation;
      if (!end?.normalizedAddress || end.latitude === null || end.longitude === null) {
        try {
          const response = await geocode(end?.geocodingQuery ?? end?.originalAddress ?? '');
          const selected = response.isUnambiguous ? response.result : null;
          const refreshedRoute = await repository.getById(routeId);
          if (selected && refreshedRoute?.startLocation) {
            await new UpdateDraftRouteLocations(db).execute(
              routeId,
              refreshedRoute.startLocation,
              routeEndpointFromGeocode(end!.originalAddress, selected, end!.geocodingQuery ?? end!.originalAddress),
            );
          } else {
            setCandidates((current) => ({ ...current, end: response.alternatives }));
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Pabaigos vietos geokodavimo klaida.');
        }
      }
      const queries = applyDominantCityContext(stops.map((stop) => stop.originalAddress));
      for (const [index, stop] of stops.entries()) {
        if (stop.addressValidationState === 'auto_confirmed') continue;
        const query = stop.geocodingQuery ?? queries[index] ?? stop.originalAddress;
        try {
          const response = await geocode(query);
          const selected = response.isUnambiguous ? response.result : null;
          if (selected) {
            await confirmStop(stop.id, stop.originalAddress, query, selected);
          } else {
            await new UpdateDraftStop(db).execute(routeId, stop.id, {
              geocodingQuery: query,
              addressValidationState: response.alternatives.length ? 'ambiguous' : 'geocode_error',
              geocodingError: response.alternatives.length ? null : 'Adresas nerastas.',
            });
            setCandidates((current) => ({ ...current, [stop.id]: response.alternatives }));
          }
        } catch (reason) {
          await new UpdateDraftStop(db).execute(routeId, stop.id, {
            geocodingQuery: query,
            addressValidationState: 'geocode_error',
            geocodingError: reason instanceof Error ? reason.message : 'Geokodavimo klaida.',
          });
        }
      }
      await reload();
      void requestSync('mutation');
    } catch (reason) {
      await handleDraftActionError(reason);
    } finally {
      setRunning(false);
    }
  };

  const confirmStop = async (
    stopId: string,
    originalAddress: string,
    query: string,
    selected: GeocodeCandidate,
  ) => {
    await new UpdateDraftStop(db).execute(routeId, stopId, {
      originalAddress,
      geocodingQuery: query,
      normalizedAddress: selected.normalizedAddress,
      addressValidationState: 'auto_confirmed',
      geocodingError: null,
      latitude: selected.latitude,
      longitude: selected.longitude,
    });
    await addressMemory.remember(originalAddress, {
      normalizedAddress: selected.normalizedAddress,
      latitude: selected.latitude,
      longitude: selected.longitude,
      placeId: selected.placeId,
      confidence: 1,
    });
    setCandidates((current) => ({ ...current, [stopId]: [] }));
  };

  const selectCandidate = async (stop: DeliveryStop, selected: GeocodeCandidate) => {
    try {
      if (await redirectStalePlanningScreen()) return;
      await confirmStop(stop.id, stop.originalAddress, stop.geocodingQuery ?? stop.originalAddress, selected);
      await reload();
      void requestSync('mutation');
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const applyWarehouse = async (choice: 'default' | 'kretinga') => {
    if (!route || running) return;
    setRunning(true);
    setError(null);
    try {
      if (await redirectStalePlanningScreen()) return;
      let nextWarehouse = choice === 'default' ? defaultWarehouse : null;
      if (choice === 'kretinga') {
        if (isKretingaWarehouse(route.startLocation) && route.startLocation?.latitude !== null && route.startLocation?.longitude !== null) {
          nextWarehouse = route.startLocation;
        } else {
          const response = await provider.geocode(KRETINGA_WAREHOUSE_ADDRESS);
          const selected = response.result ?? response.alternatives[0] ?? null;
          if (!selected) throw new Error('Kretingos sandėlio adreso rasti nepavyko.');
          nextWarehouse = routeEndpointFromGeocode(KRETINGA_WAREHOUSE_ADDRESS, selected, KRETINGA_WAREHOUSE_ADDRESS);
        }
      }
      if (!nextWarehouse) throw new Error('Numatytasis sandėlis nenustatytas.');
      const returnedToStart = sameEndpoint(route.startLocation, route.endLocation);
      await new UpdateDraftRouteLocations(db).execute(
        routeId,
        nextWarehouse,
        nextWarehouse,
      );
      setCandidates((current) => ({ ...current, start: [], ...(returnedToStart ? { end: [] } : {}) }));
      await reload();
      void requestSync('mutation');
    } catch (reason) {
      await handleDraftActionError(reason);
    } finally {
      setRunning(false);
    }
  };

  const editStop = async (stop: DeliveryStop, patch: Parameters<UpdateDraftStop['execute']>[2]) => {
    const operation = editQueue.current.then(async () => {
      try {
        if (await redirectStalePlanningScreen()) return;
        await new UpdateDraftStop(db).execute(routeId, stop.id, patch);
        if (patch.addressValidationState === 'auto_confirmed'
          && typeof patch.latitude === 'number'
          && typeof patch.longitude === 'number') {
          await addressMemory.remember(stop.originalAddress, {
            normalizedAddress: patch.normalizedAddress ?? stop.normalizedAddress ?? stop.originalAddress,
            latitude: patch.latitude,
            longitude: patch.longitude,
            placeId: null,
            confidence: 1,
          });
        }
        await reload();
        void requestSync('mutation');
      } catch (reason) {
        await handleDraftActionError(reason);
      }
    });
    editQueue.current = operation.catch(() => undefined);
    await operation;
  };

  const deleteStop = (stop: DeliveryStop) => Alert.alert(
    'Pašalinti tašką?',
    stop.originalAddress,
    [
      { text: 'Ne', style: 'cancel' },
      { text: 'Pašalinti', style: 'destructive', onPress: () => { void (async () => {
        try {
          if (await redirectStalePlanningScreen()) return;
          await new DeleteDraftStop(db).execute(routeId, stop.id);
          await reload();
          void requestSync('mutation');
        } catch (reason) {
          await handleDraftActionError(reason);
        }
      })(); } },
    ],
  );

  const moveStop = async (stopId: string, delta: -1 | 1) => {
    const ordered = [...stops].sort((a, b) => a.originalOrder - b.originalOrder);
    const index = ordered.findIndex((stop) => stop.id === stopId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    try {
      if (await redirectStalePlanningScreen()) return;
      await new ReorderDraftStops(db).execute(routeId, ordered.map((stop) => stop.id));
      await reload();
      void requestSync('mutation');
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const setPriority = async (stop: DeliveryStop, priorityFirst: boolean) => {
    try {
      if (await redirectStalePlanningScreen()) return;
      await new SetStopPriority(db).execute(routeId, stop.id, priorityFirst);
      await reload();
      void requestSync('mutation');
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const addStop = async () => {
    if (!newAddress.trim()) return;
    try {
      if (await redirectStalePlanningScreen()) return;
      const persistedStops = await repository.getStops(routeId);
      const shipmentLines = await new ShipmentLineRepository(db).getGroupedByStop(routeId);
      const existing = persistedStops.map((persisted) => ({
        ...draftStopFromPersisted(persisted),
        shipmentLines: (shipmentLines.get(persisted.id) ?? []).map((line) => ({
          sourceImportId: line.sourceImportId,
          sourceSheetName: line.sourceSheetName,
          sourceRowNumber: line.sourceRowNumber,
          orderNumber: line.orderNumber,
          weightGrams: line.weightGrams,
          deliveryTimeFrom: line.deliveryTimeFrom,
          deliveryTimeTo: line.deliveryTimeTo,
          supplierPrefix: line.supplierPrefix,
          recipient: line.recipient,
          routeCode: line.routeCode,
          rawColumnD: line.rawColumnD,
          rawColumnE: line.rawColumnE,
          rawRow: line.rawRow,
        })),
      }));
      await new ReplaceDraftStops(db).execute(routeId, [
      ...existing.map((stop, index) => ({ ...stop, originalOrder: index + 1 })),
      ...manualAddressesToDraftStops([newAddress.trim()]).map((stop) => ({
        ...stop,
        originalOrder: existing.length + 1,
      })),
    ]);
      setNewAddress('');
      await reload();
      void requestSync('mutation');
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const startReady = Boolean(
    route?.startLocation?.normalizedAddress &&
    route.startLocation.latitude !== null &&
    route.startLocation.longitude !== null,
  );
  const allReady = stops.length > 0 && stops.every((stop) => stop.addressValidationState === 'auto_confirmed');
  const endReady = Boolean(
    route?.endLocation?.normalizedAddress &&
    route.endLocation.latitude !== null &&
    route.endLocation.longitude !== null,
  );
  const knownWeightKg = stops.reduce((total, stop) => total + (stop.weightKg ?? 0), 0);
  const confirmedStops = stops.filter((stop) => stop.addressValidationState === 'auto_confirmed').length;
  const canCalculate = startReady && endReady && allReady;
  const visibleStops = allReady
    ? stops
    : stops.filter((stop) => stop.addressValidationState !== 'auto_confirmed');

  useEffect(() => {
    if (!route || running || canCalculate || stops.length === 0 || automaticValidationRoute.current === route.id) return;
    automaticValidationRoute.current = route.id;
    void geocodeAll();
    // The route id is the one-shot boundary. State changes caused by geocoding
    // must not start a second provider pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalculate, route?.id, running, stops.length]);

  if (!route) {
    return <FoundationScreen showFoundationNotice={false} title="Maršrutas nerastas" description="Grįžkite į pradžios ekraną." />;
  }

  const goToAlternatives = () => {
    if (stops.length === 0) {
      Alert.alert('Nėra taškų', 'Maršrutas neturi nei vieno pristatymo taško. Prašome pridėti ar importuoti bent vieną tašką prieš skaičiuojant.');
      return;
    }
    if (!canCalculate) {
      Alert.alert('Dar liko nepatvirtintų adresų', 'Pirmiausia patikrinkite tik pažymėtus probleminius adresus.');
      return;
    }
    router.push({ pathname: '/route/[id]/alternatives', params: { id: routeId } });
  };

  return (
    <>
    <Stack.Screen options={{ gestureEnabled: false, title: 'Maršruto taškai' }} />
    <FoundationScreen
      showFoundationNotice={false}
      title="Maršruto taškai"
      description={allReady ? 'Adresai patikrinti automatiškai. Jei reikia, pažymėkite prioritetinius taškus.' : 'Automatiškai tikrinami adresai. Žemiau rodomi tik tie, kuriems reikia dėmesio.'}>
      <View style={styles.planSummary} testID="route-plan-summary">
        <View style={styles.planMetric}>
          <Text style={styles.planMetricValue}>{stops.length}</Text>
          <Text style={styles.planMetricLabel}>TAŠKAI</Text>
        </View>
        <View style={styles.planMetricDivider} />
        <View style={styles.planMetric}>
          <Text style={styles.planMetricValue}>{new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 }).format(Math.round(knownWeightKg))} kg</Text>
          <Text style={styles.planMetricLabel}>ŽINOMAS SVORIS</Text>
        </View>
        <View style={styles.planMetricDivider} />
        <View style={styles.planMetric}>
          <Text style={styles.planMetricValue}>{confirmedStops}/{stops.length}</Text>
          <Text style={styles.planMetricLabel}>PATVIRTINTA</Text>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.warehouseChoice} testID="review-warehouse-choice">
          <Text style={styles.warehouseChoiceTitle}>Sandėlis</Text>
          <Text style={styles.auditText}>Numatytasis parinktas automatiškai. Keiskite tik jei išvykstate iš kito sandėlio.</Text>
          <View style={styles.warehouseChoiceRow}>
            <Pressable
              disabled={running || !defaultWarehouse}
              onPress={() => { void applyWarehouse('default'); }}
              style={[styles.warehouseChoiceButton, sameEndpoint(route.startLocation, defaultWarehouse) && styles.warehouseChoiceButtonActive, (running || !defaultWarehouse) && styles.disabled]}
              testID="apply-current-warehouse">
              <Text style={[styles.warehouseChoiceButtonTitle, sameEndpoint(route.startLocation, defaultWarehouse) && styles.warehouseChoiceButtonTitleActive]}>Numatytasis sandėlis</Text>
            </Pressable>
            <Pressable
              disabled={running}
              onPress={() => { void applyWarehouse('kretinga'); }}
              style={[styles.warehouseChoiceButton, isKretingaWarehouse(route.startLocation) && styles.warehouseChoiceButtonActive, running && styles.disabled]}
              testID="apply-kretinga-warehouse">
              <Text style={[styles.warehouseChoiceButtonTitle, isKretingaWarehouse(route.startLocation) && styles.warehouseChoiceButtonTitleActive]}>Kretingos sandėlis</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <AppButton
        disabled={!canCalculate || running}
        label="Optimizuoti maršrutą"
        onPress={goToAlternatives}
      />

      {running ? <Text style={styles.auditText}>Tikrinami nepatvirtinti adresai…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {allReady ? <Text style={styles.sectionIntro}>Pažymėkite vieną ar kelis prioritetinius taškus (1, 2, 3…). Jie bus apeinami ta eile, bet tarp jų gali įsiterpti kiti taškai, jei geografiškai pakeliui.</Text> : null}
      {visibleStops.map((stop) => {
        const priorityRank = stop.priorityRank ?? 0;
        return (
        <StopEditor
          styles={styles}
          key={stop.id}
          stop={stop}
          priorityRank={priorityRank}
          compact={allReady || stop.addressValidationState === 'auto_confirmed'}
          candidates={candidates[stop.id] ?? []}
          onCandidate={(candidate) => { void selectCandidate(stop, candidate); }}
          onEdit={(patch) => editStop(stop, patch)}
          onDelete={() => deleteStop(stop)}
          onMove={moveStop}
          onSetPriority={(priorityFirst) => setPriority(stop, priorityFirst)}
        />
      );
      })}

      <View style={styles.card}>
        <Text style={styles.heading}>Pridėti tašką</Text>
        <TextInput value={newAddress} onChangeText={setNewAddress} placeholder="Adresas" style={styles.input} />
        <Pressable style={styles.secondaryButton} onPress={() => void addStop()}><Text style={styles.secondaryText}>Pridėti</Text></Pressable>
      </View>

      {/* Repeated at the bottom so a long stop list never forces a scroll back up. */}
      <AppButton
        disabled={!canCalculate || running}
        label="Optimizuoti maršrutą"
        onPress={goToAlternatives}
        testID="optimize-route-bottom"
      />
    </FoundationScreen>
    </>
  );
}

function formatTimeWindowInput(from: string | null, to: string | null): string {
  if (!from && !to) return '';
  if (from && to && from !== to) return `${from}-${to}`;
  return (from || to) ?? '';
}

function sameEndpoint(left: RouteEndpoint | null | undefined, right: RouteEndpoint | null | undefined): boolean {
  if (!left || !right) return false;
  const leftAddress = (left.normalizedAddress ?? left.originalAddress).trim().toLocaleLowerCase('lt-LT');
  const rightAddress = (right.normalizedAddress ?? right.originalAddress).trim().toLocaleLowerCase('lt-LT');
  if (leftAddress && rightAddress && leftAddress === rightAddress) return true;
  if (left.latitude === null || left.longitude === null || right.latitude === null || right.longitude === null) return false;
  return Math.abs(left.latitude - right.latitude) < 0.00001 && Math.abs(left.longitude - right.longitude) < 0.00001;
}

function isKretingaWarehouse(endpoint: RouteEndpoint | null | undefined): boolean {
  if (!endpoint) return false;
  const expected = canonicalWarehouseAddress(KRETINGA_WAREHOUSE_ADDRESS);
  return [endpoint.originalAddress, endpoint.normalizedAddress, endpoint.geocodingQuery]
    .some((address) => canonicalWarehouseAddress(address ?? '') === expected);
}

function canonicalWarehouseAddress(address: string): string {
  return address
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .replace(/\b\d{5}\b/g, ' ')
    .replace(/\blietuva\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseTimeWindowInput(val: string): { deliveryTimeFrom: string | null; deliveryTimeTo: string | null; requiredTimeWindow: boolean } {
  const clean = val.trim().replace(/[–—]/g, '-');
  if (!clean) return { deliveryTimeFrom: null, deliveryTimeTo: null, requiredTimeWindow: false };
  if (clean.includes('-')) {
    const parts = clean.split('-').map((s) => s.trim());
    const from = parts[0] || null;
    const to = parts[1] || from || null;
    return { deliveryTimeFrom: from, deliveryTimeTo: to, requiredTimeWindow: Boolean(from && to) };
  }
  return { deliveryTimeFrom: clean, deliveryTimeTo: clean, requiredTimeWindow: false };
}

function StopEditor(props: {
  styles: ReturnType<typeof createStyles>;
  stop: DeliveryStop;
  compact: boolean;
  priorityRank: number;
  candidates: GeocodeCandidate[];
  onCandidate: (candidate: GeocodeCandidate) => void;
  onEdit: (patch: Parameters<UpdateDraftStop['execute']>[2]) => Promise<void>;
  onDelete: () => void;
  onMove: (stopId: string, delta: -1 | 1) => void;
  onSetPriority: (priorityFirst: boolean) => void;
}) {
  const { stop, styles } = props;
  const [address, setAddress] = useState(stop.originalAddress);
  const [weight, setWeight] = useState(stop.weightKg === null ? '' : String(stop.weightKg));
  const [recipient, setRecipient] = useState(stop.recipient);
  const [time, setTime] = useState(formatTimeWindowInput(stop.deliveryTimeFrom, stop.deliveryTimeTo));
  const [notes, setNotes] = useState(stop.notes ?? '');
  const [expanded, setExpanded] = useState(!props.compact);
  const isOk = stop.addressValidationState === 'auto_confirmed';
  const cityHint = extractCityHint(stop.normalizedAddress ?? stop.originalAddress);
  useEffect(() => {
    setAddress(stop.originalAddress);
    setWeight(stop.weightKg === null ? '' : String(stop.weightKg));
    setRecipient(stop.recipient);
    setTime(formatTimeWindowInput(stop.deliveryTimeFrom, stop.deliveryTimeTo));
    setNotes(stop.notes ?? '');
  }, [stop]);
  useEffect(() => {
    if (!props.compact || !isOk) setExpanded(true);
    else setExpanded(false);
  }, [props.compact, isOk]);
  return (
    <View style={[
      styles.card,
      props.compact && styles.compactCard,
      isOk ? styles.okCard : styles.problemCard,
    ]}>
      {props.compact ? (
        <View style={styles.compactRow}>
          <View style={[styles.statusDot, isOk ? styles.statusDotOk : styles.statusDotBad]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${stop.originalAddress}${cityHint ? `, ${cityHint}` : ''}. Rodyti detales`}
            onPress={() => setExpanded((value) => !value)}
            style={styles.compactMain}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.compactTitle}>
              {stop.originalAddress}
            </Text>
            <Text numberOfLines={1} style={styles.compactMeta}>
              {[
                cityHint,
                stop.weightKg === null ? null : `${Math.round(stop.weightKg)} kg`,
                formatTimeWindowInput(stop.deliveryTimeFrom, stop.deliveryTimeTo) || null,
              ].filter(Boolean).join(' · ') || ' '}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: stop.priorityFirst }}
            accessibilityLabel={props.priorityRank > 0 ? `Prioritetas ${props.priorityRank}` : 'Prioritetinis taškas'}
            style={[styles.priorityStar, stop.priorityFirst && styles.priorityStarActive]}
            onPress={() => props.onSetPriority(!stop.priorityFirst)}>
            <Text style={[styles.priorityStarText, stop.priorityFirst && styles.priorityStarTextActive]}>
              {props.priorityRank > 0 ? String(props.priorityRank) : '☆'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pašalinti tašką"
            onPress={props.onDelete}
            style={styles.compactIconButton}
            testID={`delete-stop-${stop.id}`}>
            <TrashIcon size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Rodyti detales" onPress={() => setExpanded((value) => !value)} style={styles.compactIconButton}>
            {expanded ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
          </Pressable>
        </View>
      ) : (
        <View style={styles.rowBetween}>
          <Text style={styles.heading}>Taškas {stop.originalOrder}{props.priorityRank > 0 ? ` · prioritetas ${props.priorityRank}` : ''}</Text>
          <StateLabel styles={styles} ready={isOk} state={stop.addressValidationState} />
        </View>
      )}
      {expanded ? <>
      <TextInput
        value={address}
        onChangeText={setAddress}
        onBlur={() => {
          const coordinates = parseCoordinateInput(address.trim());
          void props.onEdit(coordinates ? {
            // Coordinates only repair the location. Keep the imported/manual
            // place name as the operational label shown to the driver.
            originalAddress: stop.originalAddress,
            geocodingQuery: address.trim(),
            normalizedAddress: stop.normalizedAddress ?? stop.originalAddress,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            addressValidationState: 'auto_confirmed',
            geocodingError: null,
          } : {
            originalAddress: address.trim(),
            geocodingQuery: address.trim(),
            normalizedAddress: null,
            latitude: null,
            longitude: null,
            addressValidationState: 'unconfirmed',
            geocodingError: null,
          });
        }}
        placeholder="Adresas, koordinatės, Google Maps arba maps.lt nuoroda *"
        style={styles.input}
      />
      {stop.geocodingQuery && stop.geocodingQuery !== stop.originalAddress ? (
        <Text style={styles.auditText}>Tikrinta kaip: {stop.geocodingQuery}</Text>
      ) : null}
      {stop.normalizedAddress ? <Text style={styles.auditText}>Patvirtinta: {stop.normalizedAddress}</Text> : null}
      {stop.geocodingError ? <Text style={styles.error}>{stop.geocodingError}</Text> : null}
      {props.candidates.map((candidate) => (
        <Candidate styles={styles} key={candidate.normalizedAddress} candidate={candidate} onPress={() => props.onCandidate(candidate)} />
      ))}
      <View style={styles.twoColumns}>
        <View style={styles.importantField}><Text style={styles.importantFieldLabel}>SVORIS, KG</Text><TextInput value={weight} onChangeText={setWeight} onBlur={() => { void props.onEdit({ weightKg: nullableNumber(weight) }); }} placeholder="Neprivaloma" keyboardType="decimal-pad" style={styles.input} /></View>
        <View style={styles.importantField}><Text style={styles.importantFieldLabel}>PRISTATYMO LAIKAS</Text><TextInput value={time} onChangeText={setTime} onBlur={() => { void props.onEdit(parseTimeWindowInput(time)); }} placeholder="Pvz. 08:00-12:00" style={styles.input} /></View>
      </View>
      <TextInput value={recipient} onChangeText={setRecipient} onBlur={() => { void props.onEdit({ recipient: recipient.trim() || null }); }} placeholder="Gavėjas (neprivaloma)" style={styles.input} />
      <TextInput value={notes} onChangeText={setNotes} onBlur={() => { void props.onEdit({ notes: notes.trim() || null }); }} placeholder="Pastabos (neprivaloma)" style={styles.input} />
      <Pressable
        style={[styles.priorityButton, stop.priorityFirst && styles.priorityButtonActive]}
        onPress={() => props.onSetPriority(!stop.priorityFirst)}>
        <Text style={[styles.priorityText, stop.priorityFirst && styles.priorityTextActive]}>
          {props.priorityRank > 0
            ? `⭐ Prioritetas ${props.priorityRank} (išlaikyti eilę pakeliui)`
            : 'Pažymėti kaip prioritetinį'}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable style={styles.deleteButton} onPress={props.onDelete}><Text style={styles.deleteText}>Pašalinti</Text></Pressable>
      </View>
      </> : null}
    </View>
  );
}

function Candidate({ styles, candidate, onPress }: { styles: ReturnType<typeof createStyles>; candidate: GeocodeCandidate; onPress: () => void }) {
  return (
    <Pressable style={styles.candidate} onPress={onPress}>
      <Text style={styles.candidateText}>{candidate.normalizedAddress}</Text>
      <Text style={styles.auditText}>{candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}</Text>
    </Pressable>
  );
}

function StateLabel({ styles, ready, state }: { styles: ReturnType<typeof createStyles>; ready: boolean; state: DeliveryStop['addressValidationState'] }) {
  const labels: Record<DeliveryStop['addressValidationState'], string> = {
    auto_confirmed: 'Automatiškai patvirtinta',
    ambiguous: 'Keli variantai',
    unconfirmed: 'Nepatikrinta',
    geocode_error: 'Geokodavimo klaida',
  };
  return <Text style={ready ? styles.ready : styles.warning}>{labels[state]}</Text>;
}

function nullableNumber(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}

function extractCityHint(address: string): string | null {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]!;
  if (/lietuva|lithuania/i.test(last) && parts.length >= 3) return parts[parts.length - 2]!;
  return last;
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  headerText: { ...type.secondaryStrong, color: colors.brandNavy },
  sectionIntro: { ...type.bodyStrong, color: colors.textSecondary },
  planSummary: { flexDirection: 'row', alignItems: 'stretch', padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  planMetric: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: spacing.xs },
  planMetricValue: { ...type.readout, color: colors.text, textAlign: 'center' },
  planMetricLabel: { ...type.label, color: colors.textMuted, textAlign: 'center' },
  planMetricDivider: { width: 1, backgroundColor: colors.border, marginVertical: 3 },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  compactCard: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: spacing.xs },
  compactRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  compactMain: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  compactTitle: { ...type.bodyStrong, color: colors.text },
  compactMeta: { ...type.secondaryStrong, color: colors.textSecondary, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: radius.pill },
  statusDotOk: { backgroundColor: colors.success },
  statusDotBad: { backgroundColor: colors.danger },
  okCard: { borderColor: colors.border },
  priorityStar: { width: 42, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSubtle },
  priorityStarActive: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  priorityStarText: { color: colors.textMuted, fontSize: 24, lineHeight: 26 },
  priorityStarTextActive: { ...type.sectionTitle, color: colors.warning },
  expandButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  expandText: { color: colors.textMuted, fontSize: 27, lineHeight: 30 },
  compactIconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  problemCard: { borderColor: colors.danger, borderWidth: 1 },
  heading: { ...type.sectionTitle, color: colors.text },
  query: { ...type.body, color: colors.textSecondary },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  twoColumns: { gap: spacing.sm }, importantField: { flex: 1, gap: spacing.xs }, importantFieldLabel: { ...type.label, color: colors.primary },
  input: { minHeight: 46, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, ...type.body },
  auditText: { ...type.meta, color: colors.textMuted },
  warehouseChoice: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft },
  warehouseChoiceTitle: { ...type.bodyStrong, color: colors.text },
  warehouseChoiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  warehouseChoiceButton: { flex: 1, minWidth: 220, minHeight: 74, justifyContent: 'center', gap: 4, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  warehouseChoiceButtonActive: { borderColor: colors.info, borderWidth: 2, backgroundColor: colors.surfaceElevated },
  warehouseChoiceButtonTitle: { ...type.secondaryStrong, color: colors.textSecondary },
  warehouseChoiceButtonTitleActive: { color: colors.info },
  ready: { ...type.meta, color: colors.success },
  warning: { ...type.meta, color: colors.warning },
  error: { ...type.secondaryStrong, color: colors.danger },
  secondaryButton: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...type.button, color: colors.textSecondary },
  candidate: { padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft },
  candidateText: { ...type.secondaryStrong, color: colors.text },
  priorityButton: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  priorityButtonActive: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  priorityText: { ...type.secondaryStrong, color: colors.textMuted },
  priorityTextActive: { color: colors.warning },
  actions: { flexDirection: 'row', gap: spacing.sm },
  smallButton: { minWidth: 46, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  deleteButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger },
  deleteText: { ...type.button, color: colors.danger },
  disabled: { opacity: 0.45 },
});
