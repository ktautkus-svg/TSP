import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { Alert } from '@/ui/alert';
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
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import { ShipmentLineRepository } from '@/database/repositories/shipment-line-repository';
import type { DeliveryStop, Route } from '@/domain/route';
import {
  GatewayGeocodingProvider,
  type GeocodeCandidate,
} from '@/infrastructure/routing/providers/gateway-geocoding-provider';
import { colors, spacing } from '@/ui/tokens';

export default function RouteReviewScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { id: routeId = '' } = useLocalSearchParams<{ id: string }>();
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const provider = useMemo(() => new GatewayGeocodingProvider(), []);
  const [route, setRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [candidates, setCandidates] = useState<Record<string, GeocodeCandidate[]>>({});
  const [running, setRunning] = useState(false);
  const editQueue = useRef<Promise<void>>(Promise.resolve());
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    if (__DEV__) console.warn('STALE_REVIEW_ACTION_BLOCKED', reason);
    try {
      if (await redirectStalePlanningScreen()) return;
    } catch (redirectError) {
      if (__DEV__) console.warn('STALE_REVIEW_REDIRECT_FAILED', redirectError);
    }
    setError(reason instanceof Error ? reason.message : 'Veiksmo atlikti nepavyko.');
  }, [redirectStalePlanningScreen]);

  const reload = useCallback(async () => {
    try {
      const persisted = await repository.getWithStops(routeId);
      if (persisted && persisted.route.status !== 'draft') {
        const destination = resolveRoute(persisted.route);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
        return;
      }
      setRoute(persisted?.route ?? null);
      const ordered = persisted?.stops ?? [];
      setStops([
        ...ordered.filter((stop) => stop.addressValidationState !== 'auto_confirmed'),
        ...ordered.filter((stop) => stop.addressValidationState === 'auto_confirmed'),
      ]);
    } catch (reason) {
      if (__DEV__) console.warn('REVIEW_ROUTE_LOAD_FAILED', reason);
      setError(reason instanceof Error ? reason.message : 'Maršruto atkurti nepavyko.');
    }
  }, [repository, routeId, router]);

  useFocusEffect(useCallback(() => {
    void reload();
  }, [reload]));

  const geocodeAll = async () => {
    if (!route || running) return;
    setRunning(true);
    setError(null);
    try {
      await editQueue.current;
      if (await redirectStalePlanningScreen()) return;
      const start = route.startLocation;
      if (!start?.normalizedAddress || start.latitude === null || start.longitude === null) {
        try {
          const response = await provider.geocode(start?.geocodingQuery ?? start?.originalAddress ?? '');
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
          const response = await provider.geocode(end?.geocodingQuery ?? end?.originalAddress ?? '');
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
          const response = await provider.geocode(query);
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
    setCandidates((current) => ({ ...current, [stopId]: [] }));
  };

  const selectCandidate = async (stop: DeliveryStop, selected: GeocodeCandidate) => {
    try {
      if (await redirectStalePlanningScreen()) return;
      await confirmStop(stop.id, stop.originalAddress, stop.geocodingQuery ?? stop.originalAddress, selected);
      await reload();
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const selectStart = async (selected: GeocodeCandidate) => {
    if (!route?.startLocation) return;
    try {
      if (await redirectStalePlanningScreen()) return;
      await new UpdateDraftRouteLocations(db).execute(
      routeId,
      routeEndpointFromGeocode(
        route.startLocation.originalAddress,
        selected,
        route.startLocation.geocodingQuery ?? route.startLocation.originalAddress,
      ),
      route.endLocation ?? routeEndpointFromGeocode(
        route.startLocation.originalAddress,
        selected,
        route.startLocation.geocodingQuery ?? route.startLocation.originalAddress,
      ),
    );
      setCandidates((current) => ({ ...current, start: [] }));
      await reload();
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const selectEnd = async (selected: GeocodeCandidate) => {
    if (!route?.startLocation || !route.endLocation) return;
    try {
      if (await redirectStalePlanningScreen()) return;
      await new UpdateDraftRouteLocations(db).execute(
      routeId,
      route.startLocation,
      routeEndpointFromGeocode(
        route.endLocation.originalAddress,
        selected,
        route.endLocation.geocodingQuery ?? route.endLocation.originalAddress,
      ),
    );
      setCandidates((current) => ({ ...current, end: [] }));
      await reload();
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const editStop = async (stop: DeliveryStop, patch: Parameters<UpdateDraftStop['execute']>[2]) => {
    const operation = editQueue.current.then(async () => {
      try {
        if (await redirectStalePlanningScreen()) return;
        await new UpdateDraftStop(db).execute(routeId, stop.id, patch);
        await reload();
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
    } catch (reason) {
      await handleDraftActionError(reason);
    }
  };

  const setPriority = async (stop: DeliveryStop, priorityFirst: boolean) => {
    try {
      if (await redirectStalePlanningScreen()) return;
      await new SetStopPriority(db).execute(routeId, stop.id, priorityFirst);
      await reload();
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

  if (!route) {
    return <FoundationScreen showFoundationNotice={false} title="Maršrutas nerastas" description="Grįžkite į pradžios ekraną." />;
  }

  const goToAlternatives = () => {
    if (stops.length === 0) {
      Alert.alert('Nėra taškų', 'Maršrutas neturi nei vieno pristatymo taško. Prašome pridėti ar importuoti bent vieną tašką prieš skaičiuojant.');
      return;
    }
    router.push({ pathname: '/route/[id]/alternatives', params: { id: routeId } });
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Patikrinkite adresus"
      description="Aiškūs adresai patvirtinami automatiškai. Viršuje rodomi tik neaiškūs arba nepatvirtinti taškai.">
      <Pressable
        style={[styles.primaryButton, stops.length === 0 && { opacity: 0.6 }]}
        onPress={goToAlternatives}>
        <Text style={styles.primaryText}>Skaičiuoti maršrutą</Text>
      </Pressable>
      <View style={styles.card}>
        <Text style={styles.heading}>Startas ir grįžimas</Text>
        <Text style={styles.query}>{route.startLocation?.originalAddress}</Text>
        <StateLabel ready={startReady} state={startReady ? 'auto_confirmed' : 'unconfirmed'} />
        {candidates.start?.map((candidate) => (
          <Candidate key={candidate.normalizedAddress} candidate={candidate} onPress={() => selectStart(candidate)} />
        ))}
        <Text style={styles.heading}>Pabaiga</Text>
        <Text style={styles.query}>{route.endLocation?.originalAddress}</Text>
        <StateLabel ready={endReady} state={endReady ? 'auto_confirmed' : 'unconfirmed'} />
        {candidates.end?.map((candidate) => (
          <Candidate key={candidate.normalizedAddress} candidate={candidate} onPress={() => selectEnd(candidate)} />
        ))}
      </View>

      <Pressable style={styles.primaryButton} onPress={geocodeAll}>
        {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Patikrinti probleminius adresus</Text>}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {stops.map((stop) => (
        <StopEditor
          key={stop.id}
          stop={stop}
          candidates={candidates[stop.id] ?? []}
          onCandidate={(candidate) => { void selectCandidate(stop, candidate); }}
          onEdit={(patch) => editStop(stop, patch)}
          onDelete={() => deleteStop(stop)}
          onMove={moveStop}
          onSetPriority={(priorityFirst) => setPriority(stop, priorityFirst)}
        />
      ))}

      <View style={styles.card}>
        <Text style={styles.heading}>Pridėti tašką</Text>
        <TextInput value={newAddress} onChangeText={setNewAddress} placeholder="Adresas" style={styles.input} />
        <Pressable style={styles.secondaryButton} onPress={() => void addStop()}><Text style={styles.secondaryText}>Pridėti</Text></Pressable>
      </View>

      <Pressable
        style={[styles.primaryButton, stops.length === 0 && { opacity: 0.6 }]}
        onPress={goToAlternatives}>
        <Text style={styles.primaryText}>Skaičiuoti maršrutą</Text>
      </Pressable>
    </FoundationScreen>
  );
}

function formatTimeWindowInput(from: string | null, to: string | null): string {
  if (!from && !to) return '';
  if (from && to && from !== to) return `${from}-${to}`;
  return (from || to) ?? '';
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
  stop: DeliveryStop;
  candidates: GeocodeCandidate[];
  onCandidate: (candidate: GeocodeCandidate) => void;
  onEdit: (patch: Parameters<UpdateDraftStop['execute']>[2]) => Promise<void>;
  onDelete: () => void;
  onMove: (stopId: string, delta: -1 | 1) => void;
  onSetPriority: (priorityFirst: boolean) => void;
}) {
  const { stop } = props;
  const [address, setAddress] = useState(stop.originalAddress);
  const [weight, setWeight] = useState(stop.weightKg === null ? '' : String(stop.weightKg));
  const [recipient, setRecipient] = useState(stop.recipient);
  const [time, setTime] = useState(formatTimeWindowInput(stop.deliveryTimeFrom, stop.deliveryTimeTo));
  const [notes, setNotes] = useState(stop.notes ?? '');
  useEffect(() => {
    setAddress(stop.originalAddress);
    setWeight(stop.weightKg === null ? '' : String(stop.weightKg));
    setRecipient(stop.recipient);
    setTime(formatTimeWindowInput(stop.deliveryTimeFrom, stop.deliveryTimeTo));
    setNotes(stop.notes ?? '');
  }, [stop]);
  return (
    <View style={[styles.card, stop.addressValidationState !== 'auto_confirmed' && styles.problemCard]}>
      <View style={styles.rowBetween}>
        <Text style={styles.heading}>Taškas {stop.originalOrder}{stop.priorityFirst ? ' ⭐' : ''}</Text>
        <StateLabel ready={stop.addressValidationState === 'auto_confirmed'} state={stop.addressValidationState} />
      </View>
      <TextInput
        value={address}
        onChangeText={setAddress}
        onBlur={() => { void props.onEdit({
          originalAddress: address.trim(),
          geocodingQuery: address.trim(),
          normalizedAddress: null,
          latitude: null,
          longitude: null,
          addressValidationState: 'unconfirmed',
          geocodingError: null,
        }); }}
        placeholder="Adresas *"
        style={styles.input}
      />
      {stop.geocodingQuery && stop.geocodingQuery !== stop.originalAddress ? (
        <Text style={styles.auditText}>Tikrinta kaip: {stop.geocodingQuery}</Text>
      ) : null}
      {stop.normalizedAddress ? <Text style={styles.auditText}>Patvirtinta: {stop.normalizedAddress}</Text> : null}
      {stop.geocodingError ? <Text style={styles.error}>{stop.geocodingError}</Text> : null}
      {props.candidates.map((candidate) => (
        <Candidate key={candidate.normalizedAddress} candidate={candidate} onPress={() => props.onCandidate(candidate)} />
      ))}
      <View style={styles.twoColumns}>
        <TextInput value={weight} onChangeText={setWeight} onBlur={() => { void props.onEdit({ weightKg: nullableNumber(weight) }); }} placeholder="Svoris, kg (neprivaloma)" keyboardType="decimal-pad" style={styles.input} />
        <TextInput value={time} onChangeText={setTime} onBlur={() => { void props.onEdit(parseTimeWindowInput(time)); }} placeholder="Laiko langas (pvz. 08:00-12:00)" style={styles.input} />
      </View>
      <TextInput value={recipient} onChangeText={setRecipient} onBlur={() => { void props.onEdit({ recipient: recipient.trim() || null }); }} placeholder="Gavėjas (neprivaloma)" style={styles.input} />
      <TextInput value={notes} onChangeText={setNotes} onBlur={() => { void props.onEdit({ notes: notes.trim() || null }); }} placeholder="Pastabos (neprivaloma)" style={styles.input} />
      <Pressable
        style={[styles.priorityButton, stop.priorityFirst && styles.priorityButtonActive]}
        onPress={() => props.onSetPriority(!stop.priorityFirst)}>
        <Text style={[styles.priorityText, stop.priorityFirst && styles.priorityTextActive]}>
          {stop.priorityFirst ? '⭐ Prioritetinis (iškrauti pirmiausiai)' : 'Pažymėti kaip prioritetinį (iškrauti pirmiausiai)'}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable style={styles.smallButton} onPress={() => { props.onMove(stop.id, -1); }}><Text>↑</Text></Pressable>
        <Pressable style={styles.smallButton} onPress={() => { props.onMove(stop.id, 1); }}><Text>↓</Text></Pressable>
        <Pressable style={styles.deleteButton} onPress={props.onDelete}><Text style={styles.deleteText}>Pašalinti</Text></Pressable>
      </View>
    </View>
  );
}

function Candidate({ candidate, onPress }: { candidate: GeocodeCandidate; onPress: () => void }) {
  return (
    <Pressable style={styles.candidate} onPress={onPress}>
      <Text style={styles.candidateText}>{candidate.normalizedAddress}</Text>
      <Text style={styles.auditText}>{candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}</Text>
    </Pressable>
  );
}

function StateLabel({ ready, state }: { ready: boolean; state: DeliveryStop['addressValidationState'] }) {
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

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  problemCard: { borderColor: colors.warning, borderWidth: 2 },
  heading: { color: colors.text, fontSize: 17, fontWeight: '800' },
  query: { color: colors.textMuted },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  twoColumns: { gap: spacing.sm },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.background },
  auditText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  ready: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  warning: { color: colors.warning, fontSize: 12, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
  primaryButton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  primaryText: { color: '#fff', fontWeight: '800' },
  secondaryButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  candidate: { padding: spacing.sm, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  candidateText: { color: colors.text, fontWeight: '700' },
  priorityButton: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  priorityButtonActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  priorityText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  priorityTextActive: { color: colors.primary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  smallButton: { minWidth: 46, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  deleteButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
