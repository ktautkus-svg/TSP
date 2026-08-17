import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';

import { parseDeliveryText } from '@/application/parsing/text-parser';
import {
  CancelDraftRoute,
  CreateDraftRouteWithStops,
  RouteCommandError,
} from '@/application/routes/route-commands';
import { manualAddressesToDraftStops } from '@/application/routes/route-draft-mappers';
import { resolveRoute } from '@/application/routes/route-navigation';
import { GetDefaultLocations, RouteEndPreference } from '@/application/routes/saved-locations';
import { FoundationScreen } from '@/components/foundation-screen';
import { AppButton, AppCard, AppTextField, InlineNotice } from '@/components/ui-primitives';
import { RouteRepository } from '@/database/repositories/route-repository';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';
import type { RouteEndpoint } from '@/domain/route';

export default function NewRouteScreen() {
  const { profile } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [sourceText, setSourceText] = useState('');
  const [startAddress, setStartAddress] = useState('');
  const [endAddress, setEndAddress] = useState('');
  const [savedStartEndpoint, setSavedStartEndpoint] = useState<RouteEndpoint | null>(null);
  const [savedEndEndpoint, setSavedEndEndpoint] = useState<RouteEndpoint | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const commandIdRef = useRef(`manual-route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const parsedResult = useMemo(() => parseDeliveryText(sourceText), [sourceText]);

  useEffect(() => {
    if (profile.role === 'driver' && !profile.permissions?.canCreateRoutes) {
      router.replace(roleHomePath(profile.role) as Href);
      return;
    }
  }, [profile, router]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      new GetDefaultLocations(db).execute(),
      new RouteEndPreference(db).get(),
    ]).then(([locations, preferredEnd]) => {
      if (!active) return;
      const start = locations.warehouse?.endpoint ?? null;
      const end = preferredEnd === 'home' ? locations.home?.endpoint ?? start : start;
      if (start) {
        setStartAddress(start.originalAddress);
        setSavedStartEndpoint(start);
      }
      if (end) {
        setEndAddress(end.originalAddress);
        setSavedEndEndpoint(end);
      }
    }).catch((reason) => {
      if (__DEV__) console.warn('MANUAL_ROUTE_DEFAULT_LOCATIONS_FAILED', reason);
    });
    return () => { active = false; };
  }, [db]);

  const createRoute = async () => {
    if (startAddress.trim().length < 3 || parsedResult.points.length === 0) return;
    const startLocation: RouteEndpoint = savedStartEndpoint?.originalAddress === startAddress.trim()
      ? savedStartEndpoint
      : {
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
        ? savedEndEndpoint?.originalAddress === endAddress.trim()
          ? savedEndEndpoint
          : { ...startLocation, originalAddress: endAddress.trim(), geocodingQuery: endAddress.trim(), normalizedAddress: null, latitude: null, longitude: null }
        : startLocation,
      importSource: { type: 'manual', originalText: sourceText, imageReference: null },
      stops: manualAddressesToDraftStops(parsedResult.points.map((point) => point.fullAddress)),
    });
    void requestSync('mutation');
    router.push({ pathname: '/route/[id]/review', params: { id: created.routeId, returnTo: 'manual' } });
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
      <AppCard style={styles.formCard}>
        <AppTextField
          label="Maršruto pradžia"
          value={startAddress}
          onChangeText={(value) => { setStartAddress(value); setSavedStartEndpoint(null); }}
          placeholder="Sandėlio adresas"
        />
        <AppTextField
          label="Maršruto pabaiga"
          value={endAddress}
          onChangeText={(value) => { setEndAddress(value); setSavedEndEndpoint(null); }}
          placeholder="Sandėlis, namai arba kita vieta; tuščia = pradžios vieta"
        />
        <AppTextField
          label="Pristatymo adresai"
          hint="Vienas adresas eilutėje. Išsaugotų vietų koordinačių iš naujo tvirtinti nereikės."
          value={sourceText}
          onChangeText={setSourceText}
          placeholder={'Savanorių pr. 1, Vilnius\nGedimino pr. 9, Vilnius'}
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          style={styles.textArea}
        />
        <AppButton
          disabled={creating || !startAddress.trim() || parsedResult.points.length === 0}
          label="Tikrinti adresus ir koordinates"
          loading={creating}
          onPress={handleReview}
          testID="manual-route-review-top"
        />
        {parsedResult.points.map((point, index) => (
          <View key={`${point.fullAddress}-${index}`} style={styles.pointCard}>
            <Text style={styles.pointIndex}>{index + 1}</Text>
            <Text style={styles.pointText}>{point.fullAddress}</Text>
          </View>
        ))}
        {parsedResult.unparsedLines.length ? (
          <InlineNotice tone="warning">Kai kurių eilučių nepavyko atpažinti kaip adresų.</InlineNotice>
        ) : null}
      </AppCard>
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  formCard: { gap: spacing.md },
  textArea: {
    minHeight: 160,
    paddingTop: spacing.md,
  },
  pointCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm },
  pointIndex: { ...type.secondaryStrong, color: colors.info },
  pointText: { ...type.secondary, color: colors.textSecondary, flex: 1 },
});
