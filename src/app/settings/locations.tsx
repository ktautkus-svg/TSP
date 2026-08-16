import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { GetDefaultLocations, SaveDefaultLocation } from '@/application/routes/saved-locations';
import { FoundationScreen } from '@/components/foundation-screen';
import { GatewayAddressResolver } from '@/infrastructure/import/gateway-address-resolver';
import type { RouteEndpoint, SavedLocation } from '@/domain/route';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { Alert } from '@/ui/alert';

export default function LocationSettingsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const service = useMemo(() => new GetDefaultLocations(db), [db]);
  const resolver = useMemo(() => new GatewayAddressResolver(), []);
  const [warehouse, setWarehouse] = useState('');
  const [home, setHome] = useState('');
  const [warehouseConfirmed, setWarehouseConfirmed] = useState(false);
  const [homeConfirmed, setHomeConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    void service.execute().then((locations) => {
      if (!mounted) return;
      setWarehouse(locations.warehouse?.endpoint.originalAddress ?? '');
      setHome(locations.home?.endpoint.originalAddress ?? '');
      setWarehouseConfirmed(Boolean(locations.warehouse?.endpoint.latitude !== null && locations.warehouse?.endpoint.latitude !== undefined));
      setHomeConfirmed(Boolean(locations.home?.endpoint.latitude !== null && locations.home?.endpoint.latitude !== undefined));
      setError(null);
      void backfillMissingCoordinates(mounted, locations);
    }).catch((reason) => {
      if (__DEV__) console.warn('LOCATION_SETTINGS_LOAD_FAILED', reason);
      if (mounted) setError(reason instanceof Error ? reason.message : 'Nustatymų atkurti nepavyko.');
    });
    return () => { mounted = false; };
  }, [service]));

  // Best-effort backfill: older saved locations (or the v10 migration seed) were
  // stored without coordinates. Silently try to geocode them once per visit to
  // this screen so routes stop demanding re-confirmation of an address that
  // never changed. Failures are non-fatal — the address stays usable as text.
  const backfillMissingCoordinates = async (
    mounted: boolean,
    locations: { warehouse: SavedLocation | null; home: SavedLocation | null },
  ) => {
    const command = new SaveDefaultLocation(db);
    const targets: Array<['warehouse' | 'home', SavedLocation | null]> = [
      ['warehouse', locations.warehouse],
      ['home', locations.home],
    ];
    for (const [kind, saved] of targets) {
      if (!saved || saved.endpoint.latitude !== null) continue;
      try {
        const geocoded = await geocodeEndpoint(resolver, saved.endpoint.originalAddress);
        if (!geocoded || !mounted) continue;
        await command.execute(kind, saved.label, geocoded);
        if (kind === 'warehouse') setWarehouseConfirmed(true); else setHomeConfirmed(true);
      } catch (reason) {
        if (__DEV__) console.warn('LOCATION_BACKFILL_GEOCODE_FAILED', kind, reason);
      }
    }
  };

  const save = async () => {
    if (!warehouse.trim()) return Alert.alert('Trūksta sandėlio', 'Numatytojo sandėlio adresas yra privalomas.');
    setSaving(true);
    try {
      const command = new SaveDefaultLocation(db);
      const warehouseEndpoint = (await geocodeEndpoint(resolver, warehouse)) ?? plainEndpoint(warehouse);
      await command.execute('warehouse', 'Numatytasis sandėlis', warehouseEndpoint);
      setWarehouseConfirmed(warehouseEndpoint.latitude !== null);

      let homeEndpoint: RouteEndpoint | null = null;
      if (home.trim()) {
        homeEndpoint = (await geocodeEndpoint(resolver, home)) ?? plainEndpoint(home);
        await command.execute('home', 'Namai', homeEndpoint);
        setHomeConfirmed(homeEndpoint.latitude !== null);
      }

      setError(null);
      const unconfirmed = [
        warehouseEndpoint.latitude === null ? 'sandėlio' : null,
        home.trim() && homeEndpoint?.latitude === null ? 'namų' : null,
      ].filter((label): label is string => Boolean(label));

      if (unconfirmed.length) {
        Alert.alert(
          'Išsaugota be patvirtinimo',
          `Nepavyko automatiškai patvirtinti ${unconfirmed.join(' ir ')} adreso koordinačių. Adresas išsaugotas tekstu, bet kuriant maršrutą jį vis tiek reikės patvirtinti rankiniu būdu.`,
        );
      } else {
        Alert.alert('Išsaugota', 'Vietos geokoduotos ir patvirtintos. Kuriant maršrutą jų iš naujo tvirtinti nereikės.');
      }
    } catch (reason) {
      if (__DEV__) console.warn('LOCATION_SETTINGS_SAVE_FAILED', reason);
      setError(reason instanceof Error ? reason.message : 'Vietų išsaugoti nepavyko.');
    } finally {
      setSaving(false);
    }
  };

  const goSettings = () => router.replace('/settings' as Href);

  return (
    <>
    <Stack.Screen options={{ gestureEnabled: false }} />
    <FoundationScreen showFoundationNotice={false} title="Numatytosios vietos" description="Šios vietos saugomos įrenginyje. Jos nėra pakeičiamos testiniu adresu.">
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.label}>Numatytasis sandėlis *</Text>
        <TextInput
          value={warehouse}
          onChangeText={(value) => { setWarehouse(value); setWarehouseConfirmed(false); }}
          placeholder="Sandėlio adresas"
          style={styles.input}
        />
        <Text style={warehouseConfirmed ? styles.confirmed : styles.unconfirmed}>
          {warehouseConfirmed ? 'Adresas patvirtintas ir geokoduotas ✓' : 'Adresas dar nepatvirtintas — bus patikrintas išsaugant'}
        </Text>
        <Text style={styles.label}>Namų vieta</Text>
        <TextInput
          value={home}
          onChangeText={(value) => { setHome(value); setHomeConfirmed(false); }}
          placeholder="Namų adresas (neprivaloma)"
          style={styles.input}
        />
        {home.trim() ? (
          <Text style={homeConfirmed ? styles.confirmed : styles.unconfirmed}>
            {homeConfirmed ? 'Adresas patvirtintas ir geokoduotas ✓' : 'Adresas dar nepatvirtintas — bus patikrintas išsaugant'}
          </Text>
        ) : null}
        <Pressable disabled={saving} style={[styles.button, saving && styles.disabled]} onPress={() => void save()}>
          {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.buttonText}>Išsaugoti vietas</Text>}
        </Pressable>
      </View>
      <Pressable style={styles.backButton} onPress={goSettings}><Text style={styles.backText}>← Nustatymai</Text></Pressable>
    </FoundationScreen>
    </>
  );
}

