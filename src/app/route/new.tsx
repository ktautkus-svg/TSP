import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { parseDeliveryText } from '@/application/parsing/text-parser';
import {
  CancelDraftRoute,
  CreateDraftRouteWithStops,
  RouteCommandError,
} from '@/application/routes/route-commands';
import { manualAddressesToDraftStops } from '@/application/routes/route-draft-mappers';
import { resolveRoute } from '@/application/routes/route-navigation';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import { colors, spacing } from '@/ui/tokens';
import { Alert } from '@/ui/alert';

export default function NewRouteScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [sourceText, setSourceText] = useState('');
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const commandIdRef = useRef(`manual-route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const parsedResult = useMemo(() => parseDeliveryText(sourceText), [sourceText]);

  useEffect(() => {
    let active = true;
    void repository.getActive()
      .then((route) => {
        if (!active || !route || route.status === 'draft') return;
        const destination = resolveRoute(route);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
      })
      .catch((reason) => {
        if (__DEV__) console.warn('NEW_ROUTE_GUARD_FAILED', reason);
      });
    return () => { active = false; };
  }, [repository, router]);

  const createRoute = async () => {
    if (startAddress.trim().length < 3 || parsedResult.points.length === 0) return;
    const startLocation = {
      originalAddress: startAddress.trim(),
      geocodingQuery: startAddress.trim(),
      normalizedAddress: null,
      latitude: null,
      longitude: null,
    };
    const created = await new CreateDraftRouteWithStops(db).execute({
      commandId: commandIdRef.current,
      plannedDepartureAt: new Date().toISOString(),
      startLocation,
      endLocation: endAddress.trim()
        ? { ...startLocation, originalAddress: endAddress.trim(), geocodingQuery: endAddress.trim() }
        : startLocation,
      importSource: { type: 'manual', originalText: sourceText, imageReference: null },
      stops: manualAddressesToDraftStops(parsedResult.points.map((point) => point.fullAddress)),
    });
    router.push({ pathname: '/route/[id]/review', params: { id: created.routeId } });
  };

  const handleReview = async () => {
    if (creatingRef.current) return;
    if (!startAddress.trim() || parsedResult.points.length === 0) {
      Alert.alert('Trūksta duomenų', 'Prašome įvesti pradžios adresą bei bent vieną pristatymo adresą.');
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    try {
      await createRoute();
    } catch (error) {
      if (error instanceof RouteCommandError && error.code === 'ACTIVE_ROUTE_EXISTS') {
        const activeRouteId = error.details.activeRouteId;
        Alert.alert('Jau yra aktyvus maršrutas', error.message, [
          {
            text: 'Tęsti aktyvų',
            onPress: () => { void repository.getById(activeRouteId).then((activeRoute) => {
              if (!activeRoute) return;
              const destination = resolveRoute(activeRoute);
              router.replace({ pathname: destination.pathname, params: destination.params } as Href);
            }).catch((reason) => {
              if (__DEV__) console.warn('ACTIVE_ROUTE_REDIRECT_FAILED', reason);
            }); },
          },
          {
            text: 'Atšaukti aktyvų ir kurti naują',
            style: 'destructive',
            onPress: () => Alert.alert('Patvirtinkite atšaukimą', 'Aktyvus maršrutas liks audite, bet nebebus tęsiamas.', [
              { text: 'Ne', style: 'cancel' },
              { text: 'Taip, atšaukti', style: 'destructive', onPress: () => { void (async () => {
                try {
                  await new CancelDraftRoute(db).execute(activeRouteId);
                  await createRoute();
                } catch (reason) {
                  Alert.alert('Veiksmas nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
                }
              })(); } },
            ]),
          },
          { text: 'Grįžti', style: 'cancel' },
        ]);
        return;
      }
      Alert.alert('Maršrutas nesukurtas', error instanceof Error ? error.message : 'Nežinoma klaida.');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Naujas realus maršrutas"
      description="Įklijuoti adresai pirmiausia saugiai geokoduojami gateway serveryje. Maršrutas skaičiuojamas tik patvirtinus koordinates.">
      <View style={styles.formCard}>
        <Text style={styles.label}>Maršruto pradžia</Text>
        <TextInput
          value={startAddress}
          onChangeText={setStartAddress}
          placeholder="Sandėlio adresas"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.label}>Maršruto pabaiga</Text>
        <TextInput
          value={endAddress}
          onChangeText={setEndAddress}
          placeholder="Sandėlis, namai arba kita vieta; tuščia = pradžios vieta"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.label}>Pristatymo adresai</Text>
        <TextInput
          value={sourceText}
          onChangeText={setSourceText}
          placeholder={'Savanorių pr. 1, Vilnius\nGedimino pr. 9, Vilnius'}
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          style={styles.textArea}
        />
        <Text style={styles.helper}>
          Vienas adresas eilutėje. Šiame etape adresai dar neturi koordinačių ir negali būti maršrutizuojami.
        </Text>
        {parsedResult.points.map((point, index) => (
          <View key={`${point.fullAddress}-${index}`} style={styles.pointCard}>
            <Text style={styles.pointIndex}>{index + 1}</Text>
            <Text style={styles.pointText}>{point.fullAddress}</Text>
          </View>
        ))}
        {parsedResult.unparsedLines.length ? (
          <Text style={styles.error}>Kai kurių eilučių nepavyko atpažinti kaip adresų.</Text>
        ) : null}
        <Pressable
          style={styles.primaryButton}
          onPress={handleReview}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Tikrinti adresus ir koordinates</Text>}
        </Pressable>
      </View>
    </FoundationScreen>
  );
}

const styles = StyleSheet.create({
  formCard: {
    padding: spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: spacing.xs },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    backgroundColor: colors.background,
  },
  textArea: {
    minHeight: 160,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: colors.background,
  },
  helper: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  pointCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.primarySoft, borderRadius: 10 },
  pointIndex: { color: colors.primary, fontWeight: '800' },
  pointText: { color: colors.text, flex: 1 },
  error: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  primaryButton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginTop: spacing.sm },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.45 },
});
