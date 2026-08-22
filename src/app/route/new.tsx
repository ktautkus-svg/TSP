import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';

import {
  CancelDraftRoute,
  CreateDraftRouteWithStops,
  RouteCommandError,
} from '@/application/routes/route-commands';
import { manualEntriesToDraftStops } from '@/application/routes/route-draft-mappers';
import { resolveRoute } from '@/application/routes/route-navigation';
import { GetDefaultLocations } from '@/application/routes/saved-locations';
import { FoundationScreen } from '@/components/foundation-screen';
import { AppButton, AppCard, AppTextField, InlineNotice } from '@/components/ui-primitives';
import { RouteRepository } from '@/database/repositories/route-repository';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';
import type { RouteEndpoint } from '@/domain/route';
import { devWarn } from '@/ui/dev-log';
import { parseCoordinateInput } from '@/application/import/address-resolver';

export default function NewRouteScreen() {
  const { profile } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const [sourceText, setSourceText] = useState('');
  const [warehouseEndpoint, setWarehouseEndpoint] = useState<RouteEndpoint | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const commandIdRef = useRef(`manual-route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const manualEntries = useMemo(
    () => sourceText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean),
    [sourceText],
  );
  const invalidDisplayEntries = useMemo(
    () => manualEntries.filter((entry) => parseCoordinateInput(entry) || isMapLink(entry)),
    [manualEntries],
  );

  useEffect(() => {
    if (profile.role === 'driver' && !profile.permissions?.canCreateRoutes) {
      router.replace(roleHomePath(profile.role) as Href);
      return;
    }
  }, [profile, router]);

  useEffect(() => {
    let active = true;
    void new GetDefaultLocations(db).execute().then((locations) => {
      if (!active) return;
      setWarehouseEndpoint(locations.warehouse?.endpoint ?? null);
    }).catch((reason) => {
      devWarn('MANUAL_ROUTE_DEFAULT_LOCATIONS_FAILED', reason);
    });
    return () => { active = false; };
  }, [db]);

  const createRoute = async () => {
    if (!warehouseEndpoint || manualEntries.length === 0 || invalidDisplayEntries.length > 0) return;
    const created = await new CreateDraftRouteWithStops(db).execute({
      commandId: commandIdRef.current,
      plannedDepartureAt: new Date().toISOString(),
      startLocation: warehouseEndpoint,
      endLocation: warehouseEndpoint,
      importSource: { type: 'manual', originalText: sourceText, imageReference: null },
      stops: manualEntriesToDraftStops(manualEntries),
    });
    void requestSync('mutation');
    router.push({ pathname: '/route/[id]/review', params: { id: created.routeId, returnTo: 'manual' } });
  };

  const handleReview = async () => {
    if (creatingRef.current) return;
    if (!warehouseEndpoint || manualEntries.length === 0 || invalidDisplayEntries.length > 0) {
      Alert.alert(
        'Trūksta duomenų',
        !warehouseEndpoint
          ? 'Pirmiausia nustatymuose pasirinkite numatytąjį sandėlį.'
          : invalidDisplayEntries.length > 0
            ? 'Čia įrašykite įstaigos pavadinimą arba pilną adresą. Koordinates ir žemėlapio nuorodą galėsite įvesti tik taisydami programos neatpažintą adresą.'
            : 'Įveskite bent vieną pristatymo vietos pavadinimą arba pilną adresą.',
      );
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
              devWarn('ACTIVE_ROUTE_REDIRECT_FAILED', reason);
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
      title="Naujas maršrutas"
      description="Įveskite po vieną pristatymo vietą eilutėje.">
      <AppCard style={styles.formCard}>
        <View style={styles.warehouseSummary}>
          <Text style={styles.warehouseLabel}>SANDĖLIS</Text>
          <Text style={styles.warehouseValue}>
            {warehouseEndpoint?.normalizedAddress ?? warehouseEndpoint?.originalAddress ?? 'Nenustatytas'}
          </Text>
        </View>
        {!warehouseEndpoint ? (
          <InlineNotice tone="warning">Pasirinkite numatytąjį sandėlį nustatymuose.</InlineNotice>
        ) : null}
        <AppTextField
          label="Pristatymo vietos"
          hint="Po vieną įstaigos pavadinimą arba pilną adresą eilutėje."
          value={sourceText}
          onChangeText={setSourceText}
          placeholder={'TSP sandėlis, Savanorių pr. 180, Vilnius\nKliento įmonė, Smėlynės g. 25, Panevėžys'}
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          style={styles.textArea}
        />
        {invalidDisplayEntries.length > 0 ? (
          <InlineNotice tone="warning">
            Koordinatės ir žemėlapio nuorodos naudojamos tik taisant neatpažintą adresą. Šiame sąraše įrašykite atpažįstamą vietos pavadinimą arba pilną adresą.
          </InlineNotice>
        ) : null}
        <AppButton
          disabled={creating || !warehouseEndpoint || manualEntries.length === 0 || invalidDisplayEntries.length > 0}
          label="Tęsti"
          loading={creating}
          onPress={handleReview}
          testID="manual-route-review-top"
        />
        {manualEntries.map((entry, index) => (
          <View key={`${entry}-${index}`} style={styles.pointCard}>
            <Text style={styles.pointIndex}>{index + 1}</Text>
            <Text style={styles.pointText}>{entry}</Text>
          </View>
        ))}
      </AppCard>
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  formCard: { gap: spacing.md },
  warehouseSummary: {
    gap: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  warehouseLabel: { ...type.label, color: colors.textMuted },
  warehouseValue: { ...type.bodyStrong, color: colors.text },
  textArea: {
    minHeight: 160,
    paddingTop: spacing.md,
  },
  pointCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm },
  pointIndex: { ...type.secondaryStrong, color: colors.info },
  pointText: { ...type.secondary, color: colors.textSecondary, flex: 1 },
});

function isMapLink(value: string): boolean {
  return /^(?:https?:\/\/)?(?:www\.)?(?:google\.[^/]+\/maps|maps\.app\.goo\.gl|maps\.lt)(?:\/|$)/iu.test(value.trim());
}