async function geocodeEndpoint(resolver: GatewayAddressResolver, address: string): Promise<RouteEndpoint | null> {
  const value = address.trim();
  if (!value) return null;
  try {
    const candidates = await resolver.resolve(value);
    if (!candidates.length) return null;
    const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    if (best.latitude === null || best.longitude === null) return null;
    return {
      originalAddress: value,
      geocodingQuery: value,
      normalizedAddress: best.normalizedAddress,
      latitude: best.latitude,
      longitude: best.longitude,
    };
  } catch {
    return null;
  }
}

function plainEndpoint(address: string): RouteEndpoint {
  const value = address.trim();
  return { originalAddress: value, geocodingQuery: value, normalizedAddress: null, latitude: null, longitude: null };
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  label: { ...type.cardTitle, color: colors.text },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, ...type.body },
  confirmed: { ...type.secondaryStrong, color: colors.success },
  unconfirmed: { ...type.secondaryStrong, color: colors.warning },
  button: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { ...type.button, color: colors.textInverse },
  backButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  backText: { ...type.button, color: colors.textSecondary },
  headerAction: { minWidth: 96, minHeight: 44, justifyContent: 'center' },
  headerText: { ...type.button, color: colors.brandNavy },
  error: { ...type.secondaryStrong, color: colors.danger },
});
